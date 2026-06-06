"use client";

import * as React from "react";

import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  Globe,
  Layers,
  Link2,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Rocket,
  RotateCcw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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

const coverTemplates = ["汽车测评", "海外评论", "科技产品", "新闻解说", "财经商业", "生活方式", "搞笑吐槽", "教程知识", "对比盘点", "极简无字"];
const styleConstraintOptions = ["自然口语", "保守直译", "短视频口吻", "新闻解说", "专业测评", "夸张吸睛", "幽默吐槽", "克制高级", "本土化表达", "保留原文语气", "适合 B 站", "适合抖音", "适合小红书", "适合 YouTube"];
const agentChannels = [
  ["wechat", "微信"],
  ["wecom", "企业微信"],
  ["lark", "飞书"],
  ["dingtalk", "钉钉"],
  ["qq", "QQ"],
  ["telegram", "Telegram"],
  ["discord", "Discord"],
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

function listValue(value: JsonValue | undefined, fallback: string[]) {
  return stringArray(value, fallback).join("，");
}

function formString(data: FormData, key: string, fallback = "") {
  const value = data.get(key);
  return typeof value === "string" ? value : fallback;
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
  const numericFields = new Set([
    "task.download.commentSeconds",
    "task.download.maxComments",
    "task.download.retryCount",
    "task.download.timeoutSec",
    "task.coverAndCopy.frameSampleCount",
    "task.coverAndCopy.titleMaxLength",
    "task.render.repeatTimes",
    "task.publish.retryCount",
    "llm.timeoutSec",
    "llm.retryCount",
  ]);
  return numericFields.has(name) ? Number(raw || 0) : raw;
}

function agentChannel(settings: SettingsShape | null, type: string) {
  const channels = getNested<JsonValue | undefined>(settings, "agent.channels", undefined);
  if (!Array.isArray(channels)) return {};
  const match = channels.find((item) => item && typeof item === "object" && (item as Record<string, JsonValue>).type === type);
  return match && typeof match === "object" ? match : {};
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
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [promptPanelOpen, setPromptPanelOpen] = React.useState(false);
  const [repeatTimes, setRepeatTimes] = React.useState(1);
  const [createTargets, setCreateTargets] = React.useState<string[]>(["bilibili"]);
  const [settingsTargets, setSettingsTargets] = React.useState<string[]>(["bilibili"]);
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
        const text = `${job.id} ${job.source?.url || ""} ${jobTitle(job)}`.toLowerCase();
        return (statusFilter === "all" || status === statusFilter) && (!normalized || text.includes(normalized));
      })
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }, [jobs, query, queue, statusFilter]);

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
          source: { url, platform: formString(data, "sourcePlatform", "auto") },
          targets: createTargets.map((platform) => ({ platform })),
          options: {
            repeatTimes: nextRepeatTimes,
            downloadQuality: formString(data, "downloadQuality", "auto"),
            outputAspect: formString(data, "outputAspect", "portrait"),
            outputResolution: formString(data, "outputResolution", "1080x1920"),
            renderComments: data.get("renderComments") === "on",
            targetLanguage: formString(data, "targetLanguage", "zh-CN"),
            publishAction: formString(data, "publishAction", "draft"),
            coverMode: formString(data, "coverMode", "template-ai-copy"),
            coverTemplate: formString(data, "coverTemplate", "汽车测评"),
            fixedCoverCopy: formString(data, "fixedCoverCopy", ""),
            bilingualSubtitles: data.get("bilingualSubtitles") === "on",
            promptOverrides: {
              subtitle: formString(data, "promptSubtitle"),
              comment: formString(data, "promptComment"),
              title: formString(data, "promptTitle"),
              description: formString(data, "promptDescription"),
              tags: formString(data, "promptTags"),
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

  const saveSettings = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload: SettingsShape = { version: 2, task: {}, llm: {}, agent: {} };
    const booleanFields = new Set([
      "task.translation.bilingualSubtitles",
      "task.render.renderComments",
      "task.publish.preflightChecks.login",
      "task.publish.preflightChecks.files",
      "task.publish.preflightChecks.copy",
      "task.publish.preflightChecks.adapter",
      "agent.enabled",
    ]);

    data.forEach((value, name) => {
      if (!name.startsWith("task.") && !name.startsWith("llm.") && !name.startsWith("agent.")) return;
      if (name.startsWith("agent.channels.")) return;
      if (booleanFields.has(name)) return;
      setPath(payload as Record<string, unknown>, name, parseFieldValue(name, value));
    });

    booleanFields.forEach((name) => {
      setPath(payload as Record<string, unknown>, name, data.get(name) === "on");
    });
    setPath(payload as Record<string, unknown>, "task.publish.defaultPlatforms", settingsTargets);
    setPath(payload as Record<string, unknown>, "agent.channels", agentChannels.map(([type]) => ({
      type,
      enabled: data.get(`agent.channels.${type}.enabled`) === "on",
      binding: formString(data, `agent.channels.${type}.binding`),
      notificationLevel: formString(data, `agent.channels.${type}.notificationLevel`, "failures"),
      allowRemoteActions: data.get(`agent.channels.${type}.allowRemoteActions`) === "on",
    })));

    void mutate("settings", async () => {
      const response = await jsonFetch<{ settings: SettingsShape }>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSettings(response.settings);
    });
  };

  const platformChooser = (value: string[], onChange: React.Dispatch<React.SetStateAction<string[]>>) => (
    <div className="flex flex-wrap gap-2">
      {targetPlatforms.map((platform) => {
        const checked = value.includes(platform);
        return (
          <Button
            key={platform}
            type="button"
            variant={checked ? "default" : "outline"}
            size="sm"
            onClick={() => onChange((current) => checked ? current.filter((item) => item !== platform) : [...current, platform])}
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
      <DialogContent className="!block !max-w-[calc(100vw-2rem)] !gap-0 sm:!max-w-[720px] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-hidden p-0">
        {/* Header */}
        <div className="shrink-0 border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle className="font-semibold text-base">创建新任务</DialogTitle>
            <DialogDescription className="text-xs">粘贴视频链接，按需调整下方选项。</DialogDescription>
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
          </div>

          {/* Core options — icon | label : control rows */}
          <div className="grid gap-1 px-6 py-1">
            <DialogRow icon={RotateCcw} label="重复次数">
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
                <span className="text-muted-foreground text-xs">次（最多 10）</span>
              </div>
            </DialogRow>

            <DialogRow icon={MessageSquare} label="渲染评论">
              <Switch
                name="renderComments"
                defaultChecked={getNested(settings, "task.render.renderComments", true)}
              />
            </DialogRow>

            <DialogRow icon={Globe} label="目标平台">
              {platformChooser(createTargets, setCreateTargets)}
            </DialogRow>

            <DialogRow icon={Send} label="发布方式">
              <NativeSelect
                name="publishAction"
                defaultValue={getNested(settings, "task.publish.defaultAction", "publish")}
                className="max-w-44"
              >
                <NativeSelectOption value="draft">保存平台草稿</NativeSelectOption>
                <NativeSelectOption value="publish">立即发布</NativeSelectOption>
              </NativeSelect>
            </DialogRow>
          </div>

          {/* Advanced collapsible sections */}
          <div className="px-4 py-2">
            <div className="mb-2 px-2">
              <span className="select-none text-muted-foreground text-xs">高级选项</span>
            </div>
            <Accordion type="multiple" defaultValue={[]} className="grid gap-1.5">
              <SettingsAccordionItem value="download" title="下载设置" description="视频质量、输出画幅和来源平台。" icon={SlidersHorizontal} compact>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldControl label="视频下载分辨率" help="平台不支持时自动 fallback 到最近版本。">
                    <NativeSelect name="downloadQuality" defaultValue={getNested(settings, "task.download.videoQuality", "auto")}>
                      <NativeSelectOption value="auto">自动</NativeSelectOption>
                      <NativeSelectOption value="best">最高清</NativeSelectOption>
                      <NativeSelectOption value="1080p">1080p</NativeSelectOption>
                      <NativeSelectOption value="720p">720p</NativeSelectOption>
                      <NativeSelectOption value="480p">480p</NativeSelectOption>
                    </NativeSelect>
                  </FieldControl>
                  <FieldControl label="输出画幅">
                    <NativeSelect name="outputAspect" defaultValue={getNested(settings, "task.prepare.outputAspect", "portrait")}>
                      <NativeSelectOption value="auto">自动</NativeSelectOption>
                      <NativeSelectOption value="portrait">竖屏 9:16</NativeSelectOption>
                      <NativeSelectOption value="landscape">横屏 16:9</NativeSelectOption>
                      <NativeSelectOption value="source">保持原视频</NativeSelectOption>
                    </NativeSelect>
                  </FieldControl>
                  <FieldControl label="输出分辨率">
                    <NativeSelect name="outputResolution" defaultValue={getNested(settings, "task.prepare.outputResolution", "1080x1920")}>
                      <NativeSelectOption value="auto">自动</NativeSelectOption>
                      <NativeSelectOption value="1080x1920">1080x1920</NativeSelectOption>
                      <NativeSelectOption value="720x1280">720x1280</NativeSelectOption>
                      <NativeSelectOption value="1920x1080">1920x1080</NativeSelectOption>
                    </NativeSelect>
                  </FieldControl>
                  <FieldControl label="来源平台" help="默认自动识别，失败时才需手动指定。">
                    <NativeSelect name="sourcePlatform" defaultValue="auto">
                      <NativeSelectOption value="auto">自动</NativeSelectOption>
                      <NativeSelectOption value="youtube">YouTube</NativeSelectOption>
                      <NativeSelectOption value="tiktok">TikTok</NativeSelectOption>
                      <NativeSelectOption value="bilibili">Bilibili</NativeSelectOption>
                      <NativeSelectOption value="douyin">Douyin</NativeSelectOption>
                    </NativeSelect>
                  </FieldControl>
                </div>
              </SettingsAccordionItem>

              <SettingsAccordionItem value="language" title="语言与提示词" description="目标语言、双语字幕和额外提示词。" icon={Globe} compact>
                <div className="grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <FieldControl label="目标语言">
                      <NativeSelect name="targetLanguage" defaultValue={getNested(settings, "task.translation.targetLanguage", "zh-CN")}>
                        {languages.map((code) => <NativeSelectOption key={code} value={code}>{t(`languages.${code}`)}</NativeSelectOption>)}
                      </NativeSelect>
                    </FieldControl>
                    <SwitchRow label="双语字幕" name="bilingualSubtitles" defaultChecked={getNested(settings, "task.translation.bilingualSubtitles", false)} />
                  </div>
                  <div className="rounded-lg border bg-muted/20 px-3">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between py-3 font-medium text-sm"
                      onClick={() => setPromptPanelOpen((open) => !open)}
                    >
                      <span>高级提示词</span>
                      <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", promptPanelOpen && "rotate-180")} />
                    </button>
                    {promptPanelOpen && (
                      <div className="grid gap-3 pb-3 sm:grid-cols-2">
                        <PromptField name="promptSubtitle" label="字幕翻译额外提示词" defaultValue={getNested(settings, "task.translation.prompts.subtitle", "")} />
                        <PromptField name="promptComment" label="评论翻译额外提示词" defaultValue={getNested(settings, "task.translation.prompts.comment", "")} />
                        <PromptField name="promptTitle" label="标题生成额外提示词" defaultValue={getNested(settings, "task.translation.prompts.title", "")} />
                        <PromptField name="promptDescription" label="描述生成额外提示词" defaultValue={getNested(settings, "task.translation.prompts.description", "")} />
                        <PromptField name="promptTags" label="标签/话题生成额外提示词" defaultValue={getNested(settings, "task.translation.prompts.tags", "")} />
                      </div>
                    )}
                  </div>
                </div>
              </SettingsAccordionItem>

              <SettingsAccordionItem value="cover" title="封面与文案" description="封面模式、模板和固定文案。" icon={Layers} compact>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldControl label="封面模式" help="固定文案模式不会让 AI 写封面字。">
                    <NativeSelect name="coverMode" defaultValue={getNested(settings, "task.coverAndCopy.coverMode", "template-ai-copy")}>
                      <NativeSelectOption value="none">不生成封面</NativeSelectOption>
                      <NativeSelectOption value="ai-frame-ai-copy">AI 选画面 + AI 文案</NativeSelectOption>
                      <NativeSelectOption value="template-fixed-copy">固定模板 + 固定文案</NativeSelectOption>
                      <NativeSelectOption value="template-ai-copy">固定模板 + AI 文案</NativeSelectOption>
                    </NativeSelect>
                  </FieldControl>
                  <FieldControl label="封面模板">
                    <NativeSelect name="coverTemplate" defaultValue={getNested(settings, "task.coverAndCopy.template", "汽车测评")}>
                      {coverTemplates.map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}
                    </NativeSelect>
                  </FieldControl>
                  <div className="sm:col-span-2">
                    <FieldControl label="固定封面文案" help="不想让 AI 写封面字时使用这里的固定文案。">
                      <Input name="fixedCoverCopy" defaultValue={getNested(settings, "task.coverAndCopy.fixedCoverCopy", "")} />
                    </FieldControl>
                  </div>
                </div>
              </SettingsAccordionItem>
            </Accordion>
          </div>

          <DialogFooter className="!mx-0 !mb-0 !rounded-none !bg-background/95 !px-5 !py-3.5 shrink-0 border-t">
            <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>取消</Button>
            <Button disabled={busy === "create"} type="submit">
              {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />}
              创建并运行
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
      <Tabs defaultValue="task" className="grid gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <TabsList className="w-fit">
            <TabsTrigger value="task">任务设置</TabsTrigger>
            <TabsTrigger value="llm">LLM 设置</TabsTrigger>
            <TabsTrigger value="agent">Agent 设置</TabsTrigger>
          </TabsList>
          <Button className="w-fit" type="submit" disabled={busy === "settings"}><Settings /> 保存设置</Button>
        </div>

        <TabsContent value="task" className="grid gap-4">
          <Accordion type="multiple" defaultValue={["download", "render", "publish"]} className="grid gap-3">
            <SettingsAccordionItem value="source" title="来源识别" description="识别链接、判断平台、读取视频基本信息。">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SelectField name="task.source.defaultPlatform" label="默认来源平台" help="默认使用自动，系统会根据链接匹配平台。" defaultValue={getNested(settings, "task.source.defaultPlatform", "auto")} options={[["auto", "自动"], ["youtube", "YouTube"], ["tiktok", "TikTok"], ["bilibili", "Bilibili"], ["douyin", "Douyin"], ["xiaohongshu", "小红书"]]} />
                <SelectField name="task.source.duplicateStrategy" label="重复任务处理" help="同一个视频链接重复创建时怎么处理。" defaultValue={getNested(settings, "task.source.duplicateStrategy", "block")} options={[["block", "阻止创建"], ["overwrite", "覆盖旧任务"], ["reuse-assets", "复用素材重新生成"]]} />
                <SelectField name="task.source.loginMode" label="默认登录态" help="有些平台需要登录才能看到评论、字幕或高清视频。" defaultValue={getNested(settings, "task.source.loginMode", "platform-session")} options={[["platform-session", "使用平台登录态"], ["no-login", "不使用登录态"]]} />
                <SelectField name="task.source.sourceLanguage" label="来源语言" help="用于决定是否需要翻译字幕和评论。" defaultValue={getNested(settings, "task.source.sourceLanguage", "auto")} options={[["auto", "自动检测"], ["zh-CN", "中文"], ["en", "英语"], ["ja", "日语"], ["ko", "韩语"]]} />
              </div>
            </SettingsAccordionItem>

            <SettingsAccordionItem value="download" title="下载与素材缓存" description="下载视频、字幕、评论、平台元数据，并保存到本地缓存目录。">
              <div className="grid gap-3">
                <FieldControl label="下载缓存位置" help="视频、字幕、评论 JSON、评论头像都会先缓存到这里，方便失败后重试。">
                  <Input name="task.download.cacheDir" defaultValue={getNested(settings, "task.download.cacheDir", "")} />
                </FieldControl>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <SelectField name="task.download.videoQuality" label="默认视频下载分辨率" help="这是默认值；平台不提供时会按 fallback 策略选择最接近版本。" defaultValue={getNested(settings, "task.download.videoQuality", "auto")} options={[["auto", "自动"], ["best", "最高清"], ["1080p", "1080p"], ["720p", "720p"], ["480p", "480p"]]} />
                  <SelectField name="task.download.qualityFallback" label="视频分辨率 fallback" help="例如默认 1080p，如果没有 1080p，向下兼容会尝试 720p。" defaultValue={getNested(settings, "task.download.qualityFallback", "down")} options={[["down", "向下兼容"], ["up", "向上兼容"], ["exact", "只接受指定分辨率"]]} />
                  <SelectField name="task.download.audioMode" label="默认音频下载" help="一般保持跟随视频；只有源视频音轨异常时才需要单独策略。" defaultValue={getNested(settings, "task.download.audioMode", "follow-video")} options={[["follow-video", "跟随视频"], ["best-audio", "单独下载最佳音频"], ["none", "不单独处理音频"]]} />
                  <SelectField name="task.download.subtitleMode" label="默认字幕下载" help="如果平台没有字幕，任务不会失败，会继续进入后续流程。" defaultValue={getNested(settings, "task.download.subtitleMode", "platform-preferred")} options={[["platform-preferred", "优先平台字幕"], ["all", "下载全部字幕"], ["none", "不下载字幕"]]} />
                  <SelectField name="task.download.subtitleFallback" label="字幕 fallback" help="语音识别未来接入；当前可先保留跳过。" defaultValue={getNested(settings, "task.download.subtitleFallback", "skip")} options={[["skip", "没有字幕就跳过"], ["speech-to-text", "尝试语音识别"]]} />
                  <SelectField name="task.download.commentSampling" label="评论采样方式" help="按视频时长自动会根据每条评论秒数和视频时长计算目标评论数。" defaultValue={getNested(settings, "task.download.commentSampling", "duration")} options={[["duration", "按视频时长自动"], ["fixed", "固定数量"], ["hot", "热门优先"], ["latest", "最新优先"]]} />
                  <LabelInput label="每条评论秒数" help="例如视频 60 秒、每条评论 2 秒、重复 1 次，则目标约 30 条。" name="task.download.commentSeconds" type="number" min={0.5} step={0.5} defaultValue={getNested(settings, "task.download.commentSeconds", 2)} />
                  <LabelInput label="最大评论数" help="防止超长视频下载过多评论。" name="task.download.maxComments" type="number" min={1} max={5000} defaultValue={getNested(settings, "task.download.maxComments", 800)} />
                  <LabelInput label="下载重试次数" name="task.download.retryCount" type="number" min={0} max={10} defaultValue={getNested(settings, "task.download.retryCount", 2)} />
                  <LabelInput label="下载超时秒数" name="task.download.timeoutSec" type="number" min={30} defaultValue={getNested(settings, "task.download.timeoutSec", 600)} />
                </div>
                <p className="rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground text-xs">评论头像下载不做开关：只要开启评论渲染，就会自动下载评论头像；失败时使用首字母或平台默认头像，不中断任务。</p>
              </div>
            </SettingsAccordionItem>

            <SettingsAccordionItem value="prepare" title="素材整理与适配" description="把原始视频、音频、字幕、评论整理成渲染器能稳定使用的格式。">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <SelectField name="task.prepare.outputAspect" label="默认输出画幅" help="短视频默认建议竖屏；横屏源视频会按适配方式处理。" defaultValue={getNested(settings, "task.prepare.outputAspect", "portrait")} options={[["auto", "自动"], ["portrait", "竖屏 9:16"], ["landscape", "横屏 16:9"], ["source", "保持原视频"]]} />
                <SelectField name="task.prepare.outputResolution" label="默认输出分辨率" help="最终渲染目标，不等同于下载分辨率。" defaultValue={getNested(settings, "task.prepare.outputResolution", "1080x1920")} options={[["auto", "自动"], ["1080x1920", "1080x1920"], ["720x1280", "720x1280"], ["1920x1080", "1920x1080"]]} />
                <SelectField name="task.prepare.fitMode" label="画面适配方式" help="用于处理源视频比例和输出比例不一致的情况。" defaultValue={getNested(settings, "task.prepare.fitMode", "smart-crop")} options={[["smart-crop", "智能裁剪"], ["blur-background", "模糊背景补边"], ["keep-bars", "黑边保留"], ["center-crop", "居中裁剪"]]} />
                <SelectField name="task.prepare.audioNormalize" label="音量适配" help="自动会尽量把音量调整到适合短视频播放的范围。" defaultValue={getNested(settings, "task.prepare.audioNormalize", "auto")} options={[["auto", "自动"], ["off", "不处理"]]} />
                <SelectField name="task.prepare.subtitleCleanup" label="字幕整理" help="自动合并可以减少字幕过碎导致的闪烁。" defaultValue={getNested(settings, "task.prepare.subtitleCleanup", "merge-short")} options={[["merge-short", "自动合并短句"], ["keep", "保持原样"]]} />
              </div>
            </SettingsAccordionItem>

            <SettingsAccordionItem value="translation" title="翻译与文本处理" description="翻译字幕、翻译评论、处理标题描述文案。">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SelectField name="task.translation.targetLanguage" label="目标语言" defaultValue={getNested(settings, "task.translation.targetLanguage", "zh-CN")} options={languages.map((code) => [code, t(`languages.${code}`)])} />
                <SelectField name="task.translation.subtitleMode" label="字幕翻译" help="自动会根据来源语言和目标语言判断是否翻译。" defaultValue={getNested(settings, "task.translation.subtitleMode", "auto")} options={[["auto", "自动"], ["always", "总是翻译"], ["off", "不翻译"]]} />
                <SelectField name="task.translation.commentMode" label="评论翻译" defaultValue={getNested(settings, "task.translation.commentMode", "auto")} options={[["auto", "自动"], ["always", "总是翻译"], ["off", "不翻译"]]} />
                <SwitchRow label="双语字幕" name="task.translation.bilingualSubtitles" defaultChecked={getNested(settings, "task.translation.bilingualSubtitles", false)} />
                <SelectField name="task.translation.sensitiveContent" label="敏感内容处理" help="不单独设置审核提示词，统一由这里和通用提示词控制。" defaultValue={getNested(settings, "task.translation.sensitiveContent", "preserve")} options={[["preserve", "保留原意"], ["soften", "温和改写"], ["mark", "标记但保留"], ["delete", "删除"]]} />
              </div>
              <FieldControl label="风格约束" help="可多选。保存时用逗号分隔，后端会按文本处理。">
                <Input name="task.translation.styleConstraints" defaultValue={listValue(getNested<JsonValue | undefined>(settings, "task.translation.styleConstraints", undefined), ["自然口语", "本土化表达"])} placeholder={styleConstraintOptions.join("，")} />
              </FieldControl>
              <div className="grid gap-3 md:grid-cols-2">
                <PromptField name="task.translation.prompts.subtitle" label="字幕翻译额外提示词" defaultValue={getNested(settings, "task.translation.prompts.subtitle", "")} />
                <PromptField name="task.translation.prompts.comment" label="评论翻译额外提示词" defaultValue={getNested(settings, "task.translation.prompts.comment", "")} />
                <PromptField name="task.translation.prompts.title" label="标题生成额外提示词" defaultValue={getNested(settings, "task.translation.prompts.title", "")} />
                <PromptField name="task.translation.prompts.description" label="描述生成额外提示词" defaultValue={getNested(settings, "task.translation.prompts.description", "")} />
                <PromptField name="task.translation.prompts.tags" label="标签/话题生成额外提示词" defaultValue={getNested(settings, "task.translation.prompts.tags", "")} />
              </div>
            </SettingsAccordionItem>

            <SettingsAccordionItem value="cover" title="封面与平台文案" description="生成封面、标题、描述、标签、话题，并填入各平台草稿。">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SelectField name="task.coverAndCopy.coverMode" label="封面模式" help="固定文案模式不会让 AI 写封面字。" defaultValue={getNested(settings, "task.coverAndCopy.coverMode", "template-ai-copy")} options={[["none", "不生成封面"], ["ai-frame-ai-copy", "AI 选画面 + AI 文案"], ["template-fixed-copy", "固定模板 + 固定文案"], ["template-ai-copy", "固定模板 + AI 文案"]]} />
                <SelectField name="task.coverAndCopy.template" label="默认封面模板" help="不同板块使用不同视觉风格。" defaultValue={getNested(settings, "task.coverAndCopy.template", "汽车测评")} options={coverTemplates.map((item) => [item, item])} />
                <SelectField name="task.coverAndCopy.framePreference" label="AI 选帧偏好" help="原来的封面选择提示词改成更可理解的选帧偏好。" defaultValue={getNested(settings, "task.coverAndCopy.framePreference", "auto")} options={[["auto", "自动"], ["people", "人物优先"], ["product", "产品优先"], ["action", "动作画面优先"], ["information", "信息画面优先"]]} />
                <LabelInput label="抽帧数量" help="系统会从视频中抽取多张截图，再选择一张做封面。" name="task.coverAndCopy.frameSampleCount" type="number" min={1} max={10} defaultValue={getNested(settings, "task.coverAndCopy.frameSampleCount", 5)} />
                <LabelInput label="固定封面文案" name="task.coverAndCopy.fixedCoverCopy" defaultValue={getNested(settings, "task.coverAndCopy.fixedCoverCopy", "")} />
                <SelectField name="task.coverAndCopy.titleMode" label="标题生成" defaultValue={getNested(settings, "task.coverAndCopy.titleMode", "ai")} options={[["template", "固定模板"], ["ai", "AI 生成"], ["source", "使用来源标题"]]} />
                <SelectField name="task.coverAndCopy.descriptionMode" label="描述生成" defaultValue={getNested(settings, "task.coverAndCopy.descriptionMode", "ai")} options={[["template", "固定模板"], ["ai", "AI 生成"], ["source", "使用来源描述"]]} />
                <SelectField name="task.coverAndCopy.tagsMode" label="标签/话题生成" defaultValue={getNested(settings, "task.coverAndCopy.tagsMode", "ai")} options={[["template", "固定模板"], ["ai", "AI 生成"], ["manual", "手动"]]} />
              </div>
              <PromptField name="task.coverAndCopy.aiCoverPrompt" label="AI 封面文案额外提示词" defaultValue={getNested(settings, "task.coverAndCopy.aiCoverPrompt", "")} />
              <div className="grid gap-3 md:grid-cols-3">
                <LabelInput label="标题最大长度" name="task.coverAndCopy.titleMaxLength" type="number" defaultValue={getNested(settings, "task.coverAndCopy.titleMaxLength", 80)} />
                <LabelInput label="标签/话题模板" name="task.coverAndCopy.tagsTemplate" defaultValue={getNested(settings, "task.coverAndCopy.tagsTemplate", "")} />
                <LabelInput label="禁词和替换词" name="task.coverAndCopy.blockedWords" defaultValue={getNested(settings, "task.coverAndCopy.blockedWords", "")} />
              </div>
              <PromptField name="task.coverAndCopy.descriptionTemplate" label="描述模板" defaultValue={getNested(settings, "task.coverAndCopy.descriptionTemplate", "")} />
            </SettingsAccordionItem>

            <SettingsAccordionItem value="render" title="渲染" description="生成最终视频文件。字号和行距是比例系数，不是固定像素。">
              <FieldControl label="渲染输出位置" help="最终 mp4、封面图、渲染日志会输出到这里。">
                <Input name="task.render.outputDir" defaultValue={getNested(settings, "task.render.outputDir", "")} />
              </FieldControl>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SwitchRow label="渲染评论" name="task.render.renderComments" defaultChecked={getNested(settings, "task.render.renderComments", true)} />
                <SelectField name="task.render.commentStyle" label="评论样式模板" defaultValue={getNested(settings, "task.render.commentStyle", "classic-dark")} options={[["classic-dark", "经典深色"], ["light", "轻量白色"], ["bilibili", "B 站风"], ["douyin", "抖音风"], ["xiaohongshu", "小红书风"]]} />
                <SelectField name="task.render.commentFontSize" label="评论字号" help="基于输出分辨率的比例系数。" defaultValue={getNested(settings, "task.render.commentFontSize", "medium")} options={[["small", "小"], ["medium", "中"], ["large", "大"]]} />
                <SelectField name="task.render.commentLineHeight" label="评论行距" defaultValue={getNested(settings, "task.render.commentLineHeight", "standard")} options={[["compact", "紧凑"], ["standard", "标准"], ["loose", "宽松"]]} />
                <SelectField name="task.render.subtitleFontSize" label="字幕字号" defaultValue={getNested(settings, "task.render.subtitleFontSize", "medium")} options={[["small", "小"], ["medium", "中"], ["large", "大"]]} />
                <SelectField name="task.render.subtitleLineHeight" label="字幕行距" defaultValue={getNested(settings, "task.render.subtitleLineHeight", "standard")} options={[["compact", "紧凑"], ["standard", "标准"], ["loose", "宽松"]]} />
                <SelectField name="task.render.commentContent" label="评论显示内容" defaultValue={getNested(settings, "task.render.commentContent", "original-translated")} options={[["original-translated", "原文 + 译文"], ["translated-only", "仅译文"], ["auto", "自动"]]} />
                <SelectField name="task.render.longCommentBehavior" label="长评论换行" defaultValue={getNested(settings, "task.render.longCommentBehavior", "wrap")} options={[["wrap", "自动换行"], ["truncate", "截断"], ["shrink", "缩小字号"]]} />
                <SelectField name="task.render.commentSpeed" label="评论滚动速度" defaultValue={getNested(settings, "task.render.commentSpeed", "standard")} options={[["slow", "慢"], ["standard", "标准"], ["fast", "快"]]} />
                <LabelInput label="重复次数" name="task.render.repeatTimes" type="number" min={1} max={10} defaultValue={getNested(settings, "task.render.repeatTimes", 1)} />
                <SelectField name="task.render.outputFormat" label="输出格式" defaultValue={getNested(settings, "task.render.outputFormat", "mp4")} options={[["mp4", "mp4"], ["mov", "mov"]]} />
              </div>
            </SettingsAccordionItem>

            <SettingsAccordionItem value="publish" title="保存草稿与发布" description="保存平台草稿和立即发布都会走平台流程，区别是是否点击最终发布按钮。">
              <FieldControl label="默认平台" help="新任务默认使用的平台。">
                {platformChooser(settingsTargets, setSettingsTargets)}
              </FieldControl>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SelectField name="task.publish.defaultAction" label="默认动作" help="保存平台草稿只保存到平台后台，不点击最终发布。" defaultValue={getNested(settings, "task.publish.defaultAction", "publish")} options={[["draft", "保存平台草稿"], ["publish", "立即发布"]]} />
                <LabelInput label="发布失败重试次数" name="task.publish.retryCount" type="number" min={0} max={10} defaultValue={getNested(settings, "task.publish.retryCount", 1)} />
                <SwitchRow label="检查登录态" name="task.publish.preflightChecks.login" defaultChecked={getNested(settings, "task.publish.preflightChecks.login", true)} />
                <SwitchRow label="检查文件" name="task.publish.preflightChecks.files" defaultChecked={getNested(settings, "task.publish.preflightChecks.files", true)} />
                <SwitchRow label="检查文案" name="task.publish.preflightChecks.copy" defaultChecked={getNested(settings, "task.publish.preflightChecks.copy", true)} />
                <SwitchRow label="检查平台支持" name="task.publish.preflightChecks.adapter" defaultChecked={getNested(settings, "task.publish.preflightChecks.adapter", true)} />
              </div>
              <Separator />
              <div className="grid gap-3 md:grid-cols-2">
                <LabelInput label="B 站分区" name="task.publish.platformConfigs.bilibili.category" defaultValue={getNested(settings, "task.publish.platformConfigs.bilibili.category", "汽车")} />
                <LabelInput label="B 站标签" name="task.publish.platformConfigs.bilibili.tags" defaultValue={getNested(settings, "task.publish.platformConfigs.bilibili.tags", "")} />
                <LabelInput label="抖音话题" name="task.publish.platformConfigs.douyin.topics" defaultValue={getNested(settings, "task.publish.platformConfigs.douyin.topics", "")} />
                <LabelInput label="小红书话题" name="task.publish.platformConfigs.xiaohongshu.topics" defaultValue={getNested(settings, "task.publish.platformConfigs.xiaohongshu.topics", "")} />
                <LabelInput label="YouTube 标签" name="task.publish.platformConfigs.youtube.tags" defaultValue={getNested(settings, "task.publish.platformConfigs.youtube.tags", "")} />
              </div>
            </SettingsAccordionItem>
          </Accordion>
        </TabsContent>

        <TabsContent value="llm" className="grid gap-4">
          <SettingsSection title="服务模式" description="可以使用内置服务，也可以自己配置模型。">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SelectField name="llm.serviceMode" label="服务模式" help="内置服务未来用于售卖；用户不需要填 API Key。" defaultValue={getNested(settings, "llm.serviceMode", "managed")} options={[["managed", "使用内置服务"], ["custom", "自己配置模型"]]} />
              <SelectField name="llm.provider" label="模型厂商" defaultValue={getNested(settings, "llm.provider", "managed")} options={[["managed", "内置服务"], ["openai", "OpenAI"], ["anthropic", "Anthropic Claude"], ["gemini", "Google Gemini"], ["deepseek", "DeepSeek"], ["qwen", "Qwen / 百炼"], ["doubao", "Doubao / 火山方舟"], ["kimi", "Moonshot / Kimi"], ["glm", "Zhipu GLM"], ["openrouter", "OpenRouter"], ["ollama", "Ollama"], ["custom", "自定义 OpenAI-compatible"]]} />
              <LabelInput label="Base URL" name="llm.baseUrl" defaultValue={getNested(settings, "llm.baseUrl", "")} />
              <LabelInput label="API Key 环境变量" name="llm.apiKeyEnv" defaultValue={getNested(settings, "llm.apiKeyEnv", "OPENAI_API_KEY")} />
              <LabelInput label="默认文本模型" help="用于翻译、标题、描述、标签、评论文案等文字生成任务。" name="llm.textModel" defaultValue={getNested(settings, "llm.textModel", "gpt-4.1-mini")} />
              <LabelInput label="默认视觉模型" help="用于看视频截图、选择封面画面、理解图片内容；不需要时可以留空。" name="llm.visionModel" defaultValue={getNested(settings, "llm.visionModel", "gpt-4.1-mini")} />
              <SelectField name="llm.thinking" label="Thinking / Reasoning" help="开启后模型会花更多时间推理；翻译通常不需要高等级。" defaultValue={getNested(settings, "llm.thinking", "auto")} options={[["off", "关闭"], ["auto", "自动"], ["low", "低"], ["medium", "中"], ["high", "高"]]} />
              <SelectField name="llm.temperatureMode" label="温度" help="稳定更像翻译工具；创意更适合标题和营销文案。" defaultValue={getNested(settings, "llm.temperatureMode", "balanced")} options={[["stable", "稳定"], ["balanced", "平衡"], ["creative", "创意"]]} />
              <SelectField name="llm.maxOutputMode" label="最大输出长度" defaultValue={getNested(settings, "llm.maxOutputMode", "standard")} options={[["short", "短"], ["standard", "标准"], ["long", "长"]]} />
              <LabelInput label="超时秒数" name="llm.timeoutSec" type="number" defaultValue={getNested(settings, "llm.timeoutSec", 120)} />
              <LabelInput label="重试次数" name="llm.retryCount" type="number" defaultValue={getNested(settings, "llm.retryCount", 2)} />
            </div>
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground text-xs">默认文本模型会用于字幕翻译、评论翻译、标题、描述、标签/话题和封面文案生成。默认视觉模型只用于封面画面选择。</p>
          </SettingsSection>
        </TabsContent>

        <TabsContent value="agent" className="grid gap-4">
          <SettingsSection title="个人 Agent 连接" description="这里先做 UI 配置，用于未来一键连接 OpenClaw、Hermes、WorkBuddy 等个人 Agent。">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SwitchRow label="启用 Agent" name="agent.enabled" defaultChecked={getNested(settings, "agent.enabled", false)} />
              <SelectField name="agent.type" label="Agent 类型" defaultValue={getNested(settings, "agent.type", "openclaw")} options={[["openclaw", "OpenClaw"], ["hermes", "Hermes"], ["workbuddy", "WorkBuddy"], ["custom", "自定义"]]} />
              <SelectField name="agent.connectionMode" label="连接方式" defaultValue={getNested(settings, "agent.connectionMode", "local-app")} options={[["local-app", "本机应用"], ["browser-extension", "浏览器扩展"], ["cloud", "云服务"], ["webhook", "自定义 Webhook"]]} />
              <SelectField name="agent.handoffMode" label="接管范围" help="只通知最安全；自动处理适合完全信任的个人 Agent。" defaultValue={getNested(settings, "agent.handoffMode", "notify-only")} options={[["notify-only", "只通知"], ["ask-before-action", "询问后处理"], ["auto", "自动处理"]]} />
              <LabelInput label="Agent Token / 连接密钥" name="agent.token" defaultValue={getNested(settings, "agent.token", "")} />
            </div>
          </SettingsSection>
          <SettingsSection title="IM Channel" description="用户通过哪个 IM 接收通知和发指令。">
            <div className="grid gap-3 md:grid-cols-2">
              {agentChannels.map(([type, label]) => (
                <div key={type} className="grid gap-3 rounded-lg border p-3">
                  <SwitchRow label={label} name={`agent.channels.${type}.enabled`} defaultChecked={Boolean(getNested(agentChannel(settings, type), "enabled", false))} />
                  <LabelInput label="接收人或群" name={`agent.channels.${type}.binding`} defaultValue={getNested(agentChannel(settings, type), "binding", "")} />
                  <SelectField name={`agent.channels.${type}.notificationLevel`} label="通知级别" defaultValue={getNested(agentChannel(settings, type), "notificationLevel", "failures")} options={[["all", "全部"], ["failures", "只失败"], ["needs-action", "只需要人工处理"]]} />
                  <SwitchRow label="允许远程操作" name={`agent.channels.${type}.allowRemoteActions`} defaultChecked={Boolean(getNested(agentChannel(settings, type), "allowRemoteActions", false))} />
                </div>
              ))}
            </div>
          </SettingsSection>
        </TabsContent>
      </Tabs>
    </form>
  );

  if (view === "jobs") {
    return (
      <div className="grid gap-4">
        <PageHeader
          icon={ClipboardList}
          title={t("page.jobsTitle")}
          description={t("page.jobsDescription")}
          action={<div className="flex gap-2">{createTaskDialog}<Button onClick={() => refresh(true)} variant="outline"><RefreshCcw /> {t("actions.refresh")}</Button></div>}
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">{jobsTable}{jobDetail}</div>
      </div>
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
    return <div className="grid gap-4"><PageHeader icon={Settings} title={t("page.settingsTitle")} description={t("page.settingsDescription")} />{settingsPanel}</div>;
  }

  return <div className="grid gap-4"><PageHeader icon={ClipboardList} title={t("page.jobsTitle")} description={t("page.jobsDescription")} />{jobsTable}</div>;
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

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4">
      <div>
        <h3 className="font-medium text-sm">{title}</h3>
        <p className="mt-1 text-muted-foreground text-xs">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SettingsAccordionItem({ value, title, description, icon: Icon, compact = false, children }: {
  value: string;
  title: string;
  description: string;
  icon?: React.ElementType;
  compact?: boolean;
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
      <AccordionContent className={cn("grid gap-4", compact ? "pb-3" : "pb-4")}>
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function LabelInput({ label, help, ...props }: React.ComponentProps<typeof Input> & { label: string; help?: React.ReactNode }) {
  const controlId = props.id || cleanId(String(props.name || label));

  return (
    <div className="grid gap-2">
      <FieldLabel id={controlId} label={label} help={help} />
      <Input {...props} id={controlId} />
    </div>
  );
}

function SelectField({ name, label, help, defaultValue, options }: {
  name: string;
  label: string;
  help?: React.ReactNode;
  defaultValue?: string;
  options: Array<[string, string]>;
}) {
  const controlId = cleanId(name);
  return (
    <div className="grid gap-2">
      <FieldLabel id={controlId} label={label} help={help} />
      <NativeSelect id={controlId} name={name} defaultValue={defaultValue}>
        {options.map(([value, optionLabel]) => (
          <NativeSelectOption key={value} value={value}>{optionLabel}</NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

function PromptField({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <FieldControl label={label} help="只追加本项对应任务的额外约束；不会替代系统内置提示词。">
      <Textarea name={name} defaultValue={defaultValue} className="min-h-24 resize-y" />
    </FieldControl>
  );
}

function DialogRow({ icon: Icon, label, children }: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="flex w-28 shrink-0 items-center gap-2 text-muted-foreground text-sm">
        <Icon className="size-4" />
        <span>{label}</span>
      </div>
      <span className="shrink-0 select-none text-muted-foreground/40 text-sm">:</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {children}
      </div>
    </div>
  );
}

function SwitchRow({ label, name, defaultChecked, help }: { label: string; name: string; defaultChecked?: boolean; help?: React.ReactNode }) {
  const controlId = cleanId(name);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <FieldLabel id={controlId} label={label} help={help} />
      <Switch id={controlId} name={name} defaultChecked={defaultChecked} />
    </div>
  );
}

function HeartIcon(props: React.ComponentProps<typeof Activity>) {
  return <Activity {...props} />;
}
