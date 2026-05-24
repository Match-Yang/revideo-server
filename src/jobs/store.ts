import fs from "fs";
import path from "path";
import { JOBS_DIR } from "../config";
import type {
  CreateJobRequest,
  JobArtifacts,
  JobStep,
  RevideoJob,
  StepStatus,
  TargetStatus,
  WorkflowStepState,
} from "./types";

const JOB_INDEX_FILE = path.join(JOBS_DIR, "index.json");
const ORDERED_WORKFLOW_STEPS: JobStep[] = [
  "created",
  "probing-source",
  "downloading-source",
  "normalizing-assets",
  "translating-assets",
  "moderating-assets",
  "rendering-video",
  "generating-platform-drafts",
  "preflighting-targets",
  "publishing-targets",
  "completed",
];

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

export function createJobId(platform: string, contentId?: string): string {
  const suffix = contentId ? safeId(contentId) : `${Date.now()}`;
  return `${platform}_${suffix}`;
}

function createArtifacts(jobId: string): JobArtifacts {
  const rootDir = path.join(JOBS_DIR, jobId);
  return {
    rootDir,
    manifestPath: path.join(rootDir, "manifest.json"),
    sourceDir: path.join(rootDir, "source"),
    derivedDir: path.join(rootDir, "derived"),
    publishDir: path.join(rootDir, "publish"),
  };
}

function ensureJobDirs(artifacts: JobArtifacts): void {
  ensureDir(artifacts.rootDir);
  ensureDir(path.join(artifacts.sourceDir, "media"));
  ensureDir(path.join(artifacts.sourceDir, "metadata"));
  ensureDir(path.join(artifacts.sourceDir, "subtitles"));
  ensureDir(path.join(artifacts.sourceDir, "comments"));
  ensureDir(path.join(artifacts.derivedDir, "render"));
  ensureDir(path.join(artifacts.derivedDir, "copy"));
  ensureDir(artifacts.publishDir);
}

function readIndex(): string[] {
  ensureDir(JOBS_DIR);
  if (!fs.existsSync(JOB_INDEX_FILE)) {
    fs.writeFileSync(JOB_INDEX_FILE, JSON.stringify({ jobs: [] }, null, 2));
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(JOB_INDEX_FILE, "utf-8")) as { jobs?: string[] };
  return raw.jobs || [];
}

function writeIndex(jobIds: string[]): void {
  ensureDir(JOBS_DIR);
  fs.writeFileSync(JOB_INDEX_FILE, JSON.stringify({ jobs: jobIds }, null, 2));
}

export function saveJob(job: RevideoJob): RevideoJob {
  ensureJobDirs(job.artifacts);
  job.updatedAt = Date.now();
  fs.writeFileSync(job.artifacts.manifestPath, JSON.stringify(job, null, 2));

  const ids = readIndex();
  if (!ids.includes(job.id)) {
    ids.push(job.id);
    writeIndex(ids);
  }

  return job;
}

export function loadJob(jobId: string): RevideoJob | null {
  const manifestPath = path.join(JOBS_DIR, jobId, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as RevideoJob;
}

export function listJobs(): RevideoJob[] {
  return readIndex()
    .map(loadJob)
    .filter((job): job is RevideoJob => Boolean(job))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createJob(req: CreateJobRequest, platform: string, contentId?: string): RevideoJob {
  const jobId = createJobId(platform, contentId);
  const now = Date.now();
  const artifacts = createArtifacts(jobId);
  if (fs.existsSync(artifacts.rootDir)) {
    fs.rmSync(artifacts.rootDir, { recursive: true, force: true });
  }
  const stepState: WorkflowStepState = {
    step: "created",
    status: "completed",
    percent: 100,
    attempts: 1,
    startedAt: now,
    finishedAt: now,
  };

  const job: RevideoJob = {
    id: jobId,
    source: {
      platform: platform as RevideoJob["source"]["platform"],
      url: req.source.url,
      contentId,
    },
    targets: (req.targets || [{ platform: "bilibili" }]).map((target) => ({
      platform: target.platform,
      status: "pending" as TargetStatus,
      ...(target.draft ? { draft: target.draft } : {}),
    })),
    options: {
      targetLanguage: "zh-CN",
      renderTemplate: "comments-reaction",
      downloadQuality: "auto",
      ...req.options,
    },
    workflow: {
      currentStep: "created",
      steps: { created: stepState },
    },
    artifacts,
    ...(req.requirement ? { requirement: req.requirement } : {}),
    createdAt: now,
    updatedAt: now,
  };

  return saveJob(job);
}

export function setJobStep(
  jobId: string,
  step: JobStep,
  status: StepStatus,
  patch: Partial<WorkflowStepState> = {}
): RevideoJob | null {
  const job = loadJob(jobId);
  if (!job) return null;

  const prev = job.workflow.steps[step];
  const now = Date.now();
  job.workflow.currentStep = step;
  if (status === "running") {
    const stepIndex = ORDERED_WORKFLOW_STEPS.indexOf(step);
    if (stepIndex >= 0) {
      for (const futureStep of ORDERED_WORKFLOW_STEPS.slice(stepIndex + 1)) {
        delete job.workflow.steps[futureStep];
      }
    }
  }
  job.workflow.steps[step] = {
    step,
    status,
    percent: patch.percent ?? prev?.percent ?? (status === "completed" ? 100 : 0),
    attempts: patch.attempts ?? prev?.attempts ?? 1,
    startedAt: patch.startedAt ?? prev?.startedAt ?? now,
    ...(status === "completed" || status === "failed" || status === "skipped"
      ? { finishedAt: patch.finishedAt ?? now }
      : {}),
    ...(patch.error ? { error: patch.error } : {}),
  };

  return saveJob(job);
}
