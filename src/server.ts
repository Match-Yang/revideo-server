import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { execSync, spawn, type ChildProcess } from "child_process";
import { getDirs, getDirByName, render, preparePublicDir } from "./renderer";
import { scanDir } from "./scan-dir";
import { publish, type PublishRequest } from "./publish";
import { SERVER_PORT } from "./config";
import {
  appendJobEvent,
  getJobEvents,
} from "./jobs/events";
import {
  createJob,
  createJobId,
  deleteJob,
  listJobs,
  loadJob,
  saveJob,
  setJobStep,
} from "./jobs/store";
import { normalizeJobAssets } from "./jobs/normalize";
import { buildJobDirInfo, renderJob } from "./jobs/render-job";
import { translateJobAssets } from "./jobs/translate-job";
import type { CreateJobRequest, JobStep } from "./jobs/types";
import { generateDrafts } from "./jobs/drafts";
import {
  preflightJobTarget,
  publishJobTarget,
} from "./jobs/publish-job";
import {
  checkPlatformLogin,
  getBrowserHealth,
  getBrowserStatus,
  openPlatformLogin,
  startBrowser,
  stopBrowser,
} from "./browser/manager";
import {
  listPlatformCapabilities,
  resolveSourceAdapter,
} from "./platforms/registry";
import {
  listTranslateProviders,
  translateText,
} from "./translate/openai-compatible";
import { getSystemHealth } from "./health";
import { calculateTargetCommentCount, loadSettings, saveSettings } from "./settings";
import {
  createTask,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
  getTaskStatistics,
  isTaskComplete,
  getTaskProgress,
  cleanupExpiredTasks,
  syncRenderStatus,
} from "./task-manager";
import type { AddTaskRequest, TaskFilter } from "./types";

let currentRender: { name: string; progress: any; abortController?: AbortController; taskId?: string } | null = null;

interface QueuedJobRun {
  id: string;
  jobId: string;
  steps: string[];
  force?: boolean;
  formatId?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "paused";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  abortController?: AbortController;
}

interface JobRunOptions {
  steps: string[];
  force?: boolean;
  formatId?: string;
  signal?: AbortSignal;
}

interface ScheduledPublishRun {
  jobId: string;
  runAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const jobRunQueue: QueuedJobRun[] = [];
const jobRunHistory: QueuedJobRun[] = [];
const cancelledJobRunIds = new Set<string>();
const pausedJobRunIds = new Set<string>();
const scheduledPublishRuns = new Map<string, ScheduledPublishRun>();
let activeJobRun: QueuedJobRun | null = null;
let studioPreviewProcess: ChildProcess | null = null;
let studioPreviewJobId: string | null = null;

const app = express();
const PORT = SERVER_PORT;
const CRASH_LOG_FILE = path.join(process.cwd(), "data", "server-crash.log");

app.use(express.json());

function appendCrashLog(message: string, data?: unknown): void {
  try {
    fs.mkdirSync(path.dirname(CRASH_LOG_FILE), { recursive: true });
    fs.appendFileSync(
      CRASH_LOG_FILE,
      JSON.stringify({ ts: new Date().toISOString(), message, data }, null, 0) + "\n"
    );
  } catch {}
}

process.on("uncaughtException", (err) => {
  appendCrashLog("uncaughtException", err instanceof Error ? { message: err.message, stack: err.stack } : err);
  throw err;
});

process.on("unhandledRejection", (reason) => {
  appendCrashLog("unhandledRejection", reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason);
});

// SSE helpers
function isSSERequest(req: express.Request): boolean {
  return req.headers.accept?.includes("text/event-stream") === true;
}

function setupSSE(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  return {
    sendProgress(data: any) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    sendEvent(event: string, data: any) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() { res.end(); },
  };
}

function markCompletedIfAllTargetsPublished(jobId: string): void {
  const job = loadJob(jobId);
  if (!job || job.targets.length === 0) return;
  if (job.targets.every((target) => target.status === "published")) {
    setJobStep(jobId, "completed", "completed", { percent: 100 });
  }
}

function existingRenderResult(job: NonNullable<ReturnType<typeof loadJob>>) {
  const outputPath = path.resolve(process.cwd(), "out", `${job.id}.mp4`);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) return null;
  const coverPath = path.resolve(process.cwd(), "out", `${job.id}-cover.jpg`);
  const normalized = job.source.metadata?.normalizedAssets as { durationSec?: number } | undefined;
  const durationSec = Math.max(0, Number(normalized?.durationSec || job.source.metadata?.durationSec || 0)) *
    Math.min(10, Math.max(1, Number(job.options.repeatTimes || 1)));
  return {
    outputPath,
    coverPath: fs.existsSync(coverPath) ? coverPath : undefined,
    durationSec,
  };
}

function snapshotQueue() {
  return {
    active: activeJobRun,
    queued: jobRunQueue,
    scheduled: Array.from(scheduledPublishRuns.values()).map((run) => ({
      jobId: run.jobId,
      runAt: run.runAt,
    })),
    recent: jobRunHistory.slice(-20).reverse(),
  };
}

function defaultRunSteps(): string[] {
  const steps = ["download", "normalize", "translate", "render", "generate-drafts", "preflight-publish"];
  return loadSettings().publishing.scheduleMode === "immediate" ? [...steps, "publish"] : steps;
}

function withConfiguredPublishStep(steps: string[]): string[] {
  return loadSettings().publishing.scheduleMode === "immediate" && !steps.includes("publish")
    ? [...steps, "publish"]
    : steps;
}

function runStepsFromJobStep(step: JobStep, status?: string): string[] {
  const stepCompleted = status === "completed" || status === "skipped";
  if (step === "downloading-source") return defaultRunSteps();
  if (step === "normalizing-assets") return withConfiguredPublishStep(stepCompleted ? ["translate", "render", "generate-drafts", "preflight-publish"] : ["normalize", "translate", "render", "generate-drafts", "preflight-publish"]);
  if (step === "translating-assets" || step === "moderating-assets") return withConfiguredPublishStep(stepCompleted ? ["render", "generate-drafts", "preflight-publish"] : ["translate", "render", "generate-drafts", "preflight-publish"]);
  if (step === "rendering-video") return withConfiguredPublishStep(stepCompleted ? ["generate-drafts", "preflight-publish"] : ["render", "generate-drafts", "preflight-publish"]);
  if (step === "generating-platform-drafts") return withConfiguredPublishStep(stepCompleted ? ["preflight-publish"] : ["generate-drafts", "preflight-publish"]);
  if (step === "preflighting-targets") return stepCompleted ? withConfiguredPublishStep([]) : withConfiguredPublishStep(["preflight-publish"]);
  if (step === "publishing-targets") return ["publish"];
  return defaultRunSteps();
}

function clearScheduledPublish(jobId: string): void {
  const scheduled = scheduledPublishRuns.get(jobId);
  if (!scheduled) return;
  clearTimeout(scheduled.timer);
  scheduledPublishRuns.delete(jobId);
}

function getScheduledPublishDelayMs(): number {
  const minutes = Number(loadSettings().publishing.scheduledDelayMinutes || 0);
  return Math.max(0, minutes) * 60 * 1000;
}

function schedulePublishRun(jobId: string, delayMs = getScheduledPublishDelayMs()): void {
  clearScheduledPublish(jobId);
  const runAt = Date.now() + Math.max(0, delayMs);
  const job = loadJob(jobId);
  if (job) {
    job.source.metadata = {
      ...(job.source.metadata || {}),
      scheduledPublishAt: runAt,
    };
    saveJob(job);
  }
  setJobStep(jobId, "publishing-targets", "paused", {
    percent: 0,
    error: `Scheduled publish at ${new Date(runAt).toISOString()}`,
  });
  appendJobEvent({
    jobId,
    level: "info",
    step: "publishing-targets",
    message: "Publish scheduled",
    data: { runAt, delayMs },
  });
  const timer = setTimeout(() => {
    scheduledPublishRuns.delete(jobId);
    enqueueJobRun(jobId, { steps: ["publish"] });
  }, Math.max(0, delayMs));
  scheduledPublishRuns.set(jobId, { jobId, runAt, timer });
}

