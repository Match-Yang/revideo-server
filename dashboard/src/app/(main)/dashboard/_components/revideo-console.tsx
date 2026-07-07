"use client";

import * as React from "react";

import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Compass,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Globe,
  Layers,
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Rocket,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  COVER_TEMPLATE_IDS,
  DEFAULT_COVER_TEMPLATE,
  buildCoverSvg,
  coverTemplateAiPrompt,
  coverTemplateFields,
  coverTemplateSampleBg,
  coverTemplateSampleText,
  isNoTemplate,
  normalizeCoverTemplateId,
} from "@/lib/cover-templates";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/i18n-provider";
import { cn } from "@/lib/utils";

type DashboardView = "jobs" | "publishing" | "health" | "settings";

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
  version?: number;
  task?: Record<string, JsonValue>;
  llm?: Record<string, JsonValue>;
  agent?: Record<string, JsonValue>;
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

type DiscoveryRunStatus = "success" | "running" | "failed";
interface DiscoveryRunRecord {
  lastRunAt: string;
  lastRunStatus: DiscoveryRunStatus;
  stats: { scanned: number; hardFiltered: number; deduped: number; llmFiltered: number; created: number };
  createdJobIds: string[];
  errors: string[];
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

const targetPlatforms = ["bilibili", "douyin", "xiaohongshu", "youtube", "tiktok", "instagram", "x"];

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

const styleConstraintOptions = ["自然口语", "保守直译", "短视频口吻", "新闻解说", "专业测评", "夸张吸睛", "幽默吐槽", "克制高级", "本土化表达", "保留原文语气", "适合 B 站", "适合抖音", "适合小红书", "适合 YouTube"];
const resolutionOptions: Array<[string, string]> = [["auto", "自动"], ["best", "最高清"], ["8k", "8K"], ["4k", "4K"], ["2k", "2K"], ["1080p", "1080p"], ["720p", "720p"], ["480p", "480p"]];
const resolutionOptionHelp = {
  auto: "由系统自动选择最合适的分辨率。",
  best: "使用可用的最高分辨率。",
  "8k": "目标 8K（4320p），不存在则向下兼容更低分辨率。",
  "4k": "目标 4K（2160p），不存在则向下兼容更低分辨率。",
  "2k": "目标 2K（1440p），不存在则向下兼容更低分辨率。",
  "1080p": "目标 1080p，不存在则向下兼容更低分辨率。",
  "720p": "目标 720p，不存在则向下兼容更低分辨率。",
  "480p": "目标 480p，不存在则向下兼容更低分辨率。",
};
const resolutionOptionValues = new Set(resolutionOptions.map(([value]) => value));
const agentChannels = [
  ["wechat", "微信"],
  ["wecom", "企业微信"],
  ["lark", "飞书"],
  ["dingtalk", "钉钉"],
  ["qq", "QQ"],
  ["telegram", "Telegram"],
  ["discord", "Discord"],
];

// Hand this verbatim to an AI agent (OpenClaw, Hermes, etc.) so it installs the
// server and wires up the MCP endpoint on its own. Rendered read-only in the
// Agent settings pane with a copy button.
const AGENT_INSTRUCTION = `请按以下步骤帮我安装并配置 Revideo 视频搬运服务，完成后告诉我。

1. 安装服务
Linux / macOS：
curl -fsSL https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.sh | bash
Windows (PowerShell)：
iex (irm https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.ps1)
（脚本会自动安装 Node.js、yt-dlp、ffmpeg 并启动服务，端口 6688）

2. 将 Revideo 接入你的 MCP 配置：
{
  "mcpServers": {
    "revideo": {
      "url": "http://localhost:6688/mcp"
    }
  }
}

3. 打开 http://localhost:6688 ，在「设置 → LLM」里填好兼容 OpenAI 格式的 URL、模型名和 API Key。

配置完成后，我就能通过 MCP 的 submit_video_job 等工具，自动完成视频下载、翻译、渲染和发布。

项目地址：https://github.com/Match-Yang/revideo-server`;

function getNested<T>(source: unknown, path: string, fallback: T): T {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
  return (value as T | undefined) ?? fallback;
}

function normalizedResolutionOption(value: unknown, fallback = "auto"): string {
  const next = typeof value === "string" ? value : fallback;
  return resolutionOptionValues.has(next) ? next : fallback;
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

// Current step number out of total, plus the resolved step key.
function stepCounter(job: RevideoJob) {
  const cursor = effectiveWorkflowCursor(job);
  const total = workflowOrder.length;
  const current = cursor.step === "completed" ? total : cursor.index >= 0 ? cursor.index + 1 : 0;
  return { current, total, step: cursor.step };
}

function outputHref(jobId: string, type: "output" | "cover" = "output") {
  return `/api/jobs/${jobId}/${type}`;
}

function jobTitle(job: RevideoJob) {
  const title = job.source?.metadata?.title;
  if (typeof title === "string" || typeof title === "number") return String(title);
  return job.id;
}

// First non-empty draft title across the job's targets, or "" if none generated yet.
function draftTitle(job: RevideoJob) {
  for (const target of job.targets || []) {
    const draft = target.draft;
    if (draft && typeof draft === "object" && !Array.isArray(draft)) {
      const title = (draft as Record<string, JsonValue>).title;
      if (typeof title === "string" && title.trim()) return title;
    }
  }
  return "";
}

function stringArray(value: JsonValue | undefined, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function listValue(value: JsonValue | undefined, fallback: string[]) {
  return stringArray(value, fallback).join("，");
}

function formString(data: FormData, key: string, fallback = "") {
  const value = data.get(key);
  return typeof value === "string" ? value : fallback;
}

function svgDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cursor = target;
  keys.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  });
  cursor[keys[keys.length - 1]] = value;
}

