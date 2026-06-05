"use client";

import * as React from "react";

import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  Gauge,
  GitBranch,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Rocket,
  Search,
  Settings,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/utils";

type DashboardView = "overview" | "jobs" | "queue" | "publishing" | "health" | "browser" | "settings";

type JobStatus = "created" | "running" | "publishing" | "paused" | "completed" | "failed" | "cancelled";
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface WorkflowStepState {
  status?: string;
  percent?: number;
  error?: string;
}

interface RevideoJob {
  id: string;
  source: {
    platform?: string;
    url?: string;
    author?: string;
    metadata?: Record<string, JsonValue>;
  };
  targets: Array<{ platform: string; status: string; error?: string; result?: JsonValue; draft?: JsonValue }>;
  options: {
    repeatTimes?: number;
    targetCommentCount?: number;
    downloadQuality?: string;
    renderComments?: boolean;
  };
  workflow?: {
    currentStep?: string;
    steps?: Record<string, WorkflowStepState>;
  };
  artifacts?: {
    sourceDir?: string;
    outputVideo?: string;
    coverImage?: string;
    coverImagePortrait?: string;
  };
  createdAt?: number;
  updatedAt?: number;
}

interface QueueRun {
  id: string;
  jobId: string;
  status: string;
  steps?: string[];
  createdAt?: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

interface SettingsShape {
  download?: Record<string, JsonValue>;
  production?: Record<string, JsonValue>;
  publishing?: Record<string, JsonValue>;
  browser?: Record<string, JsonValue>;
}

interface BrowserStatus {
  installed?: boolean;
  running?: boolean;
  cdpUrl?: string;
  executablePath?: string;
  error?: string;
}

interface HealthStatus {
  ok?: boolean;
  dependencies?: Array<{ name: string; ok: boolean; version?: string; error?: string }>;
}

interface QueueShape {
  active?: QueueRun | null;
  queued?: QueueRun[];
  scheduled?: QueueRun[];
  recent?: QueueRun[];
}

const workflowOrder = [
  "probing-source",
  "downloading-source",
  "normalizing-assets",
  "translating-assets",
  "generating-cover-image",
  "rendering-video",
  "generating-platform-drafts",
  "preflighting-targets",
  "publishing-targets",
];

const platformNames: Record<string, string> = {
  youtube: "YouTube",
  bilibili: "Bilibili",
  douyin: "Douyin",
  tiktok: "TikTok",
  xiaohongshu: "Xiaohongshu",
  instagram: "Instagram",
  x: "X",
};

const targetPlatforms = ["bilibili", "douyin", "youtube", "tiktok", "xiaohongshu", "instagram", "x"];

const languages = [
  "zh-CN",
  "en",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "ru",
];

function getNested<T>(source: unknown, path: string, fallback: T): T {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
  return (value as T | undefined) ?? fallback;
}

function currentStep(job: RevideoJob) {
  return job.workflow?.currentStep ?? "created";
}

function queueStatusForJob(jobId: string, queue: QueueShape) {
  if (queue.active?.jobId === jobId) return queue.active.status || "running";
  if ((queue.queued ?? []).some((run) => run.jobId === jobId)) return "queued";
  if ((queue.scheduled ?? []).some((run) => run.jobId === jobId)) return "scheduled";
  return "";
}

function effectiveWorkflowCursor(job: RevideoJob) {
  const steps = job.workflow?.steps ?? {};
  const runningIndex = workflowOrder.findIndex((step) => steps[step]?.status === "running");
  if (runningIndex >= 0) return { step: workflowOrder[runningIndex], index: runningIndex, status: "running" };
  const failedIndex = workflowOrder.findIndex((step) => steps[step]?.status === "failed");
  if (failedIndex >= 0) return { step: workflowOrder[failedIndex], index: failedIndex, status: "failed" };
  if (currentStep(job) === "completed") return { step: "completed", index: workflowOrder.length, status: "completed" };
  const index = workflowOrder.indexOf(currentStep(job));
  return {
    step: currentStep(job),
    index: index >= 0 ? index : -1,
    status: steps[currentStep(job)]?.status || "pending",
  };
}

function derivedStatus(job: RevideoJob, queue: QueueShape): JobStatus {
  const queueStatus = queueStatusForJob(job.id, queue);
  if (queueStatus === "running" || queueStatus === "queued") {
    return job.targets?.some((target) => target.status === "publishing") ? "publishing" : "running";
  }
  if (queueStatus === "scheduled") return "paused";
  if (currentStep(job) === "completed") return "completed";
  if (currentStep(job) === "cancelled") return "cancelled";
  const cursor = effectiveWorkflowCursor(job);
  if (cursor.status === "failed" || currentStep(job) === "failed" || job.targets?.some((target) => target.status === "failed")) {
    return "failed";
  }
  if (cursor.step === "publishing-targets" || job.targets?.some((target) => target.status === "publishing")) return "publishing";
  if (cursor.status === "running") return "running";
  if (["created", "probing-source"].includes(currentStep(job))) return "created";
  if (cursor.status === "completed" || cursor.status === "skipped" || cursor.status === "paused") return "paused";
  return "paused";
}

function statusBadge(status: JobStatus | string, t: (key: string) => string) {
  const iconClass = "size-3";
  const label = t(`status.${status}`);
  if (status === "completed") return <Badge className="bg-emerald-600 text-white"><CheckCircle2 className={iconClass} /> {label}</Badge>;
  if (status === "failed" || status === "cancelled") return <Badge variant="destructive"><XCircle className={iconClass} /> {label}</Badge>;
  if (status === "running" || status === "publishing") return <Badge><Loader2 className={cn(iconClass, "animate-spin")} /> {label}</Badge>;
  if (status === "queued" || status === "scheduled") return <Badge variant="secondary">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

function stepProgress(job: RevideoJob) {
  if (currentStep(job) === "completed") return 100;
  const cursor = effectiveWorkflowCursor(job);
  if (cursor.index < 0) return 0;
  const base = (cursor.index / workflowOrder.length) * 100;
  const stepPercent = (job.workflow?.steps?.[cursor.step]?.percent || 0) / workflowOrder.length;
  return Math.min(99, Math.round(base + stepPercent));
}

function formatTime(value: number | undefined, locale: string) {
  return value ? new Date(value).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") : "-";
}

function outputHref(output?: string) {
  if (!output) return "";
  const index = output.lastIndexOf("/out/");
  if (index >= 0) return output.slice(index);
  if (output.startsWith("out/")) return `/${output}`;
  return output;
}

function jobTitle(job: RevideoJob) {
  const title = job.source?.metadata?.title;
  if (typeof title === "string" || typeof title === "number") return String(title);
  return job.id;
}

function stringArray(value: JsonValue | undefined, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function formString(data: FormData, key: string, fallback = "") {
  const value = data.get(key);
  return typeof value === "string" ? value : fallback;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || text || response.statusText);
  return data;
}

function PageHeader({ icon: Icon, title, description, action }: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <div>
          <h1 className="font-heading font-medium text-2xl tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, hint, tone }: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  hint: string;
  tone?: "danger" | "success";
}) {
  return (
    <Card className="bg-linear-to-t from-primary/5 to-card shadow-xs">
      <CardHeader>
        <CardTitle>
          <div className="flex size-7 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
        </CardTitle>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1">
        <div className={cn("font-medium text-3xl tabular-nums leading-none tracking-tight", tone === "danger" && "text-destructive", tone === "success" && "text-emerald-600")}>
          {value}
        </div>
        <p className="text-muted-foreground text-sm">{hint}</p>
      </CardContent>
    </Card>
  );
}

export function RevideoConsole({ view }: { view: DashboardView }) {
  const { locale, t } = useI18n();
  const [jobs, setJobs] = React.useState<RevideoJob[]>([]);
  const [queue, setQueue] = React.useState<QueueShape>({ active: null, queued: [], scheduled: [], recent: [] });
  const [settings, setSettings] = React.useState<SettingsShape | null>(null);
  const [browser, setBrowser] = React.useState<BrowserStatus | null>(null);
  const [health, setHealth] = React.useState<HealthStatus | null>(null);
  const [selectedJobId, setSelectedJobId] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [repeatTimes, setRepeatTimes] = React.useState(1);
  const [targets, setTargets] = React.useState<string[]>(["bilibili"]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");

  const refresh = React.useCallback(async (showToast = false) => {
    const [jobsRes, queueRes, settingsRes, browserRes, healthRes] = await Promise.all([
      jsonFetch<{ jobs: RevideoJob[] }>("/api/jobs"),
      jsonFetch<QueueShape>("/api/jobs/queue"),
      jsonFetch<{ settings: SettingsShape }>("/api/settings"),
      jsonFetch<BrowserStatus>("/api/browser/status"),
      jsonFetch<HealthStatus>("/api/health"),
    ]);
    setJobs(jobsRes.jobs || []);
    setQueue(queueRes);
    setSettings(settingsRes.settings);
    setBrowser(browserRes);
    setHealth(healthRes);
    setTargets((current) => current.length ? current : stringArray(settingsRes.settings?.publishing?.defaultPlatforms, ["bilibili"]));
    setSelectedJobId((current) => current || jobsRes.jobs?.[0]?.id || "");
    setLoading(false);
    if (showToast) toast.success(t("actions.dashboardRefreshed"));
  }, [t]);

  React.useEffect(() => {
    refresh().catch((error) => {
      setLoading(false);
      toast.error(error.message);
    });
    const timer = window.setInterval(() => refresh().catch(() => undefined), 6000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectedJob = jobs.find((job) => job.id === selectedJobId) || jobs[0];
  const filteredJobs = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...jobs]
      .filter((job) => {
        const status = derivedStatus(job, queue);
        const text = `${job.id} ${job.source?.url || ""} ${jobTitle(job)}`.toLowerCase();
        return (statusFilter === "all" || status === statusFilter) && (!normalized || text.includes(normalized));
      })
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }, [jobs, query, queue, statusFilter]);

  const stats = React.useMemo(() => {
    const statuses = jobs.map((job) => derivedStatus(job, queue));
    return {
      total: jobs.length,
      running: statuses.filter((status) => status === "running" || status === "publishing").length,
      completed: statuses.filter((status) => status === "completed").length,
      failed: statuses.filter((status) => status === "failed").length,
    };
  }, [jobs, queue]);

  async function mutate(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    try {
      await action();
      await refresh();
      toast.success(t("actions.actionSubmitted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function createJob(event: React.FormEvent) {
    event.preventDefault();
    if (!sourceUrl.trim()) return;
    await mutate("create", async () => {
      const existing = jobs.find((job) => job.source?.url === sourceUrl.trim());
      const response = await jsonFetch<{ job: RevideoJob }>(`/api/jobs${existing ? "?force=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: { url: sourceUrl.trim(), platform: "auto" },
          targets: targets.map((platform) => ({ platform })),
          options: {
            repeatTimes,
            targetLanguage: settings?.production?.subtitleTargetLanguage || "zh-CN",
          },
        }),
      });
      setSelectedJobId(response.job.id);
      setSourceUrl("");
    });
  }

  const runJobAction = (jobId: string, action: string) => mutate(action, async () => {
    if (action === "delete") return jsonFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    return jsonFetch(`/api/jobs/${encodeURIComponent(jobId)}/${action}`, { method: "POST" });
  });

  const saveSettings = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const retranslate = data.get("retranslate") === "on";
    const bilingual = data.get("bilingual") === "on";
    const targetLanguage = formString(data, "targetLanguage", "zh-CN");
    const payload: SettingsShape = {
      download: {
        commentSeconds: Number(data.get("commentSeconds") || 2),
        maxComments: Number(data.get("maxComments") || 800),
      },
      production: {
        subtitleTargetLanguage: targetLanguage,
        commentTargetLanguage: targetLanguage,
        subtitleRetranslateTargetLanguage: retranslate,
        commentRetranslateTargetLanguage: retranslate,
        bilingualSubtitles: bilingual,
        renderComments: data.get("renderComments") === "on",
        subtitlePrompt: formString(data, "subtitlePrompt"),
        commentPrompt: formString(data, "commentPrompt"),
      },
      publishing: {
        defaultPlatforms: targets,
        scheduleMode: formString(data, "scheduleMode", "manual"),
        scheduledDelayMinutes: Number(data.get("scheduledDelayMinutes") || 0),
      },
    };
    void mutate("settings", async () => {
      const response = await jsonFetch<{ settings: SettingsShape }>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSettings(response.settings);
    });
  };

  const targetChooser = (
    <div className="flex flex-wrap gap-2">
      {targetPlatforms.map((platform) => {
        const checked = targets.includes(platform);
        return (
          <Button
            key={platform}
            type="button"
            variant={checked ? "default" : "outline"}
            size="sm"
            onClick={() => setTargets((current) => checked ? current.filter((item) => item !== platform) : [...current, platform])}
          >
            {platformNames[platform] || platform}
          </Button>
        );
      })}
    </div>
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("app.loading")}
        </div>
      </div>
    );
  }

  const metrics = (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      <MetricCard icon={ClipboardList} label={t("metrics.totalJobs")} value={stats.total} hint={t("metrics.totalJobsHint")} />
      <MetricCard icon={Loader2} label={t("metrics.running")} value={stats.running} hint={t("metrics.runningHint")} />
      <MetricCard icon={CheckCircle2} label={t("metrics.completed")} value={stats.completed} hint={t("metrics.completedHint")} tone="success" />
      <MetricCard icon={AlertTriangle} label={t("metrics.attention")} value={stats.failed} hint={t("metrics.attentionHint")} tone={stats.failed ? "danger" : undefined} />
    </div>
  );

  const createSourceCard = (
    <Card>
      <CardHeader>
        <CardTitle>{t("create.title")}</CardTitle>
        <CardDescription>{t("create.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={createJob}>
          <div className="grid gap-2 xl:grid-cols-[1fr_120px]">
            <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder={t("create.urlPlaceholder")} />
            <Input type="number" min={1} max={10} value={repeatTimes} onChange={(event) => setRepeatTimes(Number(event.target.value || 1))} />
          </div>
          {targetChooser}
          <Button disabled={busy === "create"} type="submit" className="w-fit">
            {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("actions.createWorkflow")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );

  const jobsTable = (
    <Card>
      <CardHeader>
        <CardTitle>{t("jobs.title")}</CardTitle>
        <CardDescription>{t("jobs.description")}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => refresh(true)}>
            <RefreshCcw />
            {t("actions.refresh")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:w-96">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("jobs.searchPlaceholder")} />
          </div>
          <NativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full xl:w-44">
            <NativeSelectOption value="all">{t("jobs.allStatuses")}</NativeSelectOption>
            <NativeSelectOption value="running">{t("status.running")}</NativeSelectOption>
            <NativeSelectOption value="publishing">{t("status.publishing")}</NativeSelectOption>
            <NativeSelectOption value="paused">{t("status.paused")}</NativeSelectOption>
            <NativeSelectOption value="completed">{t("status.completed")}</NativeSelectOption>
            <NativeSelectOption value="failed">{t("status.failed")}</NativeSelectOption>
          </NativeSelect>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("jobs.job")}</TableHead>
              <TableHead>{t("jobs.status")}</TableHead>
              <TableHead>{t("jobs.progress")}</TableHead>
              <TableHead>{t("jobs.targets")}</TableHead>
              <TableHead className="text-right">{t("jobs.updated")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredJobs.length ? filteredJobs.map((job) => (
              <TableRow
                key={job.id}
                data-state={selectedJob?.id === job.id ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => setSelectedJobId(job.id)}
              >
                <TableCell className="max-w-[360px] whitespace-normal">
                  <div className="grid gap-1">
                    <span className="truncate font-medium">{jobTitle(job)}</span>
                    <span className="truncate text-muted-foreground text-xs">{job.id}</span>
                  </div>
                </TableCell>
                <TableCell>{statusBadge(derivedStatus(job, queue), t)}</TableCell>
                <TableCell className="min-w-40">
                  <div className="grid gap-1">
                    <Progress value={stepProgress(job)} />
                    <span className="text-muted-foreground text-xs">{t(`steps.${effectiveWorkflowCursor(job).step}`)} · x{job.options?.repeatTimes || 1}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(job.targets || []).map((target) => <Badge key={target.platform} variant="outline">{platformNames[target.platform] || target.platform}</Badge>)}
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground text-xs">{formatTime(job.updatedAt, locale)}</TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">{t("jobs.noMatchingJobs")}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  const jobDetail = selectedJob ? (
    <Card className="xl:sticky xl:top-18">
      <CardHeader>
        <CardTitle className="truncate">{jobTitle(selectedJob)}</CardTitle>
        <CardDescription className="break-all">{selectedJob.source?.url || selectedJob.id}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          {statusBadge(derivedStatus(selectedJob, queue), t)}
          <Badge variant="outline">{platformNames[selectedJob.source?.platform || ""] || selectedJob.source?.platform || t("jobs.source")}</Badge>
          <Badge variant="outline">{t("jobs.comments")} {selectedJob.options?.targetCommentCount ?? "-"}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" onClick={() => runJobAction(selectedJob.id, "pause")}><Pause /> {t("actions.pause")}</Button>
          <Button size="sm" variant="outline" onClick={() => runJobAction(selectedJob.id, "resume")}><Play /> {t("actions.resume")}</Button>
          <Button size="sm" variant="outline" onClick={() => runJobAction(selectedJob.id, "retry")}><RefreshCcw /> {t("actions.retry")}</Button>
          <Button size="sm" variant="destructive" onClick={() => runJobAction(selectedJob.id, "delete")}><Trash2 /> {t("actions.delete")}</Button>
        </div>
        <div className="grid gap-2">
          {workflowOrder.map((step) => {
            const state = selectedJob.workflow?.steps?.[step]?.status || "pending";
            return (
              <div key={step} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{t(`steps.${step}`)}</span>
                  {statusBadge(state, t)}
                </div>
                {selectedJob.workflow?.steps?.[step]?.error && (
                  <p className="mt-2 break-words text-destructive text-xs">{selectedJob.workflow.steps[step]?.error}</p>
                )}
              </div>
            );
          })}
        </div>
        {selectedJob.artifacts?.outputVideo && (
          <Button asChild variant="outline">
            <a href={outputHref(selectedJob.artifacts.outputVideo)} target="_blank" rel="noreferrer">
              <ExternalLink />
              {t("actions.openOutput")}
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  ) : (
    <Card><CardContent className="py-10 text-center text-muted-foreground">{t("jobs.noJobSelected")}</CardContent></Card>
  );

  const queuePanel = (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card>
        <CardHeader><CardTitle>{t("queue.active")}</CardTitle><CardDescription>{t("queue.activeDescription")}</CardDescription></CardHeader>
        <CardContent>{queue.active ? <RunCard run={queue.active} t={t} /> : <Empty label={t("queue.noActive")} />}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("queue.queued")}</CardTitle><CardDescription>{t("queue.queuedDescription")}</CardDescription></CardHeader>
        <CardContent className="grid gap-2">{queue.queued?.length ? queue.queued.map((run: QueueRun) => <RunCard key={run.id} run={run} t={t} />) : <Empty label={t("queue.empty")} />}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("queue.recent")}</CardTitle><CardDescription>{t("queue.recentDescription")}</CardDescription></CardHeader>
        <CardContent className="grid gap-2">{queue.recent?.length ? queue.recent.slice(0, 8).map((run: QueueRun) => <RunCard key={run.id} run={run} t={t} />) : <Empty label={t("queue.noHistory")} />}</CardContent>
      </Card>
    </div>
  );

  const browserPanel = (
    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t("browser.automation")}</CardTitle>
          <CardDescription>{t("browser.automationDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={browser?.running ? "default" : "outline"}>{browser?.running ? t("browser.running") : browser?.installed ? t("browser.installed") : t("browser.missing")}</Badge>
            {browser?.cdpUrl && <Badge variant="outline">{browser.cdpUrl}</Badge>}
          </div>
          <p className="break-all text-muted-foreground text-sm">{browser?.executablePath || browser?.error || t("browser.noDetails")}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => mutate("browser-start", () => jsonFetch("/api/browser/start", { method: "POST" }))}><Play /> {t("actions.start")}</Button>
            <Button variant="outline" onClick={() => mutate("browser-restart", () => jsonFetch("/api/browser/restart", { method: "POST" }))}><RefreshCcw /> {t("actions.restart")}</Button>
            <Button variant="outline" onClick={() => mutate("bilibili-login", () => jsonFetch("/api/browser/open-login/bilibili", { method: "POST" }))}>{t("actions.bilibiliLogin")}</Button>
            <Button variant="outline" onClick={() => mutate("douyin-login", () => jsonFetch("/api/browser/open-login/douyin", { method: "POST" }))}>{t("actions.douyinLogin")}</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("browser.dependencies")}</CardTitle><CardDescription>{t("browser.dependenciesDescription")}</CardDescription></CardHeader>
        <CardContent className="grid gap-2">
          {health?.dependencies?.map((dep) => (
            <div key={dep.name} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div>
                <div className="font-medium text-sm">{dep.name}</div>
                <div className="line-clamp-2 text-muted-foreground text-xs">{dep.version || dep.error || "-"}</div>
              </div>
              {dep.ok ? <Badge className="bg-emerald-600 text-white">{t("browser.ok")}</Badge> : <Badge variant="destructive">{t("browser.missingDep")}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );

  const settingsPanel = (
    <form className="grid gap-4" onSubmit={saveSettings}>
      <Tabs defaultValue="download">
        <TabsList>
          <TabsTrigger value="download"><Download /> {t("settings.downloadTab")}</TabsTrigger>
          <TabsTrigger value="translation">{t("settings.translationTab")}</TabsTrigger>
          <TabsTrigger value="publishing"><Rocket /> {t("settings.publishingTab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="download" className="grid gap-4 xl:grid-cols-2">
          <SettingCard title={t("settings.commentSampling")} description={t("settings.commentSamplingDescription")}>
            <LabelInput label={t("settings.secondsPerComment")} name="commentSeconds" type="number" defaultValue={getNested(settings, "download.commentSeconds", 2)} />
            <LabelInput label={t("settings.maximumComments")} name="maxComments" type="number" defaultValue={getNested(settings, "download.maxComments", 800)} />
          </SettingCard>
          <SettingCard title={t("settings.rendering")} description={t("settings.renderingDescription")}>
            <SwitchRow label={t("settings.renderComments")} name="renderComments" defaultChecked={getNested(settings, "production.renderComments", true)} />
          </SettingCard>
        </TabsContent>
        <TabsContent value="translation" className="grid gap-4">
          <SettingCard title={t("settings.languageReview")} description={t("settings.languageReviewDescription")}>
            <div className="grid gap-2 text-sm">
              <label className="font-medium" htmlFor="targetLanguage">{t("settings.targetLanguage")}</label>
              <NativeSelect id="targetLanguage" name="targetLanguage" defaultValue={getNested(settings, "production.subtitleTargetLanguage", "zh-CN")} className="w-full max-w-xs">
                {languages.map((code) => <NativeSelectOption key={code} value={code}>{t(`languages.${code}`)}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <SwitchRow label={t("settings.retranslate")} name="retranslate" defaultChecked={Boolean(getNested(settings, "production.subtitleRetranslateTargetLanguage", false))} />
            <SwitchRow label={t("settings.bilingual")} name="bilingual" defaultChecked={Boolean(getNested(settings, "production.bilingualSubtitles", false))} />
            <div className="grid gap-2 text-sm">
              <label className="font-medium" htmlFor="subtitlePrompt">{t("settings.subtitlePrompt")}</label>
              <Textarea id="subtitlePrompt" name="subtitlePrompt" defaultValue={getNested(settings, "production.subtitlePrompt", "")} />
            </div>
            <div className="grid gap-2 text-sm">
              <label className="font-medium" htmlFor="commentPrompt">{t("settings.commentPrompt")}</label>
              <Textarea id="commentPrompt" name="commentPrompt" defaultValue={getNested(settings, "production.commentPrompt", "")} />
            </div>
          </SettingCard>
        </TabsContent>
        <TabsContent value="publishing" className="grid gap-4 xl:grid-cols-2">
          <SettingCard title={t("settings.defaultTargets")} description={t("settings.defaultTargetsDescription")}>
            {targetChooser}
          </SettingCard>
          <SettingCard title={t("settings.publishScheduling")} description={t("settings.publishSchedulingDescription")}>
            <div className="grid gap-2 text-sm">
              <label className="font-medium" htmlFor="scheduleMode">{t("settings.mode")}</label>
              <NativeSelect id="scheduleMode" name="scheduleMode" defaultValue={getNested(settings, "publishing.scheduleMode", "manual")} className="w-full">
                <NativeSelectOption value="manual">{t("settings.manual")}</NativeSelectOption>
                <NativeSelectOption value="immediate">{t("settings.immediate")}</NativeSelectOption>
                <NativeSelectOption value="scheduled">{t("settings.scheduled")}</NativeSelectOption>
              </NativeSelect>
            </div>
            <LabelInput label={t("settings.delayMinutes")} name="scheduledDelayMinutes" type="number" defaultValue={getNested(settings, "publishing.scheduledDelayMinutes", 0)} />
          </SettingCard>
        </TabsContent>
      </Tabs>
      <Button className="w-fit" type="submit" disabled={busy === "settings"}><Settings /> {t("actions.saveSettings")}</Button>
    </form>
  );

  if (view === "jobs") {
    return (
      <div className="grid gap-4">
        <PageHeader icon={ClipboardList} title={t("page.jobsTitle")} description={t("page.jobsDescription")} action={<Button onClick={() => refresh(true)} variant="outline"><RefreshCcw /> {t("actions.refresh")}</Button>} />
        {createSourceCard}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">{jobsTable}{jobDetail}</div>
      </div>
    );
  }

  if (view === "queue") {
    return <div className="grid gap-4"><PageHeader icon={GitBranch} title={t("page.queueTitle")} description={t("page.queueDescription")} />{queuePanel}</div>;
  }

  if (view === "publishing") {
    return (
      <div className="grid gap-4">
        <PageHeader icon={Rocket} title={t("page.publishingTitle")} description={t("page.publishingDescription")} />
        <Card>
          <CardHeader><CardTitle>{t("publishing.targets")}</CardTitle><CardDescription>{t("publishing.targetsDescription")}</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {jobs.flatMap((job) => (job.targets || []).map((target) => ({ job, target }))).slice(0, 30).map(({ job, target }) => (
              <div key={`${job.id}-${target.platform}`} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">{jobTitle(job)}</div>
                  <div className="truncate text-muted-foreground text-xs">{platformNames[target.platform] || target.platform}</div>
                </div>
                {statusBadge(target.status, t)}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (view === "health") {
    return <div className="grid gap-4"><PageHeader icon={HeartIcon} title={t("page.healthTitle")} description={t("page.healthDescription")} />{browserPanel}</div>;
  }

  if (view === "browser") {
    return <div className="grid gap-4"><PageHeader icon={Bot} title={t("page.browserTitle")} description={t("page.browserDescription")} />{browserPanel}</div>;
  }

  if (view === "settings") {
    return <div className="grid gap-4"><PageHeader icon={Settings} title={t("page.settingsTitle")} description={t("page.settingsDescription")} />{settingsPanel}</div>;
  }

  return (
    <div className="grid gap-4 md:gap-6">
      <PageHeader icon={Gauge} title={t("page.overviewTitle")} description={t("page.overviewDescription")} action={<Button onClick={() => refresh(true)} variant="outline"><RefreshCcw /> {t("actions.refresh")}</Button>} />
      {metrics}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">{createSourceCard}{jobsTable}</div>
        <div className="grid gap-4">{jobDetail}<Card><CardHeader><CardTitle>{t("queue.summary")}</CardTitle><CardDescription>{t("queue.summaryDescription")}</CardDescription></CardHeader><CardContent>{queuePanel}</CardContent></Card></div>
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">{label}</div>;
}

function RunCard({ run, t }: { run: QueueRun; t: (key: string) => string }) {
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-sm">{run.jobId}</span>
        {statusBadge(run.status, t)}
      </div>
      <div className="text-muted-foreground text-xs">{run.steps?.join(" -> ") || run.id}</div>
      {run.error && <div className="text-destructive text-xs">{run.error}</div>}
    </div>
  );
}

function SettingCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

function LabelInput({ label, ...props }: React.ComponentProps<typeof Input> & { label: string }) {
  const controlId = props.id || String(props.name || label);

  return (
    <div className="grid gap-2 text-sm">
      <label className="font-medium" htmlFor={controlId}>{label}</label>
      <Input {...props} id={controlId} />
    </div>
  );
}

function SwitchRow({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <label className="font-medium" htmlFor={name}>{label}</label>
      <Switch id={name} name={name} defaultChecked={defaultChecked} />
    </div>
  );
}

function HeartIcon(props: React.ComponentProps<typeof Activity>) {
  return <Activity {...props} />;
}