function terminateRenderProcesses(): void {
  try {
    execSync(
      "pkill -f 'node_modules/@remotion/compositor|node_modules/.remotion/chrome-headless-shell' || true",
      { stdio: "ignore" }
    );
  } catch {
    // Best-effort cleanup. The abort signal remains the primary cancellation path.
  }
}

function remotionStudioPort(): number {
  return Math.max(1, Number(process.env.REMOTION_STUDIO_PORT || 3000));
}

function pidsListeningOnPort(port: number): number[] {
  try {
    return execSync(`lsof -tiTCP:${port} -sTCP:LISTEN -n -P || true`, { encoding: "utf-8" })
      .split(/\s+/)
      .map((value) => Number(value))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function processCommand(pid: number): string {
  try {
    return execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function stopRemotionStudioOnPort(port: number): void {
  const pids = pidsListeningOnPort(port);
  for (const pid of pids) {
    const command = processCommand(pid);
    if (!/remotion\s+studio|npx\s+remotion/i.test(command)) continue;
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}

function buildStudioProps(job: NonNullable<ReturnType<typeof loadJob>>, dirInfo = buildJobDirInfo(job)) {
  const videoExt = path.extname(dirInfo.videoFile || ".mp4");
  const normalized = job.source.metadata?.normalizedAssets as { durationSec?: number } | undefined;
  const sourceDurationSec = Math.max(1, Number(normalized?.durationSec || job.source.metadata?.durationSec || 60));
  const repeatTimes = Math.min(10, Math.max(1, Number(job.options.repeatTimes || 1)));
  return {
    dirPath: dirInfo.path,
    videoFile: `video${videoExt}`,
    commentFile: dirInfo.commentFile ? "comments.json" : "",
    subtitleFiles: dirInfo.subtitleFiles.length > 0 ? [path.basename(dirInfo.subtitleFiles[0])] : [],
    durationInFrames: Math.ceil(sourceDurationSec * repeatTimes * 30),
    sourceVideoDurationInFrames: Math.ceil(sourceDurationSec * 30),
  };
}

function startRemotionStudioPreview(jobId: string, studioProps: ReturnType<typeof buildStudioProps>) {
  const port = remotionStudioPort();
  if (studioPreviewProcess && !studioPreviewProcess.killed) {
    studioPreviewProcess.kill("SIGTERM");
    studioPreviewProcess = null;
  }
  stopRemotionStudioOnPort(port);

  const logPath = path.join(process.cwd(), "data", "remotion-studio.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.createWriteStream(logPath, { flags: "a" });
  const child = spawn("npx", ["remotion", "studio", "--port", String(port), "--props", JSON.stringify(studioProps)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("exit", () => {
    log.end();
    if (studioPreviewProcess === child) {
      studioPreviewProcess = null;
      studioPreviewJobId = null;
    }
  });
  child.unref();
  studioPreviewProcess = child;
  studioPreviewJobId = jobId;

  return {
    studioUrl: `http://localhost:${port}`,
    previewJobId: studioPreviewJobId,
    logPath,
  };
}

function assertRunNotCancelled(options: JobRunOptions): void {
  if (options.signal?.aborted) {
    throw new Error("Job run cancelled");
  }
}

function hasUsableExistingTranslation(job: NonNullable<ReturnType<typeof loadJob>>): boolean {
  const translation = job.source.metadata?.translation as
    | {
        comments?: { status?: string; outputPath?: string };
        subtitles?: { status?: string; outputPaths?: string[] };
      }
    | undefined;
  if (!translation) return false;
  const commentsReady =
    translation.comments?.status === "skipped" ||
    Boolean(translation.comments?.outputPath && fs.existsSync(translation.comments.outputPath));
  const subtitlesReady =
    translation.subtitles?.status === "skipped" ||
    Boolean(translation.subtitles?.outputPaths?.some((file) => fs.existsSync(file)));
  return commentsReady && subtitlesReady;
}

function recoverInterruptedJobRuns(): void {
  for (const job of listJobs()) {
    const step = job.workflow.currentStep;
    if (step === "publishing-targets" && job.workflow.steps[step]?.status === "paused") {
      const runAt = Number(job.source.metadata?.scheduledPublishAt || 0);
      if (runAt > 0) schedulePublishRun(job.id, Math.max(0, runAt - Date.now()));
      continue;
    }
    if (job.workflow.steps[step]?.status === "running") {
      if (step === "rendering-video") {
        const renderResult = existingRenderResult(job);
        if (renderResult) {
          const latest = loadJob(job.id) || job;
          latest.artifacts.outputVideo = renderResult.outputPath;
          latest.artifacts.coverImage = renderResult.coverPath;
          saveJob(latest);
          setJobStep(job.id, "rendering-video", "completed", { percent: 100 });
          appendJobEvent({
            jobId: job.id,
            level: "warn",
            step,
            message: "Recovered completed render output after server restart",
            data: renderResult,
          });
          continue;
        }
      }
      setJobStep(job.id, step, "failed", {
        error: "Server restarted while this step was running",
      });
      appendJobEvent({
        jobId: job.id,
        level: "warn",
        step,
        message: "Recovered interrupted running step after server restart",
      });
    }
  }
}

function failCurrentRunningStep(jobId: string, error: string): boolean {
  const latest = loadJob(jobId);
  const currentStep = latest?.workflow.currentStep;
  if (!latest || !currentStep) return false;
  if (latest.workflow.steps[currentStep]?.status === "running") {
    setJobStep(jobId, currentStep, "failed", { error });
    return true;
  }
  return false;
}

function pauseCurrentRunningStep(jobId: string, reason: string): void {
  const latest = loadJob(jobId);
  const currentStep = latest?.workflow.currentStep;
  if (!latest || !currentStep) return;
  if (latest.workflow.steps[currentStep]?.status === "running") {
    setJobStep(jobId, currentStep, "paused", {
      percent: latest.workflow.steps[currentStep]?.percent || 0,
      error: reason,
    });
  }
}

function cancelJobRunsForJob(jobId: string, reason: string): void {
  clearScheduledPublish(jobId);
  for (let index = jobRunQueue.length - 1; index >= 0; index -= 1) {
    const run = jobRunQueue[index];
    if (run.jobId !== jobId) continue;
    jobRunQueue.splice(index, 1);
    run.status = "cancelled";
    run.finishedAt = Date.now();
    jobRunHistory.push(run);
    appendJobEvent({
      jobId,
      level: "warn",
      message: reason,
      data: { runId: run.id },
    });
  }

  if (activeJobRun?.jobId === jobId) {
    cancelledJobRunIds.add(activeJobRun.id);
    activeJobRun.abortController?.abort();
    if (currentRender?.taskId === jobId) {
      currentRender.abortController?.abort();
      terminateRenderProcesses();
    }
    setJobStep(jobId, "cancelled", "completed", { percent: 100 });
    appendJobEvent({
      jobId,
      level: "warn",
      message: reason,
      data: { runId: activeJobRun.id },
    });
  }
}

function pauseJobRunsForJob(jobId: string, reason: string): QueuedJobRun | null {
  clearScheduledPublish(jobId);
  const queuedIndex = jobRunQueue.findIndex((run) => run.jobId === jobId);
  if (queuedIndex !== -1) {
    const [run] = jobRunQueue.splice(queuedIndex, 1);
    run.status = "paused";
    run.finishedAt = Date.now();
    jobRunHistory.push(run);
    pauseCurrentRunningStep(jobId, reason);
    appendJobEvent({
      jobId,
      level: "warn",
      message: reason,
      data: { runId: run.id },
    });
    return run;
  }

  if (activeJobRun?.jobId === jobId) {
    pausedJobRunIds.add(activeJobRun.id);
    activeJobRun.abortController?.abort();
    if (currentRender?.taskId === jobId) {
      currentRender.abortController?.abort();
      terminateRenderProcesses();
    }
    pauseCurrentRunningStep(jobId, reason);
    appendJobEvent({
      jobId,
      level: "warn",
      message: reason,
      data: { runId: activeJobRun.id },
    });
    return activeJobRun;
  }

  pauseCurrentRunningStep(jobId, reason);
  return null;
}

async function executeJobRun(jobId: string, options: JobRunOptions): Promise<Record<string, unknown>> {
  const job = loadJob(jobId);
  if (!job) {
    throw new Error("Job not found");
  }

  const steps = options.steps.length ? options.steps : defaultRunSteps();
  const results: Record<string, unknown> = {};

  try {
    assertRunNotCancelled(options);
    if (steps.includes("download")) {
      const adapter = resolveSourceAdapter(job.source.url, job.source.platform);
      if (!adapter?.download) {
        throw new Error(`${job.source.platform} download adapter is not implemented yet`);
      }
      setJobStep(job.id, "downloading-source", "running", { percent: 0 });
      appendJobEvent({
        jobId: job.id,
        level: "info",
        step: "downloading-source",
        message: "Source download started",
        data: { platform: job.source.platform },
      });
      results.download = await adapter.download({
        url: job.source.url,
        outputDir: job.artifacts.sourceDir,
        options: job.options,
        formatId: options.formatId,
        signal: options.signal,
      });
      const latest = loadJob(job.id) || job;
      latest.source.metadata = { ...latest.source.metadata, assets: results.download };
      saveJob(latest);
      setJobStep(job.id, "downloading-source", "completed", { percent: 100 });
      appendJobEvent({
        jobId: job.id,
        level: "info",
        step: "downloading-source",
        message: "Source download completed",
        data: { assets: results.download },
      });
    }

    assertRunNotCancelled(options);
    if (steps.includes("normalize")) {
      const latest = loadJob(job.id) || job;
      setJobStep(job.id, "normalizing-assets", "running", { percent: 0 });
      results.normalize = normalizeJobAssets(latest);
      const next = loadJob(job.id) || latest;
      next.source.metadata = { ...next.source.metadata, normalizedAssets: results.normalize };
      saveJob(next);
      setJobStep(job.id, "normalizing-assets", "completed", { percent: 100 });
      appendJobEvent({
        jobId: job.id,
        level: "info",
        step: "normalizing-assets",
        message: "Assets normalized",
        data: { normalizedAssets: results.normalize },
      });
    }

    assertRunNotCancelled(options);
    if (steps.includes("translate")) {
      const latest = loadJob(job.id) || job;
      if (hasUsableExistingTranslation(latest)) {
        results.translate = latest.source.metadata?.translation;
        setJobStep(job.id, "translating-assets", "completed", { percent: 100 });
        appendJobEvent({
          jobId: job.id,
          level: "info",
          step: "translating-assets",
          message: "Existing translation reused",
          data: { translation: results.translate },
        });
      } else {
      setJobStep(job.id, "translating-assets", "running", { percent: 0 });
      const translation = await translateJobAssets(latest);
      const next = loadJob(job.id) || latest;
      next.source.metadata = { ...next.source.metadata, translation };
      saveJob(next);
      results.translate = translation;
      const skipped =
        translation.comments.status === "skipped" && translation.subtitles.status === "skipped";
      setJobStep(job.id, "translating-assets", skipped ? "skipped" : "completed", { percent: 100 });
      appendJobEvent({
        jobId: job.id,
        level: "info",
        step: "translating-assets",
        message: skipped ? "No translatable assets found" : "Assets translated",
        data: { translation },
      });
      }
    }

    assertRunNotCancelled(options);
    if (steps.includes("render")) {
      const latest = loadJob(job.id) || job;
      const reusableRender = existingRenderResult(latest);
      if (reusableRender) {
        latest.artifacts.outputVideo = reusableRender.outputPath;
        latest.artifacts.coverImage = reusableRender.coverPath;
        saveJob(latest);
        results.render = reusableRender;
        setJobStep(job.id, "rendering-video", "completed", { percent: 100 });
        appendJobEvent({
          jobId: job.id,
          level: "info",
          step: "rendering-video",
          message: "Existing rendered output reused",
          data: reusableRender,
        });
      } else {
      if (currentRender) {
        throw new Error("已有任务正在渲染中，请等待完成后再试");
      }
      const abortController = new AbortController();
      currentRender = { name: job.id, progress: null, abortController, taskId: job.id };
      setJobStep(job.id, "rendering-video", "running", { percent: 0 });
      appendJobEvent({
        jobId: job.id,
        level: "info",
        step: "rendering-video",
        message: "Job render started",
      });
      try {
        const renderResult = await renderJob(
          latest,
          (progress) => {
            if (currentRender) currentRender.progress = progress;
            setJobStep(job.id, "rendering-video", "running", { percent: progress.percent });
          },
          abortController.signal
        );
        results.render = renderResult;
        const next = loadJob(job.id) || latest;
        next.artifacts.outputVideo = renderResult.outputPath;
        next.artifacts.coverImage = renderResult.coverPath;
        saveJob(next);
        setJobStep(job.id, "rendering-video", "completed", { percent: 100 });
        appendJobEvent({
          jobId: job.id,
          level: "info",
          step: "rendering-video",
          message: "Job render completed",
          data: { ...renderResult },
        });
      } finally {
        currentRender = null;
      }
      }
    }

    assertRunNotCancelled(options);
    if (steps.includes("generate-drafts")) {
      const latest = loadJob(job.id) || job;
      setJobStep(job.id, "generating-platform-drafts", "running", { percent: 0 });
      latest.targets = await generateDrafts(latest);
      saveJob(latest);
      setJobStep(job.id, "generating-platform-drafts", "completed", { percent: 100 });
      results.generateDrafts = latest.targets;
    }

    assertRunNotCancelled(options);
    if (steps.includes("preflight-publish")) {
      setJobStep(job.id, "preflighting-targets", "running", { percent: 0 });
      const latest = loadJob(job.id) || job;
      const preflightResults: Record<string, unknown> = {};
      for (const target of latest.targets) {
        const previousStatus = target.status;
        target.status = "preflighting";
        const preflight = await preflightJobTarget(latest, target.platform);
        preflightResults[target.platform] = preflight;
        if (!preflight.ok) {
          target.status = "failed";
          target.error = preflight.message;
        } else {
          target.status = previousStatus === "published" ? "published" : target.draft ? "drafted" : "pending";
          delete target.error;
        }
      }
      saveJob(latest);
      results.preflight = preflightResults;
      setJobStep(job.id, "preflighting-targets", "completed", { percent: 100 });
      appendJobEvent({
        jobId: job.id,
        level: "info",
        step: "preflighting-targets",
        message: "Publish preflight completed",
        data: { results: preflightResults },
      });
      if (!steps.includes("publish") && loadSettings().publishing.scheduleMode === "scheduled") {
        schedulePublishRun(job.id);
      }
    }

    assertRunNotCancelled(options);
    if (steps.includes("publish")) {
      setJobStep(job.id, "publishing-targets", "running", { percent: 0 });
      const latest = loadJob(job.id) || job;
      const publishResults: Record<string, unknown> = {};
      for (const target of latest.targets) {
        if (target.status === "published" && !options.force) {
          publishResults[target.platform] = { skipped: true, reason: "already published" };
          continue;
        }
        target.status = "publishing";
        saveJob(latest);
        const result = await publishJobTarget(latest, target.platform, Boolean(options.force));
        target.result = result;
        target.status = result.success ? "published" : "failed";
        if (result.error) target.error = result.error;
        else delete target.error;
        publishResults[target.platform] = result;
        saveJob(latest);
      }
      results.publish = publishResults;
      const publishedJob = loadJob(job.id);
      if (publishedJob?.source.metadata?.scheduledPublishAt) {
        const { scheduledPublishAt: _scheduledPublishAt, ...metadata } = publishedJob.source.metadata;
        publishedJob.source.metadata = metadata;
        saveJob(publishedJob);
      }
      setJobStep(job.id, "publishing-targets", "completed", { percent: 100 });
      markCompletedIfAllTargetsPublished(job.id);
    }
  } catch (err) {
    currentRender = null;
    const message = err instanceof Error ? err.message : String(err);
    if (!failCurrentRunningStep(job.id, message)) {
      setJobStep(job.id, "failed", "failed", { error: message });
    }
    throw err;
  }

  return results;
}

async function processJobRunQueue(): Promise<void> {
  if (activeJobRun) return;
  const run = jobRunQueue.shift();
  if (!run) return;

  activeJobRun = run;
  if (cancelledJobRunIds.has(run.id)) {
    run.status = "cancelled";
    run.finishedAt = Date.now();
    cancelledJobRunIds.delete(run.id);
    activeJobRun = null;
    jobRunHistory.push(run);
    void processJobRunQueue();
    return;
  }

  run.status = "running";
  run.startedAt = Date.now();
  run.abortController = new AbortController();
  appendJobEvent({
    jobId: run.jobId,
    level: "info",
    message: "Background job run started",
    data: { runId: run.id, steps: run.steps },
  });

  try {
    await executeJobRun(run.jobId, {
      steps: run.steps,
      force: run.force,
      formatId: run.formatId,
      signal: run.abortController.signal,
    });
    run.status = pausedJobRunIds.has(run.id) ? "paused" : cancelledJobRunIds.has(run.id) ? "cancelled" : "completed";
    appendJobEvent({
      jobId: run.jobId,
      level: run.status === "completed" ? "info" : "warn",
      message:
        run.status === "completed"
          ? "Background job run completed"
          : run.status === "paused"
            ? "Background job run paused"
            : "Background job run cancelled",
      data: { runId: run.id, steps: run.steps },
    });
  } catch (err) {
    run.status = pausedJobRunIds.has(run.id) ? "paused" : cancelledJobRunIds.has(run.id) ? "cancelled" : "failed";
    run.error = err instanceof Error ? err.message : String(err);
    appendJobEvent({
      jobId: run.jobId,
      level: run.status === "failed" ? "error" : "warn",
      message:
        run.status === "failed"
          ? "Background job run failed"
          : run.status === "paused"
            ? "Background job run paused"
            : "Background job run cancelled",
      data: { runId: run.id, error: run.error },
    });
  } finally {
    run.finishedAt = Date.now();
    cancelledJobRunIds.delete(run.id);
    pausedJobRunIds.delete(run.id);
    jobRunHistory.push(run);
    activeJobRun = null;
    void processJobRunQueue();
  }
}

function enqueueJobRun(
  jobId: string,
  options: { steps?: string[]; force?: boolean; formatId?: string } = {}
): QueuedJobRun {
  const existing =
    activeJobRun?.jobId === jobId &&
    !cancelledJobRunIds.has(activeJobRun.id) &&
    !pausedJobRunIds.has(activeJobRun.id)
      ? activeJobRun
      : jobRunQueue.find((run) => run.jobId === jobId && run.status === "queued");
  if (existing) return existing;

  const run: QueuedJobRun = {
    id: `${jobId}_${Date.now()}`,
    jobId,
    steps: options.steps?.length ? options.steps : defaultRunSteps(),
    force: options.force,
    formatId: options.formatId,
    status: "queued",
    createdAt: Date.now(),
  };
  jobRunQueue.push(run);
  appendJobEvent({
    jobId,
    level: "info",
    message: "Background job run queued",
    data: { runId: run.id, steps: run.steps },
  });
  void processJobRunQueue();
  return run;
}

// Serve static UI files
const ui_dir = path.join(__dirname, "ui");
app.use(express.static(ui_dir));

// Serve rendered output files
const outDir = path.join(process.cwd(), "out");
app.use("/out", express.static(outDir));

// ============================================================
// Cross-platform Job API
// ============================================================

async function createJobFromRequest(body: CreateJobRequest) {
  if (!body.source?.url) {
    throw new Error("source.url is required");
  }

  const adapter = resolveSourceAdapter(body.source.url, body.source.platform || "auto");
  if (!adapter) {
    throw new Error(`No source adapter matched url: ${body.source.url}`);
  }
  if (!adapter.implemented) {
    const err = new Error(`${adapter.platform} source adapter is not implemented yet`);
    err.name = "NotImplemented";
    throw err;
  }

  const settings = loadSettings();
  const probe = await adapter.probe(body.source.url);
  cancelJobRunsForJob(createJobId(probe.platform, probe.contentId), "Existing run cancelled before recreating job");
  const repeatTimes = Math.min(10, Math.max(1, Number(body.options?.repeatTimes || 1)));
  const targetCommentCount = calculateTargetCommentCount(probe.durationSec, repeatTimes, settings);
  const targets: NonNullable<CreateJobRequest["targets"]> =
    body.targets?.length
      ? body.targets
      : settings.publishing.defaultPlatforms.map((platform) => ({ platform }));
  const job = createJob(body, probe.platform, probe.contentId);
  job.source = {
    ...job.source,
    platform: probe.platform,
    contentId: probe.contentId,
    author: probe.author,
    language: probe.language,
    metadata: {
      title: probe.title,
      durationSec: probe.durationSec,
      recommended: probe.recommended,
      raw: probe.raw,
    },
  };
  job.targets = targets.map((target) => {
    const existing = job.targets.find((item) => item.platform === target.platform);
    return {
      platform: target.platform,
      status: existing?.status || "pending",
      ...(target.draft ? { draft: target.draft } : existing?.draft ? { draft: existing.draft } : {}),
      ...(existing?.result ? { result: existing.result } : {}),
      ...(existing?.error ? { error: existing.error } : {}),
    };
  });
  job.options = {
    ...job.options,
    targetLanguage: body.options?.targetLanguage || settings.production.subtitleTargetLanguage,
    downloadQuality: body.options?.downloadQuality || job.options.downloadQuality || "auto",
    ...body.options,
    repeatTimes,
    targetCommentCount,
  };
  job.settingsSnapshot = settings;
  saveJob(job);
  setJobStep(job.id, "probing-source", "completed", { percent: 100 });
  appendJobEvent({
    jobId: job.id,
    level: "info",
    step: "probing-source",
    message: `Source probed via ${probe.platform}`,
    data: { title: probe.title, contentId: probe.contentId },
  });

  return { job: loadJob(job.id) || job, probe };
}

app.get("/api/platforms", (_req, res) => {
  res.json(listPlatformCapabilities());
});

app.get("/api/health", async (_req, res) => {
  res.json(await getSystemHealth());
});

app.get("/api/settings", (_req, res) => {
  res.json({ success: true, settings: loadSettings() });
});

app.put("/api/settings", (req, res) => {
  try {
    res.json({ success: true, settings: saveSettings(req.body || {}) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sources/probe", async (req, res) => {
  try {
    const { url, platform = "auto" } = req.body as { url?: string; platform?: string };
    if (!url) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    const adapter = resolveSourceAdapter(url, platform);
    if (!adapter) {
      res.status(400).json({ error: `No source adapter matched url: ${url}` });
      return;
    }
    if (!adapter.implemented) {
      res.status(501).json({ error: `${adapter.platform} source adapter is not implemented yet` });
      return;
    }

    const probe = await adapter.probe(url);
    res.json({ success: true, probe });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/download/formats", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    const platform = String(req.query.platform || "auto");
    if (!url) {
      res.status(400).json({ error: "url query parameter is required" });
      return;
    }

    const adapter = resolveSourceAdapter(url, platform);
    if (!adapter) {
      res.status(400).json({ error: `No source adapter matched url: ${url}` });
      return;
    }
    if (!adapter.implemented) {
      res.status(501).json({ error: `${adapter.platform} source adapter is not implemented yet` });
      return;
    }

    const probe = await adapter.probe(url);
    res.json(probe);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs", async (req, res) => {
  try {
    const body = req.body as CreateJobRequest;
    const result = await createJobFromRequest(body);
    const run = enqueueJobRun(result.job.id);
    res.status(run.status === "queued" ? 202 : 200).json({ success: true, ...result, run, queue: snapshotQueue() });
  } catch (err) {
    const status = err instanceof Error && err.name === "NotImplemented" ? 501 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/workflows/youtube", async (req, res) => {
  try {
    const body: CreateJobRequest = {
      source: { url: req.body?.url || req.body?.source?.url, platform: "youtube" },
      targets: req.body?.targets,
      options: req.body?.options,
      requirement: req.body?.requirement,
    };
    const result = await createJobFromRequest(body);
    const run = enqueueJobRun(result.job.id);
    res.status(run.status === "queued" ? 202 : 200).json({ success: true, ...result, run, queue: snapshotQueue() });
  } catch (err) {
    const status = err instanceof Error && err.name === "NotImplemented" ? 501 : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/jobs", (_req, res) => {
  res.json({ jobs: listJobs() });
});

app.get("/api/jobs/queue", (_req, res) => {
  res.json(snapshotQueue());
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = loadJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ success: true, job });
});

app.get("/api/jobs/:jobId/events", (req, res) => {
  res.json({ events: getJobEvents(req.params.jobId) });
});

app.get("/api/jobs/:jobId/artifact", (req, res) => {
  const job = loadJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const artifactPath = typeof req.query.path === "string" ? req.query.path : "";
  const resolvedPath = path.resolve(artifactPath);
  const rootDir = path.resolve(job.artifacts.rootDir);
  if (!artifactPath || !resolvedPath.startsWith(rootDir + path.sep) || !fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  if (/\.json$/i.test(resolvedPath)) {
    res.json(JSON.parse(fs.readFileSync(resolvedPath, "utf-8")));
    return;
  }
  res.type(path.extname(resolvedPath) || "text/plain").sendFile(resolvedPath);
});

app.post("/api/jobs/:jobId/prepare-preview", (req, res) => {
  const job = loadJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  try {
    const dirInfo = buildJobDirInfo(job);
    preparePublicDir(dirInfo);
    const studioProps = buildStudioProps(job, dirInfo);
    const port = remotionStudioPort();
    res.json({
      success: true,
      composition: "VideoComments",
      publicDir: path.join(process.cwd(), "public"),
      studioUrl: `http://localhost:${port}`,
      studioProps,
      studioCommand: `npm run dev -- --port ${port} --props '${JSON.stringify(studioProps)}'`,
      files: {
        video: dirInfo.videoFile,
        comments: dirInfo.commentFile,
        subtitles: dirInfo.subtitleFiles,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/open-preview", (req, res) => {
  const job = loadJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  try {
    const dirInfo = buildJobDirInfo(job);
    preparePublicDir(dirInfo);
    const studioProps = buildStudioProps(job, dirInfo);
    const studio = startRemotionStudioPreview(job.id, studioProps);
    appendJobEvent({
      jobId: job.id,
      level: "info",
      message: "Remotion Studio preview opened",
      data: { studioUrl: studio.studioUrl, studioProps },
    });
    res.json({
      success: true,
      composition: "VideoComments",
      publicDir: path.join(process.cwd(), "public"),
      studioProps,
      ...studio,
      files: {
        video: dirInfo.videoFile,
        comments: dirInfo.commentFile,
        subtitles: dirInfo.subtitleFiles,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/start", (req, res) => {
  const job = loadJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const steps = Array.isArray(req.body?.steps) ? req.body.steps.map(String) : undefined;
  const run = enqueueJobRun(job.id, {
    steps,
    force: Boolean(req.body?.force),
    formatId: typeof req.body?.formatId === "string" ? req.body.formatId : undefined,
  });
  res.status(run.status === "queued" ? 202 : 200).json({ success: true, run, queue: snapshotQueue() });
});

app.post("/api/jobs/:jobId/retry", (req, res) => {
  const job = loadJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const current = job.workflow.currentStep;
  const status = job.workflow.steps[current]?.status;
  const steps = Array.isArray(req.body?.steps) ? req.body.steps.map(String) : runStepsFromJobStep(current, status);
  const run = enqueueJobRun(job.id, {
    steps,
    force: Boolean(req.body?.force),
    formatId: typeof req.body?.formatId === "string" ? req.body.formatId : undefined,
  });
  res.status(run.status === "queued" ? 202 : 200).json({ success: true, run, queue: snapshotQueue() });
});

app.post("/api/jobs/:jobId/pause", (req, res) => {
  const job = loadJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const run = pauseJobRunsForJob(job.id, "Job paused by user");
  res.json({ success: true, run, job: loadJob(job.id), queue: snapshotQueue() });
});

app.post("/api/jobs/:jobId/resume", (req, res) => {
  const job = loadJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const status = job.workflow.steps[job.workflow.currentStep]?.status;
  const steps = Array.isArray(req.body?.steps) ? req.body.steps.map(String) : runStepsFromJobStep(job.workflow.currentStep, status);
  const run = enqueueJobRun(job.id, {
    steps,
    force: Boolean(req.body?.force),
    formatId: typeof req.body?.formatId === "string" ? req.body.formatId : undefined,
  });
  res.status(run.status === "queued" ? 202 : 200).json({ success: true, run, queue: snapshotQueue() });
});

app.post("/api/jobs/:jobId/cancel", (req, res) => {
  const jobId = req.params.jobId;
  const queuedIndex = jobRunQueue.findIndex((run) => run.jobId === jobId);
  if (queuedIndex !== -1) {
    const [run] = jobRunQueue.splice(queuedIndex, 1);
    run.status = "cancelled";
    run.finishedAt = Date.now();
    jobRunHistory.push(run);
    appendJobEvent({
      jobId,
      level: "warn",
      message: "Queued background job run cancelled",
      data: { runId: run.id },
    });
    res.json({ success: true, run, queue: snapshotQueue() });
    return;
  }

  if (activeJobRun?.jobId === jobId) {
    cancelledJobRunIds.add(activeJobRun.id);
    activeJobRun.abortController?.abort();
    if (currentRender?.taskId === jobId) {
      currentRender.abortController?.abort();
      terminateRenderProcesses();
    }
    setJobStep(jobId, "cancelled", "completed", { percent: 100 });
    appendJobEvent({
      jobId,
      level: "warn",
      message: "Cancellation requested for running background job",
      data: { runId: activeJobRun.id },
    });
    res.json({ success: true, run: activeJobRun, queue: snapshotQueue() });
    return;
  }

  res.status(404).json({ error: "No queued or running job run found" });
});

app.delete("/api/jobs/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  pauseJobRunsForJob(jobId, "Job deleted by user");
  const deleted = deleteJob(jobId);
  if (!deleted) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ success: true, queue: snapshotQueue() });
});

app.post("/api/jobs/:jobId/download", async (req, res) => {
  try {
    let job = loadJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const adapter = resolveSourceAdapter(job.source.url, job.source.platform);
    if (!adapter?.download) {
      res.status(501).json({ error: `${job.source.platform} download adapter is not implemented yet` });
      return;
    }

    setJobStep(job.id, "downloading-source", "running", { percent: 0 });
    appendJobEvent({
      jobId: job.id,
      level: "info",
      step: "downloading-source",
      message: "Source download started",
      data: { platform: job.source.platform },
    });

    const assets = await adapter.download({
      url: job.source.url,
      outputDir: job.artifacts.sourceDir,
      options: job.options,
      formatId: typeof req.body?.formatId === "string" ? req.body.formatId : undefined,
    });

    const latest = loadJob(job.id) || job;
    latest.source.metadata = {
      ...latest.source.metadata,
      assets,
    };
    saveJob(latest);
    setJobStep(job.id, "downloading-source", "completed", { percent: 100 });
    appendJobEvent({
      jobId: job.id,
      level: "info",
      step: "downloading-source",
      message: "Source download completed",
      data: { assets },
    });

    res.json({ success: true, job: loadJob(job.id), assets });
  } catch (err) {
    setJobStep(req.params.jobId, "downloading-source", "failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    appendJobEvent({
      jobId: req.params.jobId,
      level: "error",
      step: "downloading-source",
      message: "Source download failed",
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/normalize", (req, res) => {
  try {
    let job = loadJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    setJobStep(job.id, "normalizing-assets", "running", { percent: 0 });
    const normalizedAssets = normalizeJobAssets(job);
    const latest = loadJob(job.id) || job;
    latest.source.metadata = {
      ...latest.source.metadata,
      normalizedAssets,
    };
    saveJob(latest);
    setJobStep(job.id, "normalizing-assets", "completed", { percent: 100 });
    appendJobEvent({
      jobId: job.id,
      level: "info",
      step: "normalizing-assets",
      message: "Assets normalized",
      data: { normalizedAssets },
    });

    res.json({ success: true, job: loadJob(job.id), normalizedAssets });
  } catch (err) {
    setJobStep(req.params.jobId, "normalizing-assets", "failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    appendJobEvent({
      jobId: req.params.jobId,
      level: "error",
      step: "normalizing-assets",
      message: "Asset normalization failed",
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/render", async (req, res) => {
  try {
    const job = loadJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (currentRender) {
      res.status(409).json({ error: "已有任务正在渲染中，请等待完成后再试", currentRender });
      return;
    }

    const abortController = new AbortController();
    currentRender = { name: job.id, progress: null, abortController, taskId: job.id };
    setJobStep(job.id, "rendering-video", "running", { percent: 0 });
    appendJobEvent({
      jobId: job.id,
      level: "info",
      step: "rendering-video",
      message: "Job render started",
    });

    const handleProgress = (progress: { stage: string; percent: number; message: string }) => {
      if (currentRender) currentRender.progress = progress;
      setJobStep(job.id, "rendering-video", "running", { percent: progress.percent });
    };

    try {
      const result = await renderJob(job, handleProgress, abortController.signal);
      const latest = loadJob(job.id) || job;
      latest.artifacts.outputVideo = result.outputPath;
      latest.artifacts.coverImage = result.coverPath;
      saveJob(latest);
      setJobStep(job.id, "rendering-video", "completed", { percent: 100 });
      appendJobEvent({
        jobId: job.id,
        level: "info",
        step: "rendering-video",
        message: "Job render completed",
        data: { ...result },
      });
      res.json({ success: true, job: loadJob(job.id), result });
    } catch (err) {
      setJobStep(job.id, "rendering-video", "failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      appendJobEvent({
        jobId: job.id,
        level: "error",
        step: "rendering-video",
        message: "Job render failed",
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      currentRender = null;
    }
  } catch (err) {
    currentRender = null;
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/run", async (req, res) => {
  try {
    const job = loadJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const steps: string[] = Array.isArray(req.body?.steps)
      ? req.body.steps
      : defaultRunSteps();
    const results = await executeJobRun(job.id, {
      steps,
      force: Boolean(req.body?.force),
      formatId: typeof req.body?.formatId === "string" ? req.body.formatId : undefined,
    });

    appendJobEvent({
      jobId: job.id,
      level: "info",
      message: "Job runner completed requested steps",
      data: { steps },
    });
    res.json({ success: true, job: loadJob(job.id), results });
  } catch (err) {
    currentRender = null;
    appendJobEvent({
      jobId: req.params.jobId,
      level: "error",
      message: "Job runner failed",
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/translate", async (req, res) => {
  try {
    const job = loadJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    setJobStep(job.id, "translating-assets", "running", { percent: 0 });
    const translation = await translateJobAssets(job);
    const latest = loadJob(job.id) || job;
    latest.source.metadata = { ...latest.source.metadata, translation };
    saveJob(latest);
    const skipped =
      translation.comments.status === "skipped" && translation.subtitles.status === "skipped";
    setJobStep(job.id, "translating-assets", skipped ? "skipped" : "completed", { percent: 100 });
    appendJobEvent({
      jobId: job.id,
      level: "info",
      step: "translating-assets",
      message: skipped ? "No translatable assets found" : "Assets translated",
      data: { translation },
    });
    res.json({ success: true, job: loadJob(job.id), translation });
  } catch (err) {
    setJobStep(req.params.jobId, "translating-assets", "failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    appendJobEvent({
      jobId: req.params.jobId,
      level: "error",
      step: "translating-assets",
      message: "Translation failed",
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/drafts/generate", async (req, res) => {
  try {
    const job = loadJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    setJobStep(job.id, "generating-platform-drafts", "running", { percent: 0 });
    job.targets = await generateDrafts(job);
    saveJob(job);
    setJobStep(job.id, "generating-platform-drafts", "completed", { percent: 100 });
    appendJobEvent({
      jobId: job.id,
      level: "info",
      step: "generating-platform-drafts",
      message: "Platform drafts generated",
    });
    res.json({ success: true, job: loadJob(job.id), targets: job.targets });
  } catch (err) {
    setJobStep(req.params.jobId, "generating-platform-drafts", "failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/preflight-publish", async (req, res) => {
  try {
    const job = loadJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    setJobStep(job.id, "preflighting-targets", "running", { percent: 0 });
    const results: Record<string, unknown> = {};
    for (const target of job.targets) {
      const previousStatus = target.status;
      target.status = "preflighting";
      const result = await preflightJobTarget(job, target.platform);
      results[target.platform] = result;
      if (!result.ok) {
        target.status = "failed";
        target.error = result.message;
      } else if (previousStatus !== "published") {
        target.status = target.draft ? "drafted" : "pending";
        delete target.error;
      }
    }
    saveJob(job);
    setJobStep(job.id, "preflighting-targets", "completed", { percent: 100 });
    appendJobEvent({
      jobId: job.id,
      level: "info",
      step: "preflighting-targets",
      message: "Publish preflight completed",
      data: { results },
    });
    res.json({ success: true, job: loadJob(job.id), results });
  } catch (err) {
    setJobStep(req.params.jobId, "preflighting-targets", "failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/jobs/:jobId/publish", async (req, res) => {
  try {
    const initialJob = loadJob(req.params.jobId);
    if (!initialJob) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    let job = initialJob;
    setJobStep(job.id, "publishing-targets", "running", { percent: 0 });
    job = loadJob(job.id) || job;
    const platforms = Array.isArray(req.body?.platforms)
      ? req.body.platforms.map(String)
      : job.targets.map((target) => target.platform);
    const results: Record<string, unknown> = {};

    for (const target of job.targets) {
      if (!platforms.includes(target.platform)) continue;
      if (target.status === "published" && !req.body?.force) {
        results[target.platform] = { skipped: true, reason: "already published" };
        continue;
      }
      job = loadJob(job.id) || job;
      const latestTarget = job.targets.find((item) => item.platform === target.platform);
      if (!latestTarget) continue;
      latestTarget.status = "publishing";
      saveJob(job);
      const result = await publishJobTarget(job, latestTarget.platform, Boolean(req.body?.force));
      const next = loadJob(job.id) || job;
      const nextTarget = next.targets.find((item) => item.platform === latestTarget.platform);
      if (!nextTarget) continue;
      nextTarget.result = result;
      nextTarget.status = result.success ? "published" : "failed";
      if (result.error) nextTarget.error = result.error;
      else delete nextTarget.error;
      results[latestTarget.platform] = result;
      job = next;
      saveJob(job);
    }

    setJobStep(job.id, "publishing-targets", "completed", { percent: 100 });
    markCompletedIfAllTargetsPublished(job.id);
    appendJobEvent({
      jobId: job.id,
      level: "info",
      step: "publishing-targets",
      message: "Publish completed",
      data: { results },
    });
    res.json({ success: true, job: loadJob(job.id), results });
  } catch (err) {
    setJobStep(req.params.jobId, "publishing-targets", "failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    appendJobEvent({
      jobId: req.params.jobId,
      level: "error",
      step: "publishing-targets",
      message: "Publish failed",
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================
// Browser and translation management APIs
// ============================================================

app.get("/api/browser/status", async (_req, res) => {
  res.json(await getBrowserStatus());
});

app.post("/api/browser/start", async (_req, res) => {
  res.json(await startBrowser());
});

app.post("/api/browser/stop", async (_req, res) => {
  res.json(await stopBrowser());
});

app.post("/api/browser/restart", async (_req, res) => {
  await stopBrowser();
  res.json(await startBrowser());
});

app.get("/api/browser/health", async (_req, res) => {
  res.json(await getBrowserHealth());
});

app.get("/api/browser/login/:platform", async (req, res) => {
  try {
    const platform = req.params.platform as "bilibili" | "douyin";
    if (!["bilibili", "douyin"].includes(platform)) {
      res.status(400).json({ error: "Unsupported platform" });
      return;
    }
    res.json(await checkPlatformLogin(platform));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/browser/open-login/:platform", async (req, res) => {
  try {
    const platform = req.params.platform as "bilibili" | "douyin";
    if (!["bilibili", "douyin"].includes(platform)) {
      res.status(400).json({ error: "Unsupported platform" });
      return;
    }
    res.json(await openPlatformLogin(platform));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/translate/providers", (_req, res) => {
  res.json({ providers: listTranslateProviders() });
});

app.post("/api/translate/test", async (req, res) => {
  try {
    const translated = await translateText({
      text: req.body?.text || "Hello world",
      sourceLanguage: req.body?.sourceLanguage,
      targetLanguage: req.body?.targetLanguage || "zh-CN",
      systemPrompt: req.body?.systemPrompt,
    });
    res.json({ success: true, translated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================
// Agent API: single endpoint to render a video folder
// POST /api/render-folder
// Body: { "folder": "/absolute/path/to/folder" }
// Returns: { "outputPath": "/full/system/path/to/output.mp4" }
// ============================================================

// TEST: Direct openBrowser in Express handler
app.get("/api/test-browser", async (req, res) => {
  const fs = await import("fs");
  try {
    fs.default.appendFileSync("/tmp/express-ob-test.log", "Handler called\n");
    const { openBrowser } = await import("@remotion/renderer");
    fs.default.appendFileSync("/tmp/express-ob-test.log", "Calling openBrowser...\n");
    const browser = await openBrowser("chrome", { logLevel: "info" });
    fs.default.appendFileSync("/tmp/express-ob-test.log", "SUCCESS\n");
    await browser.close({ silent: true });
    res.json({ success: true });
  } catch(e) {
    const message = e instanceof Error ? e.message : String(e);
    fs.default.appendFileSync("/tmp/express-ob-test.log", "FAIL: " + message.substring(0, 2000) + "\n");
    res.status(500).json({ error: message.substring(0, 500) });
  }
});

app.post("/api/render-folder", async (req, res) => {
  const { folder } = req.body;
  if (!folder || typeof folder !== "string") {
    res.status(400).json({ error: "Missing or invalid 'folder' field in request body" });
    return;
  }

  const dir = scanDir(folder);
  if (!dir) {
    res.status(404).json({ error: `No video file found in: ${folder}` });
    return;
  }

  if (currentRender) {
    const msg = currentRender.name === dir.name
      ? "该视频正在渲染，请勿重复请求"
      : "已有任务正在渲染中，请等待完成后再试";
    res.status(409).json({ error: msg, currentRender });
    return;
  }

  // 检查输出文件是否已存在
  const existingOutput = path.join(process.cwd(), "out", `${dir.name}.mp4`);
  if (fs.existsSync(existingOutput) && !req.body?.force) {
    res.status(409).json({ error: "该视频已有渲染输出文件，如需重新渲染请添加 force: true 参数", outputPath: existingOutput });
    return;
  }

  const abortController = new AbortController();
  const taskId = dir.name;
  currentRender = { name: dir.name, progress: null, abortController, taskId };
  console.log(`[Agent API] Rendering: ${dir.path}`);

  updateTask(taskId, { renderStatus: "rendering" });

  try {
    if (isSSERequest(req)) {
      const sse = setupSSE(res);
      try {
        const result = await render(dir, (p) => { if (currentRender) currentRender.progress = p; sse.sendProgress(p); }, abortController.signal);
        const outputPath = path.resolve(process.cwd(), result.output);
        console.log(`[Agent API] Done: ${outputPath}`);
        updateTask(taskId, { renderStatus: "completed" });
        sse.sendEvent("done", { outputPath });
      } catch (err: any) {
        if (abortController.signal.aborted) {
          console.log(`[Agent API] Render stopped: ${dir.name}`);
          updateTask(taskId, { renderStatus: "pending" });
          sse.sendEvent("stopped", { message: "渲染已停止" });
        } else {
          console.error(`[Agent API] Error: ${err?.message || err}`);
          updateTask(taskId, { renderStatus: "failed" });
          sse.sendEvent("error", { error: err?.message || String(err) });
        }
      }
      sse.end();
    } else {
      try {
        const result = await render(dir, (p) => { if (currentRender) currentRender.progress = p; }, abortController.signal);
        const outputPath = path.resolve(process.cwd(), result.output);
        console.log(`[Agent API] Done: ${outputPath}`);
        updateTask(taskId, { renderStatus: "completed" });
        res.json({ outputPath });
      } catch (err: any) {
        if (abortController.signal.aborted) {
          console.log(`[Agent API] Render stopped: ${dir.name}`);
          updateTask(taskId, { renderStatus: "pending" });
          res.json({ stopped: true });
        } else {
          console.error(`[Agent API] Error: ${err?.message || err}`);
          updateTask(taskId, { renderStatus: "failed" });
          res.status(500).json({ error: err?.message || String(err) });
        }
      }
    }
  } finally {
    currentRender = null;
  }
});

// Prepare public dir for Remotion Studio preview
app.post("/api/prepare/:dirName", (_req, res) => {
  const dir = getDirByName(_req.params.dirName);
  if (!dir) {
    res.status(404).json({ error: "目录不存在" });
    return;
  }
  try {
    preparePublicDir(dir);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Get available directories
app.get("/api/dirs", (_req, res) => {
  try {
    const dirs = getDirs();
    res.json(
      dirs.map((d) => ({
        name: d.name,
        hasComments: !!d.commentFile,
        hasSubtitles: d.subtitleFiles.length > 0,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Serve source video for preview
app.get("/api/preview/:dirName", (req, res) => {
  const dir = getDirByName(req.params.dirName);
  if (!dir || !dir.videoFile) {
    res.status(404).json({ error: "视频不存在" });
    return;
  }
  const videoPath = dir.videoFile;
  if (!fs.existsSync(videoPath)) {
    res.status(404).json({ error: "视频文件不存在" });
    return;
  }
  const stat = fs.statSync(videoPath);
  const ext = path.extname(videoPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };
  res.setHeader("Content-Type", mimeMap[ext] || "video/mp4");
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(videoPath).pipe(res);
});

// Start rendering (by dir name under ~/Movies)
app.post("/api/render/:dirName", async (req, res) => {
  const { dirName } = req.params;
  const dir = getDirByName(dirName);

  if (!dir) {
    res.status(404).json({ error: `目录不存在: ${dirName}` });
    return;
  }

  if (currentRender) {
    const msg = currentRender.name === dirName
      ? "该视频正在渲染，请勿重复请求"
      : "已有任务正在渲染中，请等待完成后再试";
    res.status(409).json({ error: msg, currentRender });
    return;
  }

  // 检查输出文件是否已存在
  const existingOutput = path.join(process.cwd(), "out", `${dirName}.mp4`);
  if (fs.existsSync(existingOutput) && !req.body?.force) {
    res.status(409).json({ error: "该视频已有渲染输出文件，如需重新渲染请添加 force: true 参数", outputPath: existingOutput });
    return;
  }

  const abortController = new AbortController();
  const taskId = dirName;
  currentRender = { name: dirName, progress: null, abortController, taskId };

  updateTask(taskId, { renderStatus: "rendering" });

  try {
    if (isSSERequest(req)) {
      const sse = setupSSE(res);
      try {
        const result = await render(dir, (p) => { if (currentRender) currentRender.progress = p; sse.sendProgress(p); }, abortController.signal);
        updateTask(taskId, { renderStatus: "completed" });
        sse.sendEvent("done", { success: true, output: result.output, durationSec: result.durationSec });
      } catch (err: any) {
        if (abortController.signal.aborted) {
          updateTask(taskId, { renderStatus: "pending" });
          sse.sendEvent("stopped", { message: "渲染已停止" });
        } else {
          updateTask(taskId, { renderStatus: "failed" });
          sse.sendEvent("error", { error: err?.message || String(err) });
        }
      }
      sse.end();
    } else {
      try {
        const result = await render(dir, (p) => { if (currentRender) currentRender.progress = p; }, abortController.signal);
        updateTask(taskId, { renderStatus: "completed" });
        res.json({ success: true, output: result.output, durationSec: result.durationSec });
      } catch (err: any) {
        if (abortController.signal.aborted) {
          updateTask(taskId, { renderStatus: "pending" });
          res.json({ stopped: true });
        } else {
          updateTask(taskId, { renderStatus: "failed" });
          res.status(500).json({ error: err?.message || String(err) });
        }
      }
    }
  } finally {
    currentRender = null;
  }
});

// ============================================================
// Agent API: stop current rendering
// POST /api/render-stop
// ============================================================
app.post("/api/render-stop", (_req, res) => {
  if (!currentRender) {
    res.status(404).json({ error: "当前没有正在渲染的任务" });
    return;
  }
  const name = currentRender.name;
  const taskId = currentRender.taskId;
  currentRender.abortController?.abort();
  currentRender = null;
  if (taskId) updateTask(taskId, { renderStatus: "pending" });
  console.log(`[Render Stop] Stopped: ${name}`);
  res.json({ success: true, message: `已停止渲染: ${name}` });
});

// ============================================================
// Agent API: publish video to platforms
// POST /api/publish
// Body: { videoPath, platforms, bilibili?, douyin?, cdpEndpoint? }
// Returns: SSE stream with progress events
// ============================================================
app.post("/api/publish", async (req, res) => {
  const body = req.body as PublishRequest;

  if (!body.videoPath) {
    res.status(400).json({ error: "Missing videoPath" });
    return;
  }

  const targetPlatforms = (body.bilibili ? ["bilibili"] : []).concat(body.douyin ? ["douyin"] : []);
  if (!targetPlatforms.length) {
    res.status(400).json({ error: "请至少提供 bilibili 或 douyin 的发布配置" });
    return;
  }

  console.log(`[Publish API] Publishing ${body.videoPath} to ${targetPlatforms.join(", ")}`);

  const taskId = path.basename(body.videoPath, path.extname(body.videoPath));

  const markTaskPublished = async (results: Record<string, { success: boolean; error?: string }>) => {
    const task = getTaskById(taskId);
    if (!task) {
      console.warn(`[Publish API] Task ${taskId} not found, skipping status update`);
      return;
    }

    const publishStatus = { ...task.publishStatus };
    let changed = false;
    if (results.bilibili?.success) {
      publishStatus.bilibili = {
        title: body.bilibili?.title || "",
        description: body.bilibili?.description || "",
        tags: body.bilibili?.tags || [],
        category: body.bilibili?.category,
        published: true,
      };
      changed = true;
    }
    if (results.douyin?.success) {
      publishStatus.douyin = {
        title: body.douyin?.title || "",
        description: body.douyin?.description || "",
        published: true,
      };
      changed = true;
    }

    if (changed) {
      updateTask(taskId, { publishStatus });
      console.log(`[Publish API] Task ${taskId} publish status updated`);
    }
  };

  if (isSSERequest(req)) {
    const sse = setupSSE(res);
    try {
      const results = await publish(body, (p) => sse.sendProgress(p));
      await markTaskPublished(results);
      sse.sendEvent("done", { results });
      console.log(`[Publish API] Done:`, JSON.stringify(results));
    } catch (err: any) {
      console.error(`[Publish API] Error: ${err?.message || err}`);
      sse.sendEvent("error", { error: err?.message || String(err) });
    }
    sse.end();
  } else {
    try {
      const results = await publish(body, () => {});
      await markTaskPublished(results);
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  }
});

// ============================================================
// Task Management API
// ============================================================

// Create a new publish task
app.post("/api/tasks", (req, res) => {
  try {
    const { originalUrl, requirement, initialStatus } = req.body as AddTaskRequest;
    if (!originalUrl) {
      res.status(400).json({ error: "originalUrl is required" });
      return;
    }
    const task = createTask(originalUrl, requirement, initialStatus);
    res.json({ success: true, task });
  } catch (err) {
    console.error("[Tasks API] Error creating task:", err);
    res.status(500).json({ error: String(err) });
  }
});

// List tasks (with optional filters)
app.get("/api/tasks", (req, res) => {
  try {
    const filter: TaskFilter = {};
    if (req.query.status) filter.status = req.query.status as any;
    if (req.query.platform) filter.platform = req.query.platform as any;
    if (req.query.published !== undefined)
      filter.published = req.query.published === "true";
    if (req.query.since)
      filter.since = parseInt(req.query.since as string);

    const tasks = getAllTasks(filter);
    const pending = tasks.filter((t) => !isTaskComplete(t)).length;

    res.json({ tasks, total: tasks.length, pending });
  } catch (err) {
    console.error("[Tasks API] Error fetching tasks:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Get a specific task
app.get("/api/tasks/stats", (_req, res) => {
  try {
    const stats = getTaskStatistics();
    res.json(stats);
  } catch (err) {
    console.error("[Tasks API] Error fetching statistics:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/tasks/:taskId", (req, res) => {
  try {
    const task = getTaskById(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({
      success: true,
      task,
      isCompleted: isTaskComplete(task),
      progress: getTaskProgress(task),
    });
  } catch (err) {
    console.error("[Tasks API] Error fetching task:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Update a task (only downloadStatus and translationStatus; renderStatus/publishStatus are managed internally)
app.put("/api/tasks/:taskId", (req, res) => {
  try {
    const raw = req.body?.updates;
    if (!raw) {
      res.status(400).json({ error: "updates field is required" });
      return;
    }
    const { downloadStatus, translationStatus } = raw;
    const updates: any = {};
    if (downloadStatus) updates.downloadStatus = downloadStatus;
    if (translationStatus) updates.translationStatus = translationStatus;
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "Only downloadStatus and translationStatus can be updated externally" });
      return;
    }
    const task = updateTask(req.params.taskId, updates);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({
      success: true,
      task,
      isCompleted: isTaskComplete(task),
      progress: getTaskProgress(task),
    });
  } catch (err) {
    console.error("[Tasks API] Error updating task:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Delete a task
app.delete("/api/tasks/:taskId", (req, res) => {
  try {
    const success = deleteTask(req.params.taskId);
    if (!success) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Tasks API] Error deleting task:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Manual cleanup of expired tasks
app.post("/api/tasks/cleanup", (_req, res) => {
  try {
    const removedCount = cleanupExpiredTasks();
    res.json({ success: true, removedCount });
  } catch (err) {
    console.error("[Tasks API] Error cleaning up tasks:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  syncRenderStatus();
  recoverInterruptedJobRuns();
  console.log(`\n  视频渲染服务已启动: http://localhost:${PORT}`);
  console.log(`  Agent API: POST /api/render-folder  { "folder": "/path/to/video/folder" }`);
  console.log(`  Agent API: POST /api/publish        { "videoPath": "...", "platforms": ["bilibili","douyin"] }`);
  console.log(`  Task API:   GET/POST/PUT/DELETE /api/tasks\n`);
});