function parseFieldValue(name: string, value: FormDataEntryValue) {
  const raw = typeof value === "string" ? value.trim() : String(value);
  if (["task.translation.styleConstraints"].includes(name)) {
    return raw.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  }
  if (name === "task.discovery.channels") {
    return raw.split(/\n/).map((item) => item.trim()).filter(Boolean);
  }
  const numericFields = new Set([
    "task.download.commentSeconds",
    "task.download.maxComments",
    "task.download.retryCount",
    "task.download.timeoutSec",
    "task.coverAndCopy.fixedFrameIndex",
    "task.render.repeatTimes",
    "task.discovery.filters.minViews",
    "task.discovery.filters.minComments",
    "task.discovery.filters.maxAgeDays",
    "task.discovery.shortVideo.maxDurationSec",
    "task.discovery.shortVideo.repeatTimes",
    "task.discovery.scheduleHour",
    "llm.timeoutSec",
    "llm.retryCount",
  ]);
  if (numericFields.has(name)) return Number(raw || 0);
  // Per-platform retry counts
  if (/^task\.publish\.platformConfigs\.[^.]+\.retryCount$/.test(name)) return Number(raw || 0);
  return raw;
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

export function RevideoConsole({ view }: { view: DashboardView }) {
  const { t } = useI18n();
  const [jobs, setJobs] = React.useState<RevideoJob[]>([]);
  const [queue, setQueue] = React.useState<QueueShape>({ active: null, queued: [], scheduled: [], recent: [] });
  const [settings, setSettings] = React.useState<SettingsShape | null>(null);
  const [browser, setBrowser] = React.useState<BrowserStatus | null>(null);
  const [health, setHealth] = React.useState<HealthStatus | null>(null);
  const [selectedJobId, setSelectedJobId] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [pageSize, setPageSize] = React.useState(15);
  const [page, setPage] = React.useState(1);
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [promptPanelOpen, setPromptPanelOpen] = React.useState(false);
  const [repeatTimes, setRepeatTimes] = React.useState(1);
  const [createTargets, setCreateTargets] = React.useState<string[]>(["bilibili"]);
  const [settingsTargets, setSettingsTargets] = React.useState<string[]>(["bilibili"]);
  const [activeSettings, setActiveSettings] = React.useState("download");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [settingsTargetsVersion, setSettingsTargetsVersion] = React.useState(0);
  const [discoveryRecord, setDiscoveryRecord] = React.useState<DiscoveryRunRecord | null>(null);
  const [discoveryRunning, setDiscoveryRunning] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-fresh ref so debounce timer reads latest settingsTargets
  const settingsTargetsRef = React.useRef(settingsTargets);
  settingsTargetsRef.current = settingsTargets;

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
    const defaults = stringArray(getNested<JsonValue | undefined>(settingsRes.settings, "task.publish.defaultPlatforms", undefined), ["bilibili"]);
    setCreateTargets((current) => current.length ? current : defaults);
    setSettingsTargets(defaults);
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
        const text = `${jobTitle(job)} ${draftTitle(job)}`.toLowerCase();
        return (statusFilter === "all" || status === statusFilter) && (!normalized || text.includes(normalized));
      })
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }, [jobs, query, queue, statusFilter]);

  // Client-side pagination over the filtered list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset pagination when filters/page size change.
  React.useEffect(() => setPage(1), [query, statusFilter, pageSize]);
  const pageCount = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pagedJobs = filteredJobs.slice(pageStart, pageStart + pageSize);
  const firstRow = filteredJobs.length === 0 ? 0 : pageStart + 1;
  const lastRow = Math.min(pageStart + pageSize, filteredJobs.length);

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
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const url = formString(data, "sourceUrl").trim();
    if (!url) return;
    const nextRepeatTimes = Math.min(10, Math.max(1, Number(data.get("repeatTimes") || 1)));
    await mutate("create", async () => {
      const existing = jobs.find((job) => job.source?.url === url);
      const response = await jsonFetch<{ job: RevideoJob }>(`/api/jobs${existing ? "?force=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: { url },
          targets: createTargets.map((platform) => ({ platform })),
          options: {
            repeatTimes: nextRepeatTimes,
            downloadQuality: formString(data, "downloadQuality", "auto"),
            renderComments: data.get("renderComments") === "on",
            targetLanguage: formString(data, "targetLanguage", "zh-CN"),
            subtitleMode: formString(data, "subtitleMode", "auto"),
            commentMode: formString(data, "commentMode", "auto"),
            bilingualSubtitles: data.get("bilingualSubtitles") === "on",
            sensitiveContent: formString(data, "sensitiveContent", "preserve"),
            styleConstraints: formString(data, "styleConstraints")
              .split(/[,，]/)
              .map((item) => item.trim())
              .filter(Boolean),
            promptOverrides: {
              subtitle: formString(data, "promptSubtitle"),
              comment: formString(data, "promptComment"),
            },
          },
        }),
      });
      setSelectedJobId(response.job.id);
      setSourceUrl("");
      setCreateDialogOpen(false);
    });
  }

  const runJobAction = (jobId: string, action: string) => mutate(action, async () => {
    if (action === "delete") return jsonFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    return jsonFetch(`/api/jobs/${encodeURIComponent(jobId)}/${action}`, { method: "POST" });
  });

  // Reads the form and POSTs to /api/settings. Uses settingsTargetsRef so it's
  // safe to call from a debounce timer (always gets the latest platform selection).
  function persistSettings(form: HTMLFormElement) {
    const data = new FormData(form);
    const payload: SettingsShape = { version: 2, task: {}, llm: {}, agent: {} };
    const booleanFields = new Set([
      "task.translation.bilingualSubtitles",
      "task.render.renderComments",
      "task.publish.platformConfigs.tiktok.allowComment",
      "task.publish.platformConfigs.tiktok.allowDuet",
      "task.publish.platformConfigs.tiktok.allowStitch",
      "task.publish.platformConfigs.tiktok.isAigc",
      "task.publish.platformConfigs.x.isSensitive",
      "agent.enabled",
      "task.discovery.enabled",
    ]);

    data.forEach((value, name) => {
      if (!name.startsWith("task.") && !name.startsWith("llm.") && !name.startsWith("agent.")) return;
      if (name.startsWith("agent.channels.")) return;
      if (name === "task.discovery.targets") return;
      if (booleanFields.has(name)) return;
      setPath(payload as Record<string, unknown>, name, parseFieldValue(name, value));
    });

    booleanFields.forEach((name) => {
      setPath(payload as Record<string, unknown>, name, data.get(name) === "on");
    });
    setPath(payload as Record<string, unknown>, "task.publish.defaultPlatforms", settingsTargetsRef.current);
    setPath(payload as Record<string, unknown>, "task.discovery.targets", data.getAll("task.discovery.targets").map((v) => String(v)).filter(Boolean));
    setPath(payload as Record<string, unknown>, "agent.channels", agentChannels.map(([type]) => ({
      type,
      enabled: data.get(`agent.channels.${type}.enabled`) === "on",
      binding: formString(data, `agent.channels.${type}.binding`),
      notificationLevel: formString(data, `agent.channels.${type}.notificationLevel`, "failures"),
      allowRemoteActions: data.get(`agent.channels.${type}.allowRemoteActions`) === "on",
    })));

    jsonFetch<{ settings: SettingsShape }>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((response) => {
      setSettings(response.settings);
      toast.success("已保存");
    }).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  }

  function scheduleSave(form: HTMLFormElement, delay = 700) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistSettings(form), delay);
  }

  // Trigger auto-save when user changes the platform toggle buttons.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scheduleSave intentionally reads latest refs.
  React.useEffect(() => {
    if (settingsTargetsVersion === 0) return;
    if (formRef.current) scheduleSave(formRef.current, 300);
  }, [settingsTargetsVersion]);

  // 发现：拉取运行状态。挂载时执行一次，运行中每 5s 轮询，完成后停止轮询。
  const refreshDiscoveryStatus = React.useCallback(() => {
    jsonFetch<{ record: DiscoveryRunRecord | null }>("/api/discovery/status")
      .then((data) => {
        setDiscoveryRecord(data.record ?? null);
        setDiscoveryRunning(data.record?.lastRunStatus === "running");
      })
      .catch(() => { /* 忽略状态查询失败 */ });
  }, []);

  React.useEffect(() => {
    refreshDiscoveryStatus();
    if (!discoveryRunning) return;
    const timer = setInterval(refreshDiscoveryStatus, 5000);
    return () => clearInterval(timer);
  }, [refreshDiscoveryStatus, discoveryRunning]);

  // 立即执行发现任务。
  async function runDiscoveryNow() {
    try {
      const res = await fetch("/api/discovery/run", { method: "POST" });
      if (res.status === 409) {
        toast.error("发现任务正在运行中");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || res.statusText);
        return;
      }
      toast.success("发现任务已启动");
      setDiscoveryRunning(true);
      refreshDiscoveryStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  const platformChooser = (value: string[], onChange: React.Dispatch<React.SetStateAction<string[]>>, isSettings = false) => (
    <div className="flex flex-wrap gap-2">
      {targetPlatforms.map((platform) => {
        const checked = value.includes(platform);
        return (
          <Button
            key={platform}
            type="button"
            variant={checked ? "default" : "outline"}
            size="sm"
            onClick={() => {
              onChange((current) => checked ? current.filter((item) => item !== platform) : [...current, platform]);
              if (isSettings) setSettingsTargetsVersion((v) => v + 1);
            }}
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

  const createTaskDialog = (
    <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          创建任务
        </Button>
      </DialogTrigger>
      <DialogContent className="!block !max-w-[calc(100vw-2rem)] !gap-0 sm:!max-w-[480px] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-hidden p-0">
        {/* Header */}
        <div className="shrink-0 border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle className="font-semibold text-base">{t("create.dialogTitle")}</DialogTitle>
            <DialogDescription className="text-xs">{t("create.dialogDescription")}</DialogDescription>
          </DialogHeader>
        </div>

        <form className="flex max-h-[calc(100dvh-7rem)] flex-col overflow-y-auto overflow-x-hidden" onSubmit={createJob}>
          {/* URL input — prominent card style */}
          <div className="px-5 py-3.5">
            <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 ring-1 ring-border transition-shadow focus-within:ring-2 focus-within:ring-primary/40">
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <Input
                name="sourceUrl"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder={t("create.urlPlaceholder")}
                className="h-auto border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
              />
            </div>
            {(() => {
              const trimmed = sourceUrl.trim();
              const dup = trimmed ? jobs.find((job) => job.source?.url === trimmed) : undefined;
              if (!dup) return null;
              return (
                <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-700 text-xs ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900/60">
                  <XCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{t("create.duplicateWarning")}</span>
                </div>
              );
            })()}
          </div>

          {/* Core options — icon | label : control rows */}
          <div className="grid gap-1 px-6 py-1">
            <DialogRow icon={Download} label={t("create.downloadQuality")}>
              <NativeSelect name="downloadQuality" defaultValue={normalizedResolutionOption(getNested(settings, "task.download.videoQuality", "auto"))} className="max-w-40">
                {resolutionOptions.map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>{value === "auto" ? t("create.auto") : value === "best" ? t("create.best") : label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </DialogRow>

            <DialogRow icon={RotateCcw} label={t("create.repeatTimes")}>
              <div className="flex items-center gap-2.5">
                <Input
                  name="repeatTimes"
                  type="number"
                  min={1}
                  max={10}
                  value={repeatTimes}
                  onChange={(event) => setRepeatTimes(Number(event.target.value || 1))}
                  className="h-8 w-14 text-center"
                />
                <span className="text-muted-foreground text-xs">{t("create.repeatTimesSuffix")}</span>
              </div>
            </DialogRow>

            <DialogRow icon={MessageSquare} label={t("create.renderComments")}>
              <Switch
                name="renderComments"
                defaultChecked={getNested(settings, "task.render.renderComments", true)}
              />
            </DialogRow>

            <DialogRow icon={Globe} label={t("create.targetPlatforms")}>
              {platformChooser(createTargets, setCreateTargets)}
            </DialogRow>
          </div>

          {/* Advanced collapsible sections */}
          <div className="px-4 py-2">
            <div className="mb-2 px-2">
              <span className="select-none text-muted-foreground text-xs">{t("create.advancedOptions")}</span>
            </div>
            <Accordion type="multiple" defaultValue={[]} className="grid gap-1.5">
              <SettingsAccordionItem value="translation" title={t("create.translation")} description={t("create.translationDescription")} icon={Globe} compact autoHeight>
                <div className="grid gap-1 px-2 pb-2">
                    <DialogRow icon={Globe} label={t("create.targetLanguage")}>
                      <NativeSelect name="targetLanguage" defaultValue={getNested(settings, "task.translation.targetLanguage", "zh-CN")}>
                        {languages.map((code) => <NativeSelectOption key={code} value={code}>{t(`languages.${code}`)}</NativeSelectOption>)}
                      </NativeSelect>
                    </DialogRow>
                    <DialogRow icon={Globe} label={t("create.subtitleMode")}>
                      <NativeSelect name="subtitleMode" defaultValue={getNested(settings, "task.translation.subtitleMode", "auto")}>
                        <NativeSelectOption value="auto">{t("create.auto")}</NativeSelectOption>
                        <NativeSelectOption value="always">{t("create.alwaysTranslate")}</NativeSelectOption>
                        <NativeSelectOption value="off">{t("create.noTranslate")}</NativeSelectOption>
                      </NativeSelect>
                    </DialogRow>
                    <DialogRow icon={MessageSquare} label={t("create.commentMode")}>
                      <NativeSelect name="commentMode" defaultValue={getNested(settings, "task.translation.commentMode", "auto")}>
                        <NativeSelectOption value="auto">{t("create.auto")}</NativeSelectOption>
                        <NativeSelectOption value="always">{t("create.alwaysTranslate")}</NativeSelectOption>
                        <NativeSelectOption value="off">{t("create.noTranslate")}</NativeSelectOption>
                      </NativeSelect>
                    </DialogRow>
                    <DialogRow icon={SlidersHorizontal} label={t("create.sensitiveContent")}>
                      <NativeSelect name="sensitiveContent" defaultValue={getNested(settings, "task.translation.sensitiveContent", "preserve")}>
                        <NativeSelectOption value="preserve">{t("create.preserve")}</NativeSelectOption>
                        <NativeSelectOption value="soften">{t("create.soften")}</NativeSelectOption>
                        <NativeSelectOption value="mark">{t("create.mark")}</NativeSelectOption>
                        <NativeSelectOption value="delete">{t("create.delete")}</NativeSelectOption>
                      </NativeSelect>
                    </DialogRow>
                    <DialogRow icon={Globe} label={t("create.bilingualSubtitles")}>
                      <Switch name="bilingualSubtitles" defaultChecked={getNested(settings, "task.translation.bilingualSubtitles", false)} />
                    </DialogRow>
                    <DialogRow icon={SlidersHorizontal} label={t("create.styleConstraints")}>
                      <Input name="styleConstraints" defaultValue={listValue(getNested<JsonValue | undefined>(settings, "task.translation.styleConstraints", undefined), ["自然口语", "本土化表达"])} placeholder={styleConstraintOptions.join("，")} />
                    </DialogRow>
                  <div className="rounded-lg border bg-muted/20 px-3">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between py-3 font-medium text-sm"
                      onClick={() => setPromptPanelOpen((open) => !open)}
                    >
                      <span>{t("create.advancedPrompts")}</span>
                      <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", promptPanelOpen && "rotate-180")} />
                    </button>
                    {promptPanelOpen && (
                      <div className="grid gap-3 pb-3">
                        <PromptField name="promptSubtitle" label={t("create.subtitlePrompt")} defaultValue={getNested(settings, "task.translation.prompts.subtitle", "")} />
                        <PromptField name="promptComment" label={t("create.commentPrompt")} defaultValue={getNested(settings, "task.translation.prompts.comment", "")} />
                      </div>
                    )}
                  </div>
                </div>
              </SettingsAccordionItem>
            </Accordion>
          </div>

          <DialogFooter className="!mx-0 !mb-0 !rounded-none !bg-background/95 !px-5 !py-3.5 shrink-0 border-t">
            <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>{t("actions.cancel")}</Button>
            <Button disabled={busy === "create"} type="submit">
              {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("create.createAndRun")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  const jobsTable = (
    <Card>
      <CardContent className="grid gap-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-60 shrink-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("jobs.searchPlaceholder")} />
          </div>
          <NativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-36">
            <NativeSelectOption value="all">{t("jobs.allStatuses")}</NativeSelectOption>
            <NativeSelectOption value="running">{t("status.running")}</NativeSelectOption>
            <NativeSelectOption value="publishing">{t("status.publishing")}</NativeSelectOption>
            <NativeSelectOption value="paused">{t("status.paused")}</NativeSelectOption>
            <NativeSelectOption value="completed">{t("status.completed")}</NativeSelectOption>
            <NativeSelectOption value="failed">{t("status.failed")}</NativeSelectOption>
          </NativeSelect>
          <Button variant="outline" size="icon" onClick={() => refresh(true)} title={t("actions.refresh")}>
            <RefreshCcw />
          </Button>
          <div className="ml-auto">{createTaskDialog}</div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("jobs.job")}</TableHead>
              <TableHead>{t("jobs.progress")}</TableHead>
              <TableHead>{t("jobs.status")}</TableHead>
              <TableHead className="text-right">{t("jobs.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedJobs.length ? pagedJobs.map((job) => (
              <TableRow
                key={job.id}
                data-state={selectedJob?.id === job.id ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => setSelectedJobId(job.id)}
              >
                <TableCell className="max-w-[360px] whitespace-normal">
                  <div className="grid gap-1">
                    <span className="truncate font-medium">{jobTitle(job)}</span>
                    <span className="truncate text-muted-foreground text-xs">{draftTitle(job)}</span>
                  </div>
                </TableCell>
                <TableCell className="min-w-40">
                  <div className="grid gap-1">
                    <Progress value={stepProgress(job)} />
                    <span className="text-muted-foreground text-xs">{stepCounter(job).current}/{stepCounter(job).total} {t(`steps.${stepCounter(job).step}`)} · x{job.options?.repeatTimes || 1}</span>
                  </div>
                </TableCell>
                <TableCell>{statusBadge(derivedStatus(job, queue), t)}</TableCell>
                <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                  {(() => {
                    const status = derivedStatus(job, queue);
                    const canPause = status === "running" || status === "publishing";
                    const canResume = status === "created" || status === "paused" || status === "failed";
                    const canRetry = status === "paused" || status === "failed" || status === "completed" || status === "cancelled";
                    const hasLinks = job.source?.url || job.artifacts?.outputVideo;
                    return (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {job.source?.url && (
                            <DropdownMenuItem onClick={() => window.open(job.source?.url, "_blank")}><Link2 /> {t("actions.openLink")}</DropdownMenuItem>
                          )}
                          {job.artifacts?.outputVideo && (
                            <DropdownMenuItem onClick={() => window.open(outputHref(job.id), "_blank")}><ExternalLink /> {t("actions.openOutput")}</DropdownMenuItem>
                          )}
                          {hasLinks && <DropdownMenuSeparator />}
                          {canPause && <DropdownMenuItem onClick={() => runJobAction(job.id, "pause")}><Pause /> {t("actions.pause")}</DropdownMenuItem>}
                          {canResume && <DropdownMenuItem onClick={() => runJobAction(job.id, "resume")}><Play /> {t("actions.resume")}</DropdownMenuItem>}
                          {canRetry && <DropdownMenuItem onClick={() => runJobAction(job.id, "retry")}><RotateCcw /> {t("actions.retry")}</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => runJobAction(job.id, "delete")}><Trash2 /> {t("actions.delete")}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    );
                  })()}
                </TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">{t("jobs.noMatchingJobs")}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex flex-col gap-3 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span>{t("jobs.rowsPerPage")}</span>
              <NativeSelect value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))} className="w-20">
                {[15, 30, 50, 100].map((size) => <NativeSelectOption key={size} value={String(size)}>{size}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <span>{t("jobs.showingRows", { start: firstRow, end: lastRow, total: filteredJobs.length })}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t("jobs.previous")}</Button>
            <Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>{t("jobs.next")}</Button>
          </div>
        </div>
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
        {(() => {
          const status = derivedStatus(selectedJob, queue);
          const canPause = status === "running" || status === "publishing";
          const canResume = status === "created" || status === "paused" || status === "failed";
          const canRetry = status === "paused" || status === "failed" || status === "completed" || status === "cancelled";
          return (
            <div className="flex flex-wrap gap-2">
              {canPause && <Button size="sm" variant="outline" onClick={() => runJobAction(selectedJob.id, "pause")}><Pause /> {t("actions.pause")}</Button>}
              {canResume && <Button size="sm" variant="outline" onClick={() => runJobAction(selectedJob.id, "resume")}><Play /> {t("actions.resume")}</Button>}
              {canRetry && <Button size="sm" variant="outline" onClick={() => runJobAction(selectedJob.id, "retry")}><RotateCcw /> {t("actions.retry")}</Button>}
              <Button size="sm" variant="destructive" onClick={() => runJobAction(selectedJob.id, "delete")}><Trash2 /> {t("actions.delete")}</Button>
            </div>
          );
        })()}
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
            <a href={outputHref(selectedJob.id)} target="_blank" rel="noreferrer">
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

  const settingsGroups: Array<{ group: string; items: Array<{ id: string; label: string; icon: React.ElementType }> }> = [
    {
      group: "任务流程",
      items: [
        { id: "download", label: "下载与存储", icon: Download },
        { id: "prepare", label: "素材整理与适配", icon: SlidersHorizontal },
        { id: "translation", label: "翻译", icon: Globe },
        { id: "cover", label: "封面与文案", icon: Layers },
        { id: "render", label: "渲染", icon: Play },
        { id: "discovery", label: "发现", icon: Compass },
        { id: "publish", label: "发布", icon: Send },
      ],
    },
    {
      group: "模型与集成",
      items: [
        { id: "llm", label: "LLM 设置", icon: Cpu },
        { id: "agent", label: "Agent 设置", icon: Rocket },
      ],
    },
  ];

  const settingsPanel = (
    <form
      ref={formRef}
      className="grid gap-4"
      onSubmit={(e) => e.preventDefault()}
      onChange={(e) => scheduleSave(e.currentTarget)}
    >
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="flex flex-col gap-5 lg:border-r lg:pr-4">
          {settingsGroups.map((group) => (
            <div key={group.group} className="grid gap-1">
              <div className="px-2.5 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">{group.group}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeSettings === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSettings(item.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 max-w-xl">
          <SettingsPane active={activeSettings} id="download">
            <div className="rounded-lg border bg-card px-4 py-1">
              <PathField name="task.storage.taskDataDir" label="任务数据缓存位置" help="每个任务的全部中间数据（源视频、字幕、评论、规范化与翻译产物等）都会按任务存放在这里；渲染成品另由「渲染输出位置」管理。" defaultValue={getNested(settings, "task.storage.taskDataDir", "")} onChanged={() => { if (formRef.current) scheduleSave(formRef.current, 300); }} />
              <SelectField name="task.download.videoQuality" label="默认视频下载分辨率" help="默认期望下载的分辨率。平台不提供时自动向下兼容更低分辨率。" defaultValue={normalizedResolutionOption(getNested(settings, "task.download.videoQuality", "auto"))} options={resolutionOptions} optionHelp={resolutionOptionHelp} />
              <LabelInput label="每条评论秒数" help="例如视频 60 秒、每条评论 2 秒，目标约 30 条。" name="task.download.commentSeconds" type="number" min={0.5} step={0.5} defaultValue={getNested(settings, "task.download.commentSeconds", 2)} className="w-20" />
              <LabelInput label="最大评论数" help="防止超长视频下载过多评论。" name="task.download.maxComments" type="number" min={1} max={5000} defaultValue={getNested(settings, "task.download.maxComments", 800)} className="w-20" />
              <LabelInput label="下载重试次数" name="task.download.retryCount" type="number" min={0} max={10} defaultValue={getNested(settings, "task.download.retryCount", 2)} className="w-20" />
              <LabelInput label="下载超时秒数" name="task.download.timeoutSec" type="number" min={30} defaultValue={getNested(settings, "task.download.timeoutSec", 600)} className="w-20" />
            </div>
          </SettingsPane>

          <SettingsPane active={activeSettings} id="discovery">
            <SettingsSection title="发现" description="自动监控指定频道，按规则筛选后将优质短视频加入任务队列。">
              <SwitchRow label="启用发现" name="task.discovery.enabled" help="开启后调度器会按设定的定时时间每天自动扫描一次。" defaultChecked={getNested(settings, "task.discovery.enabled", false)} />
            </SettingsSection>
            <SettingsSection title="监控频道" description="每行一个频道链接，支持 YouTube / Bilibili 等平台。">
              <div className="py-2.5">
                <FieldControl label="频道列表" help="每行填写一个频道主页或视频列表链接。">
                  <Textarea name="task.discovery.channels" defaultValue={(getNested(settings, "task.discovery.channels", []) as string[]).join("\n")} className="min-h-32 resize-y font-mono text-xs" placeholder={"https://www.youtube.com/@channel\nhttps://space.bilibili.com/123456"} />
                </FieldControl>
              </div>
            </SettingsSection>
            <SettingsSection title="硬性过滤" description="按播放量、评论数、发布时间等客观指标过滤候选视频。">
              <LabelInput label="最低播放量" help="低于该播放量的视频直接过滤。" name="task.discovery.filters.minViews" type="number" min={0} defaultValue={getNested(settings, "task.discovery.filters.minViews", 1000)} className="w-28" />
              <LabelInput label="最低评论数" help="低于该评论数的视频直接过滤。" name="task.discovery.filters.minComments" type="number" min={0} defaultValue={getNested(settings, "task.discovery.filters.minComments", 10)} className="w-28" />
              <LabelInput label="最大发布天数" help="仅采集最近 N 天内发布的视频。" name="task.discovery.filters.maxAgeDays" type="number" min={1} defaultValue={getNested(settings, "task.discovery.filters.maxAgeDays", 30)} className="w-28" />
            </SettingsSection>
            <SettingsSection title="语义过滤" description="由 LLM 根据提示词对候选视频做内容质量与相关性筛选。">
              <PromptField name="task.discovery.llmPrompt" label="LLM 过滤提示词" defaultValue={getNested(settings, "task.discovery.llmPrompt", "")} />
            </SettingsSection>
            <SettingsSection title="渲染参数" description="命中后自动创建任务时使用的渲染参数。">
              <LabelInput label="短视频最大时长（秒）" help="超过此时长的视频跳过，专注短视频搬运。" name="task.discovery.shortVideo.maxDurationSec" type="number" min={1} defaultValue={getNested(settings, "task.discovery.shortVideo.maxDurationSec", 60)} className="w-28" />
              <LabelInput label="重复次数" help="命中视频渲染时的内容重复拼接次数。" name="task.discovery.shortVideo.repeatTimes" type="number" min={1} max={10} defaultValue={getNested(settings, "task.discovery.shortVideo.repeatTimes", 3)} className="w-28" />
            </SettingsSection>
            <SettingsSection title="定时" description="每天在该整点触发一次自动发现扫描。">
              <LabelInput label="执行时间（小时）" help="0-23，例如 1 表示每天凌晨 1 点执行。" name="task.discovery.scheduleHour" type="number" min={0} max={23} defaultValue={getNested(settings, "task.discovery.scheduleHour", 1)} className="w-28" />
            </SettingsSection>
            <SettingsSection title="目标平台" description="命中后创建的任务会自动发布到勾选的平台。">
              <div className="flex flex-wrap gap-x-6 gap-y-3 py-2.5">
                {(["bilibili", "douyin", "youtube", "tiktok"] as const).map((platform) => {
                  const selected = (getNested(settings, "task.discovery.targets", []) as string[]).includes(platform);
                  return (
                    <Label key={platform} htmlFor={`discovery-target-${platform}`} className="flex items-center gap-2 font-normal text-sm">
                      <Checkbox id={`discovery-target-${platform}`} name="task.discovery.targets" value={platform} defaultChecked={selected} />
                      {platformNames[platform] || platform}
                    </Label>
                  );
                })}
              </div>
            </SettingsSection>
            <SettingsSection title="手动触发" description="立即执行一次发现扫描，无需等待定时任务。">
              <div className="flex flex-wrap items-center gap-3 py-2.5">
                <Button type="button" onClick={runDiscoveryNow} disabled={discoveryRunning}>
                  {discoveryRunning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
                  立即执行
                </Button>
                {discoveryRunning && <span className="text-muted-foreground text-xs">发现任务正在运行中…</span>}
              </div>
            </SettingsSection>
            {discoveryRecord && (
              <div className="grid gap-3 rounded-lg border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-sm">最近一次运行</span>
                  <Badge className={cn(
                    discoveryRecord.lastRunStatus === "success" && "bg-emerald-600 text-white",
                    discoveryRecord.lastRunStatus === "running" && "bg-blue-600 text-white",
                    discoveryRecord.lastRunStatus === "failed" && "bg-destructive text-white",
                  )}>
                    {discoveryRecord.lastRunStatus === "success" ? "成功" : discoveryRecord.lastRunStatus === "running" ? "运行中" : "失败"}
                  </Badge>
                  {discoveryRecord.lastRunAt && (
                    <span className="text-muted-foreground text-xs">{new Date(discoveryRecord.lastRunAt).toLocaleString()}</span>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  扫描 {discoveryRecord.stats.scanned} → 硬过滤 {discoveryRecord.stats.hardFiltered} → 去重 {discoveryRecord.stats.deduped} → LLM 过滤 {discoveryRecord.stats.llmFiltered} → 创建 {discoveryRecord.stats.created}
                </p>
                {discoveryRecord.createdJobIds.length > 0 && (
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">创建的任务：</span>
                    <div className="flex flex-wrap gap-1">
                      {discoveryRecord.createdJobIds.map((id) => (
                        <Badge key={id} variant="outline" className="font-mono text-xs">{id}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {discoveryRecord.errors.length > 0 && (
                  <div className="grid gap-1">
                    <span className="text-xs text-destructive">错误：</span>
                    <ul className="grid gap-0.5 text-xs text-destructive">
                      {discoveryRecord.errors.map((err, idx) => (
                        <li key={err || `err-${idx}`} className="line-clamp-2">{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </SettingsPane>

          <SettingsPane active={activeSettings} id="prepare">
            <div className="rounded-lg border bg-card px-4 py-1">
              <SelectField name="task.prepare.outputAspect" label="默认输出画幅" help="短视频默认建议竖屏；横屏源视频会按适配方式处理。" defaultValue={getNested(settings, "task.prepare.outputAspect", "portrait")} options={[["portrait", "竖屏 9:16"], ["landscape", "横屏 16:9"], ["source", "保持原视频"]]} optionHelp={{ portrait: "输出 9:16 竖屏，适合短视频平台", landscape: "输出 16:9 横屏，适合 YouTube 等平台", source: "保持源视频原始比例，不做任何裁切" }} selectClassName="w-36" />
              <SelectField name="task.prepare.outputResolution" label="默认输出分辨率" help="最终渲染目标分辨率，选项与下载分辨率一致。" defaultValue={normalizedResolutionOption(getNested(settings, "task.prepare.outputResolution", "auto"))} options={resolutionOptions} optionHelp={resolutionOptionHelp} selectClassName="w-36" />
              <SelectField name="task.prepare.fitMode" label="画面适配方式" help="用于处理源视频比例和输出比例不一致的情况。" defaultValue={getNested(settings, "task.prepare.fitMode", "smart-crop")} options={[["smart-crop", "智能裁剪"], ["blur-background", "模糊背景补边"], ["keep-bars", "黑边保留"], ["center-crop", "居中裁剪"]]} optionHelp={{ "smart-crop": "AI 检测主体位置，智能居中裁剪，尽量保留画面重点", "blur-background": "将源视频缩放后居中，两侧用模糊背景填充，无内容损失", "keep-bars": "保持比例缩放，用黑边填充，内容完整但观感较差", "center-crop": "严格居中裁剪，不做智能识别，速度更快" }} selectClassName="w-36" />
              <SelectField name="task.prepare.subtitleCleanup" label="字幕整理" help="自动合并可以减少字幕过碎导致的闪烁。" defaultValue={getNested(settings, "task.prepare.subtitleCleanup", "merge-short")} options={[["merge-short", "自动合并短句"], ["keep", "保持原样"]]} optionHelp={{ "merge-short": "自动合并过短或间隔过近的字幕段，减少屏幕闪烁", keep: "保持字幕原始分段，适合有精确时间轴要求的场景" }} selectClassName="w-36" />
            </div>
          </SettingsPane>

          <SettingsPane active={activeSettings} id="translation">
            <div className="rounded-lg border bg-card px-4 py-1">
              <SelectField name="task.translation.targetLanguage" label="目标语言" defaultValue={getNested(settings, "task.translation.targetLanguage", "zh-CN")} options={languages.map((code) => [code, t(`languages.${code}`)])} selectClassName="w-36" />
              <SelectField name="task.translation.subtitleMode" label="字幕翻译" help="自动会根据来源语言和目标语言判断是否翻译。" defaultValue={getNested(settings, "task.translation.subtitleMode", "auto")} options={[["auto", "自动"], ["always", "总是翻译"], ["off", "不翻译"]]} optionHelp={{ auto: "根据来源语言和目标语言自动决定是否翻译", always: "不论来源语言，始终翻译字幕", off: "不翻译字幕，保持原文" }} selectClassName="w-36" />
              <SelectField name="task.translation.commentMode" label="评论翻译" help="自动会根据来源语言和目标语言判断是否翻译。" defaultValue={getNested(settings, "task.translation.commentMode", "auto")} options={[["auto", "自动"], ["always", "总是翻译"], ["off", "不翻译"]]} optionHelp={{ auto: "根据来源语言和目标语言自动决定是否翻译", always: "不论来源语言，始终翻译评论", off: "不翻译评论，保持原文" }} selectClassName="w-36" />
              <SwitchRow label="双语字幕" name="task.translation.bilingualSubtitles" help="开启后字幕同时显示原文和译文。" defaultChecked={getNested(settings, "task.translation.bilingualSubtitles", false)} />
              <SelectField name="task.translation.sensitiveContent" label="敏感内容处理" help="不单独设置审核提示词，统一由这里和通用提示词控制。" defaultValue={getNested(settings, "task.translation.sensitiveContent", "preserve")} options={[["preserve", "保留原意"], ["soften", "温和改写"], ["mark", "标记但保留"], ["delete", "删除"]]} optionHelp={{ preserve: "完整翻译，不做任何修改，保留原意", soften: "改写争议性表达，使语气更温和，适合全年龄平台", mark: "在敏感内容前后加注标记，提示人工审查", delete: "直接删除识别到的敏感内容片段" }} selectClassName="w-36" />
            </div>
            <FieldControl label="风格约束" help="可多选，用逗号分隔。">
              <Input name="task.translation.styleConstraints" defaultValue={listValue(getNested<JsonValue | undefined>(settings, "task.translation.styleConstraints", undefined), ["自然口语", "本土化表达"])} placeholder={styleConstraintOptions.join("，")} />
            </FieldControl>
            <div className="grid gap-3">
              <PromptField name="task.translation.prompts.subtitle" label="字幕翻译额外提示词" defaultValue={getNested(settings, "task.translation.prompts.subtitle", "")} />
              <PromptField name="task.translation.prompts.comment" label="评论翻译额外提示词" defaultValue={getNested(settings, "task.translation.prompts.comment", "")} />
            </div>
          </SettingsPane>

          <SettingsPane active={activeSettings} id="cover">
            <CoverCopyPane settings={settings} onChanged={() => { if (formRef.current) scheduleSave(formRef.current, 300); }} />
          </SettingsPane>

          <SettingsPane active={activeSettings} id="render">
            <div className="rounded-lg border bg-card px-4 py-1">
              <PathField name="task.render.outputDir" label="渲染输出位置" help="最终 mp4、封面图、渲染日志会输出到这里。" defaultValue={getNested(settings, "task.render.outputDir", "")} onChanged={() => { if (formRef.current) scheduleSave(formRef.current, 300); }} />
              <SwitchRow label="渲染评论" name="task.render.renderComments" help="开启后在视频上叠加评论弹幕效果。" defaultChecked={getNested(settings, "task.render.renderComments", true)} />
              <SelectField name="task.render.commentFontSize" label="评论字号" help="基于输出分辨率的比例系数。" defaultValue={getNested(settings, "task.render.commentFontSize", "medium")} options={[["small", "小"], ["medium", "中"], ["large", "大"]]} optionHelp={{ small: "字号较小，适合评论密集的内容", medium: "标准字号，适合大多数场景", large: "字号较大，适合横屏或在小屏幕查看" }} selectClassName="w-28" />
              <SelectField name="task.render.commentLineHeight" label="评论行距" help="控制评论行与行之间的间距。" defaultValue={getNested(settings, "task.render.commentLineHeight", "standard")} options={[["compact", "紧凑"], ["standard", "标准"], ["loose", "宽松"]]} optionHelp={{ compact: "紧凑行距，单屏可显示更多评论", standard: "标准行距，阅读体验均衡", loose: "宽松行距，提高可读性" }} selectClassName="w-28" />
              <SelectField name="task.render.subtitleFontSize" label="字幕字号" help="基于输出分辨率的比例系数。" defaultValue={getNested(settings, "task.render.subtitleFontSize", "medium")} options={[["small", "小"], ["medium", "中"], ["large", "大"]]} optionHelp={{ small: "字号较小，适合字幕较密集的内容", medium: "标准字号，适合大多数场景", large: "字号较大，提高可读性" }} selectClassName="w-28" />
              <SelectField name="task.render.subtitleLineHeight" label="字幕行距" help="控制字幕行与行之间的间距。" defaultValue={getNested(settings, "task.render.subtitleLineHeight", "standard")} options={[["compact", "紧凑"], ["standard", "标准"], ["loose", "宽松"]]} optionHelp={{ compact: "紧凑行距，减少字幕占用画面空间", standard: "标准行距，阅读体验均衡", loose: "宽松行距，提高可读性" }} selectClassName="w-28" />
              <SelectField name="task.render.commentContent" label="评论显示内容" help="控制评论显示原文还是译文。" defaultValue={getNested(settings, "task.render.commentContent", "original-translated")} options={[["original-translated", "原文 + 译文"], ["translated-only", "仅译文"]]} optionHelp={{ "original-translated": "同时显示原文和译文，适合双语对比场景", "translated-only": "只显示翻译后的内容" }} selectClassName="w-28" />
              <SelectField name="task.render.longCommentBehavior" label="长评论换行" help="当评论内容超出单行宽度时的处理方式。" defaultValue={getNested(settings, "task.render.longCommentBehavior", "wrap")} options={[["wrap", "自动换行"], ["truncate", "截断"], ["shrink", "缩小字号"]]} optionHelp={{ wrap: "自动换行，保留完整内容", truncate: "超长内容截断并显示省略号", shrink: "保持单行，自动缩小字号" }} selectClassName="w-28" />
              <LabelInput label="重复次数" help="将视频内容重复拼接的次数，用于制作循环内容。" name="task.render.repeatTimes" type="number" min={1} max={10} defaultValue={getNested(settings, "task.render.repeatTimes", 1)} className="w-28" />
              <SelectField name="task.render.outputFormat" label="输出格式" help="最终视频文件的封装格式。" defaultValue={getNested(settings, "task.render.outputFormat", "mp4")} options={[["mp4", "mp4"], ["mov", "mov"]]} optionHelp={{ mp4: "H.264/H.265 封装，兼容性最佳，适合所有平台", mov: "QuickTime 容器，适合特定编辑软件或 ProRes 场景" }} selectClassName="w-28" />
            </div>
          </SettingsPane>

          <SettingsPane active={activeSettings} id="publish">
            <Tabs defaultValue="bilibili">
              <TabsList className="flex h-auto w-full gap-1 rounded-lg bg-muted p-1">
                {targetPlatforms.map((platform) => (
                  <TabsTrigger key={platform} value={platform} className="flex-1">
                    {platformNames[platform] || platform}
                  </TabsTrigger>
                ))}
              </TabsList>
              {targetPlatforms.map((platform) => (
                <TabsContent key={platform} value={platform} className="mt-4">
                  <div className="grid gap-4">
                    {/* 通用 */}
                    <div className="rounded-lg border bg-card px-4 py-1">
                      <div className="py-3"><h3 className="font-medium text-sm">通用</h3></div>
                      <SettingRow label="启用" help="是否将此平台加入新任务的默认目标平台列表。">
                        <Switch
                          checked={settingsTargets.includes(platform)}
                          onCheckedChange={(checked) => {
                            setSettingsTargets((prev) => checked ? [...prev, platform] : prev.filter((p) => p !== platform));
                            setSettingsTargetsVersion((v) => v + 1);
                          }}
                        />
                      </SettingRow>
                      <SelectField name={`task.publish.platformConfigs.${platform}.defaultAction`} label="默认动作" help="保存草稿不立即公开；直接发布立即对外可见。" defaultValue={getNested(settings, `task.publish.platformConfigs.${platform}.defaultAction`, "publish")} options={[["draft", "保存草稿"], ["publish", "立即发布"]]} optionHelp={{ draft: "完成处理后保存为平台草稿，不立即公开", publish: "完成处理后直接发布，立即对外公开" }} selectClassName="w-48" />
                      <LabelInput label="失败重试次数" help="发布失败后的最大重试次数。" name={`task.publish.platformConfigs.${platform}.retryCount`} type="number" min={0} max={10} defaultValue={getNested(settings, `task.publish.platformConfigs.${platform}.retryCount`, 1)} className="w-48" />
                    </div>
                    {/* 平台特殊配置 */}
                    <div className="rounded-lg border bg-card px-4 py-1">
                      <div className="py-3"><h3 className="font-medium text-sm">平台特殊配置</h3></div>
                      {platform === "bilibili" && (<>
                        <SelectField name="task.publish.platformConfigs.bilibili.category" label="分区" help="B 站视频投稿分区。" defaultValue={getNested(settings, "task.publish.platformConfigs.bilibili.category", "汽车")} options={[["影视", "影视"], ["娱乐", "娱乐"], ["音乐", "音乐"], ["舞蹈", "舞蹈"], ["动画", "动画"], ["绘画", "绘画"], ["鬼畜", "鬼畜"], ["游戏", "游戏"], ["资讯", "资讯"], ["知识", "知识"], ["人工智能", "人工智能"], ["科技数码", "科技数码"], ["汽车", "汽车"], ["时尚美妆", "时尚美妆"], ["家装房产", "家装房产"], ["户外潮流", "户外潮流"], ["健身", "健身"], ["体育运动", "体育运动"], ["手工", "手工"], ["美食", "美食"], ["小剧场", "小剧场"], ["旅游出行", "旅游出行"], ["三农", "三农"], ["动物", "动物"], ["亲子", "亲子"], ["健康", "健康"], ["情感", "情感"], ["vlog", "vlog"], ["生活兴趣", "生活兴趣"], ["生活经验", "生活经验"]]} selectClassName="w-48" />
                        <SelectField name="task.publish.platformConfigs.bilibili.declaration" label="创作声明" help="B 站发布时的创作声明标注。" defaultValue={getNested(settings, "task.publish.platformConfigs.bilibili.declaration", "内容为转载")} options={[["内容无需标注", "内容无需标注"], ["含AI生成内容", "含AI生成内容"], ["含虚构演绎内容", "含虚构演绎内容"], ["内容含营销信息", "内容含营销信息"], ["个人观点仅供参考", "个人观点仅供参考"], ["内容为转载", "内容为转载"], ["内容为自制：未经作者允许禁止转载", "内容为自制：未经作者允许禁止转载"]]} selectClassName="w-48" />
                        <LabelInput label="固定标签" help="与 AI 生成的标签一起发布，优先级高于 AI 生成的标签。" name="task.publish.platformConfigs.bilibili.tags" defaultValue={getNested(settings, "task.publish.platformConfigs.bilibili.tags", "")} className="w-48" />
                      </>)}
                      {platform === "douyin" && (<>
                        <SelectField name="task.publish.platformConfigs.douyin.declarationType" label="声明类型" help="转载需声明来源；原创需满足抖音原创要求。" defaultValue={getNested(settings, "task.publish.platformConfigs.douyin.declarationType", "转载")} options={[["转载", "转载"], ["原创", "原创"]]} optionHelp={{ "转载": "声明为转载内容，需注明来源", "原创": "声明为原创内容，须符合平台原创认定标准" }} selectClassName="w-48" />
                        <SelectField name="task.publish.platformConfigs.douyin.visibility" label="可见性" help="控制谁可以看到这个视频。" defaultValue={getNested(settings, "task.publish.platformConfigs.douyin.visibility", "公开")} options={[["公开", "公开"], ["好友可见", "好友可见"], ["仅自己", "仅自己"]]} optionHelp={{ "公开": "所有人均可查看", "好友可见": "仅互相关注的好友可查看", "仅自己": "仅自己可见，适合暂存草稿" }} selectClassName="w-48" />
                        <LabelInput label="话题" help="空格分隔的话题标签，不需要加 #。" name="task.publish.platformConfigs.douyin.topics" defaultValue={getNested(settings, "task.publish.platformConfigs.douyin.topics", "")} className="w-48" />
                      </>)}
                      {platform === "xiaohongshu" && (<>
                        <SelectField name="task.publish.platformConfigs.xiaohongshu.visibility" label="可见性" help="控制谁可以看到这篇笔记。" defaultValue={getNested(settings, "task.publish.platformConfigs.xiaohongshu.visibility", "公开")} options={[["公开", "公开"], ["仅自己", "仅自己"]]} optionHelp={{ "公开": "所有人均可查看", "仅自己": "仅自己可见" }} selectClassName="w-48" />
                        <LabelInput label="话题" help="空格分隔的话题标签，不需要加 #。" name="task.publish.platformConfigs.xiaohongshu.topics" defaultValue={getNested(settings, "task.publish.platformConfigs.xiaohongshu.topics", "")} className="w-48" />
                      </>)}
                      {platform === "youtube" && (<>
                        <LabelInput label="分类" help="YouTube 视频分类，如 Autos & Vehicles。" name="task.publish.platformConfigs.youtube.category" defaultValue={getNested(settings, "task.publish.platformConfigs.youtube.category", "Autos & Vehicles")} className="w-48" />
                        <SelectField name="task.publish.platformConfigs.youtube.visibility" label="可见性" help="控制谁可以看到这个视频。" defaultValue={getNested(settings, "task.publish.platformConfigs.youtube.visibility", "private")} options={[["public", "Public"], ["unlisted", "Unlisted"], ["private", "Private"]]} optionHelp={{ "public": "所有人均可搜索和查看", "unlisted": "有链接的人可查看，不在搜索结果中出现", "private": "仅自己可见，适合暂存或审阅" }} selectClassName="w-48" />
                        <LabelInput label="标签" help="逗号分隔的关键词标签。" name="task.publish.platformConfigs.youtube.tags" defaultValue={getNested(settings, "task.publish.platformConfigs.youtube.tags", "")} className="w-48" />
                      </>)}
                      {platform === "tiktok" && (<>
                        <SelectField name="task.publish.platformConfigs.tiktok.privacy" label="可见性" help="控制谁可以看到这个视频。" defaultValue={getNested(settings, "task.publish.platformConfigs.tiktok.privacy", "SELF_ONLY")} options={[["PUBLIC_TO_EVERYONE", "所有人"], ["MUTUAL_FOLLOW_FRIENDS", "互关好友"], ["FOLLOWER_OF_CREATOR", "我的粉丝"], ["SELF_ONLY", "仅自己"]]} optionHelp={{ "PUBLIC_TO_EVERYONE": "任何人都可以查看", "MUTUAL_FOLLOW_FRIENDS": "仅互相关注的用户可查看", "FOLLOWER_OF_CREATOR": "仅关注你的用户可查看", "SELF_ONLY": "仅自己可见，适合测试和审阅" }} selectClassName="w-48" />
                        <SwitchRow label="允许评论" name="task.publish.platformConfigs.tiktok.allowComment" help="允许其他用户在视频下评论。" defaultChecked={getNested(settings, "task.publish.platformConfigs.tiktok.allowComment", true)} />
                        <SwitchRow label="允许 Duet" name="task.publish.platformConfigs.tiktok.allowDuet" help="允许其他用户与此视频合拍。" defaultChecked={getNested(settings, "task.publish.platformConfigs.tiktok.allowDuet", false)} />
                        <SwitchRow label="允许 Stitch" name="task.publish.platformConfigs.tiktok.allowStitch" help="允许其他用户截取此视频拼接到自己的作品中。" defaultChecked={getNested(settings, "task.publish.platformConfigs.tiktok.allowStitch", false)} />
                        <SwitchRow label="AI 生成内容声明" name="task.publish.platformConfigs.tiktok.isAigc" help="声明视频为 AI 辅助生成内容（AIGC）。" defaultChecked={getNested(settings, "task.publish.platformConfigs.tiktok.isAigc", false)} />
                      </>)}
                      {platform === "instagram" && (<>
                        <SelectField name="task.publish.platformConfigs.instagram.visibility" label="可见性" help="控制谁可以看到这个帖子。" defaultValue={getNested(settings, "task.publish.platformConfigs.instagram.visibility", "private")} options={[["public", "Public"], ["private", "Private"]]} optionHelp={{ "public": "所有人均可查看", "private": "仅粉丝可查看（需要申请关注）" }} selectClassName="w-48" />
                        <LabelInput label="Hashtags" help="空格分隔的标签，不需要加 #。" name="task.publish.platformConfigs.instagram.hashtags" defaultValue={getNested(settings, "task.publish.platformConfigs.instagram.hashtags", "")} className="w-48" />
                      </>)}
                      {platform === "x" && (<>
                        <SelectField name="task.publish.platformConfigs.x.replySettings" label="回复权限" help="控制谁可以回复这条推文。" defaultValue={getNested(settings, "task.publish.platformConfigs.x.replySettings", "everyone")} options={[["everyone", "所有人"], ["followers", "关注者"], ["mentioned_users", "仅被提及的人"]]} optionHelp={{ "everyone": "任何人都可以回复", "followers": "仅关注你的用户可以回复", "mentioned_users": "仅在推文中被提及的用户可以回复" }} selectClassName="w-48" />
                        <SwitchRow label="标记为敏感内容" name="task.publish.platformConfigs.x.isSensitive" help="将帖子标记为敏感内容，查看时需要点击确认。" defaultChecked={getNested(settings, "task.publish.platformConfigs.x.isSensitive", false)} />
                        <LabelInput label="Hashtags" help="空格分隔的标签，不需要加 #。" name="task.publish.platformConfigs.x.hashtags" defaultValue={getNested(settings, "task.publish.platformConfigs.x.hashtags", "")} className="w-48" />
                      </>)}
                    </div>
                    {/* 额外提示词 */}
                    <div className="grid gap-3">
                      <PromptField name={`task.publish.platformConfigs.${platform}.prompts.title`} label="标题额外提示词" defaultValue={getNested(settings, `task.publish.platformConfigs.${platform}.prompts.title`, "")} />
                      <PromptField name={`task.publish.platformConfigs.${platform}.prompts.description`} label="描述额外提示词" defaultValue={getNested(settings, `task.publish.platformConfigs.${platform}.prompts.description`, "")} />
                      <PromptField name={`task.publish.platformConfigs.${platform}.prompts.tags`} label="标签/话题额外提示词" defaultValue={getNested(settings, `task.publish.platformConfigs.${platform}.prompts.tags`, "")} />
                    </div>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </SettingsPane>

          <SettingsPane active={activeSettings} id="llm">
            <SettingsSection title="LLM" description="配置兼容 OpenAI API 格式的模型服务。">
              <WideLabelInput label="URL" help="兼容 OpenAI API 格式的基础地址。" name="llm.baseUrl" placeholder="https://ark.cn-beijing.volces.com/api/v3" defaultValue={getNested(settings, "llm.baseUrl", "")} />
              <WideLabelInput label="模型名称" name="llm.textModel" placeholder="doubao-seed-2-0-mini-260428" defaultValue={getNested(settings, "llm.textModel", "gpt-4.1-mini")} />
              <WideLabelInput label="API Key" name="llm.apiKey" type="password" placeholder="填入火山方舟 API Key" defaultValue={getNested(settings, "llm.apiKey", "")} />
            </SettingsSection>
          </SettingsPane>

          <SettingsPane active={activeSettings} id="agent">
            <SettingsSection title="给 Agent 的配置指令" description="把下面这段话复制后直接发给你的 Agent（OpenClaw、Hermes 等），它会按说明安装服务并配置好 MCP。">
              <div className="py-3">
                <div className="relative">
                  <Textarea
                    readOnly
                    value={AGENT_INSTRUCTION}
                    aria-label="给 Agent 的配置指令"
                    className="min-h-[360px] resize-none bg-muted/40 font-mono text-xs leading-relaxed"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="absolute top-2 right-2 gap-1"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(AGENT_INSTRUCTION);
                        toast.success("已复制，直接发给你的 Agent 即可");
                      } catch {
                        toast.error("复制失败，请手动选择文本复制");
                      }
                    }}
                  >
                    <Copy className="size-3.5" />
                    复制
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  无需在本地做任何配置——这段指令已包含安装命令和 MCP 接入方式，Agent 收到后即可自行完成。
                </p>
              </div>
            </SettingsSection>
          </SettingsPane>
        </div>
      </div>
    </form>
  );

  if (view === "jobs") {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">{jobsTable}{jobDetail}</div>
    );
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

  if (view === "settings") {
    return settingsPanel;
  }

  return <div className="grid gap-4">{jobsTable}</div>;
}

function cleanId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function HelpTooltip({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex size-4 cursor-help items-center justify-center rounded-full border text-[10px] text-muted-foreground">?</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs">
        <p>{children}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function FieldLabel({ id, label, help }: { id?: string; label: string; help?: React.ReactNode }) {
  return (
    <div className="flex min-h-5 items-center gap-1.5">
      <Label htmlFor={id} className="font-medium text-sm">{label}</Label>
      <HelpTooltip>{help}</HelpTooltip>
    </div>
  );
}

function FieldControl({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <FieldLabel label={label} help={help} />
      {children}
    </div>
  );
}

// Horizontal row: help goes to ? tooltip; description shows current option behavior.
function SettingRow({ label, help, description, children }: { label: string; help?: React.ReactNode; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-6 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 font-medium text-sm leading-snug">
          {label}
          <HelpTooltip>{help}</HelpTooltip>
        </div>
        {description && <div className="mt-0.5 text-muted-foreground text-xs leading-snug">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SelectField({ name, label, help, defaultValue, options, optionHelp, selectClassName }: {
  name: string;
  label: string;
  help?: React.ReactNode;
  defaultValue?: string;
  options: Array<[string, string]>;
  optionHelp?: Record<string, string>;
  selectClassName?: string;
}) {
  const [currentValue, setCurrentValue] = React.useState(defaultValue ?? "");
  const controlId = cleanId(name);
  return (
    <SettingRow label={label} help={help} description={optionHelp?.[currentValue]}>
      <NativeSelect id={controlId} name={name} defaultValue={defaultValue} className={selectClassName} onChange={(e) => setCurrentValue((e.target as HTMLSelectElement).value)}>
        {options.map(([value, optionLabel]) => (
          <NativeSelectOption key={value} value={value}>{optionLabel}</NativeSelectOption>
        ))}
      </NativeSelect>
    </SettingRow>
  );
}

function LabelInput({ label, help, className, ...props }: React.ComponentProps<typeof Input> & { label: string; help?: React.ReactNode }) {
  const controlId = props.id || cleanId(String(props.name || label));
  return (
    <SettingRow label={label} help={help}>
      <Input {...props} id={controlId} className={cn("w-28", className)} />
    </SettingRow>
  );
}

function WideLabelInput({ label, help, className, ...props }: React.ComponentProps<typeof Input> & { label: string; help?: React.ReactNode }) {
  const controlId = props.id || cleanId(String(props.name || label));
  return (
    <div className="flex min-h-10 items-center gap-6 py-2.5">
      <div className="flex w-28 shrink-0 items-center gap-1 font-medium text-sm leading-snug">
        {label}
        <HelpTooltip>{help}</HelpTooltip>
      </div>
      <div className="min-w-0 flex-1">
        <Input {...props} id={controlId} className={cn("w-full", className)} />
      </div>
    </div>
  );
}

function PathField({ label, help, name, defaultValue, onChanged }: { label: string; help?: React.ReactNode; name: string; defaultValue?: string; onChanged?: () => void }) {
  const [value, setValue] = React.useState(defaultValue ?? "");
  async function browse() {
    try {
      const res = await jsonFetch<{ path: string }>("/api/pick-directory", { method: "POST" });
      if (res.path) {
        setValue(res.path);
        onChanged?.();
      }
    } catch { /* ignore */ }
  }
  return (
    <SettingRow label={label} help={help}>
      <div className="flex items-center gap-1.5">
        <Input name={name} value={value} onChange={(e) => setValue(e.target.value)} className="w-56" />
        <Button type="button" variant="outline" size="sm" onClick={browse} title="选择文件夹">
          <FolderOpen className="size-3.5" />
        </Button>
      </div>
    </SettingRow>
  );
}

function SwitchRow({ label, name, defaultChecked, help }: { label: string; name: string; defaultChecked?: boolean; help?: React.ReactNode }) {
  const controlId = cleanId(name);
  return (
    <SettingRow label={label} help={help}>
      <Switch id={controlId} name={name} defaultChecked={defaultChecked} />
    </SettingRow>
  );
}

function PromptField({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <FieldControl label={label} help="只追加本项对应任务的额外约束；不会替代系统内置提示词。">
      <Textarea name={name} defaultValue={defaultValue} className="min-h-24 resize-y" />
    </FieldControl>
  );
}

// 封面与文案：先选模板（卡片）→ 选封面图来源（固定帧 / AI 选帧）→ 选文案来源（无 / 固定 / AI）。
function CoverCopyPane({ settings, onChanged }: { settings: SettingsShape | null; onChanged?: () => void }) {
  const [template, setTemplate] = React.useState(normalizeCoverTemplateId(getNested(settings, "task.coverAndCopy.template", DEFAULT_COVER_TEMPLATE)));
  const [imageMode, setImageMode] = React.useState(getNested(settings, "task.coverAndCopy.imageMode", "ai"));
  const [copyMode, setCopyMode] = React.useState(getNested(settings, "task.coverAndCopy.copyMode", "ai"));
  const [aiPrompt, setAiPrompt] = React.useState(getNested(settings, "task.coverAndCopy.aiPrompt", "") || coverTemplateAiPrompt(template));
  const noTemplate = isNoTemplate(template);

  function onTemplateChange(value: string) {
    setTemplate(value);
    setAiPrompt(coverTemplateAiPrompt(value));
    window.setTimeout(() => onChanged?.(), 0);
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-1">
      <input type="hidden" name="task.coverAndCopy.template" value={template} />
      <div className="py-2.5">
        <FieldLabel label="封面模板" help="决定封面的视觉风格（配色、描边、文字样式），渲染时会真实套用所选模板。" />
        <div className="mt-2 grid grid-cols-2 gap-3">
          {COVER_TEMPLATE_IDS.map((name) => {
            const selected = template === name;
            const svgPreview = isNoTemplate(name)
              ? null
              : buildCoverSvg(name, coverTemplateSampleText(name), { width: 480, height: 270 });

            return (
              <button
                type="button"
                key={name}
                onClick={() => onTemplateChange(name)}
                className={cn(
                  "group relative overflow-hidden rounded-lg border-2 text-left transition",
                  selected ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-border",
                )}
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-zinc-900">
                  {isNoTemplate(name) ? (
                    <div
                      className="flex h-full w-full items-center justify-center font-medium text-[10px] text-zinc-500"
                      style={{ background: coverTemplateSampleBg(name) }}
                    >
                      纯画面 · 无文字
                    </div>
                  ) : (
                    // biome-ignore lint/performance/noImgElement: preview uses an in-memory SVG data URI, not a remote asset.
                    <img
                      alt={`${name} 封面模板预览`}
                      className="h-full w-full object-cover"
                      src={svgDataUri(svgPreview || "")}
                      style={{ background: coverTemplateSampleBg(name), backgroundSize: "cover" }}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between bg-card px-2 py-1.5 text-[11px]">
                  <span className="font-medium">{name}</span>
                  {selected && <CheckCircle2 className="size-3 text-primary" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <SettingRow label="封面图" help="选择封面画面的来源。" description={imageMode === "fixed" ? "使用视频中固定的某一帧作为封面画面。" : "固定抽取 5 帧交给 AI 选最佳画面；模型无多模态能力时从 5 帧中随机选 1 帧。"}>
        <NativeSelect name="task.coverAndCopy.imageMode" value={imageMode} onChange={(e) => setImageMode((e.target as HTMLSelectElement).value)} className="w-36">
          <NativeSelectOption value="fixed">固定帧</NativeSelectOption>
          <NativeSelectOption value="ai">AI 选帧</NativeSelectOption>
        </NativeSelect>
      </SettingRow>
      {imageMode === "fixed" && (
        <LabelInput label="帧编号" help="从 0 开始计数，0 表示第一帧。" name="task.coverAndCopy.fixedFrameIndex" type="number" min={0} defaultValue={getNested(settings, "task.coverAndCopy.fixedFrameIndex", 0)} className="w-28" />
      )}

      {noTemplate ? (
        <input type="hidden" name="task.coverAndCopy.copyMode" value="none" />
      ) : (
        <>
          <SettingRow label="封面文案" help="选择封面上叠加文字的来源。" description={copyMode === "none" ? "封面不叠加任何文字，仅使用画面。" : copyMode === "fixed" ? "使用下方手动填写的固定文案。" : "由 AI 根据视频内容生成封面文案，可编辑提示词。"}>
            <NativeSelect name="task.coverAndCopy.copyMode" value={copyMode} onChange={(e) => setCopyMode((e.target as HTMLSelectElement).value)} className="w-36">
              <NativeSelectOption value="none">无文案</NativeSelectOption>
              <NativeSelectOption value="fixed">固定文案</NativeSelectOption>
              <NativeSelectOption value="ai">AI 文案</NativeSelectOption>
            </NativeSelect>
          </SettingRow>

          {copyMode === "fixed" && (
            <div className="grid gap-3 rounded-lg bg-muted/30 p-3 md:grid-cols-2" key={template}>
              <div className="md:col-span-2">
                <p className="text-muted-foreground text-xs">
                  当前模板需要 {coverTemplateFields(template).length} 行固定文案，输入框顺序对应预览里的文字层级和位置。
                </p>
              </div>
              {coverTemplateFields(template).map((field) => (
                <LabelInput key={field.key} label={field.label} name={`task.coverAndCopy.fixedCopy.${field.key}`} placeholder={field.placeholder} defaultValue={getNested(settings, `task.coverAndCopy.fixedCopy.${field.key}`, "")} className="w-full" />
              ))}
            </div>
          )}

          {copyMode === "ai" && (
            <FieldControl label="AI 文案提示词" help="作为封面文案生成的额外约束；每个模板有默认提示词，可自行修改。">
              <Textarea name="task.coverAndCopy.aiPrompt" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} className="min-h-24 resize-y" />
            </FieldControl>
          )}
        </>
      )}
    </div>
  );
}

function SettingsSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0 rounded-lg border bg-card px-4 py-1">
      <div className="py-3">
        <h3 className="font-medium text-sm">{title}</h3>
        {description && <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function SettingsPane({ active, id, children }: { active: string; id: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid gap-4", active !== id && "hidden")}>
      {children}
    </div>
  );
}

function SettingsAccordionItem({ value, title, description, icon: Icon, compact = false, autoHeight = false, children }: {
  value: string;
  title: string;
  description: string;
  icon?: React.ElementType;
  compact?: boolean;
  autoHeight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className={cn("rounded-lg border bg-card", compact ? "px-3" : "px-4")}>
      <AccordionTrigger className={cn("items-center gap-3 text-left hover:no-underline", compact ? "py-3" : "py-4")}>
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground", compact ? "size-6" : "size-7")}>
              <Icon className={compact ? "size-3" : "size-3.5"} />
            </span>
          )}
          <div className="min-w-0">
            <div className="font-medium text-sm">{title}</div>
            <div className="mt-0.5 text-muted-foreground text-xs">{description}</div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className={cn("grid gap-4", compact ? "pb-3" : "pb-4", autoHeight && "h-auto")}>
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function DialogRow({ icon: Icon, label, children }: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="flex w-40 shrink-0 items-center gap-2 text-muted-foreground text-sm">
        <Icon className="size-4" />
        <span className="whitespace-nowrap">{label}</span>
      </div>
      <span className="shrink-0 select-none text-muted-foreground/40 text-sm">:</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {children}
      </div>
    </div>
  );
}

function HeartIcon(props: React.ComponentProps<typeof Activity>) {
  return <Activity {...props} />;
}
