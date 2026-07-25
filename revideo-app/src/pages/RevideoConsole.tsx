// RevideoConsole — Tauri desktop app console
// Full-featured: Jobs / Publishing / Health / Settings
import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2, Compass, Copy, Cpu, Download, ExternalLink, Globe,
  Layers, Link2, Loader2, MoreHorizontal, Pause, Play, Plus,
  RefreshCcw, Rocket, RotateCcw, Search, Send, SlidersHorizontal,
  Trash2, XCircle, AlertTriangle, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/i18n-provider";
import { PageHeader } from "@/components/page-header";
import {
  SelectField,
  LabelInput,
  WideLabelInput,
  SwitchRow,
  PromptField,
  SettingsSection,
  CoverCopyPane,
} from "@/components/settings";
import type { RevideoSettings } from "@/lib/types";

// ── Constants ────────────────────────────────────────────────────────────

type DashboardView = "jobs" | "publishing" | "health" | "settings";

const languages = [
  "zh-CN", "en", "ja", "ko", "es", "fr", "de", "ru",
];

const styleConstraintOptions = [
  "自然口语", "保守直译", "短视频口吻", "新闻解说", "专业测评",
  "夸张吸睛", "幽默吐槽", "克制高级", "本土化表达", "保留原文语气",
  "适合 B 站", "适合抖音", "适合小红书", "适合 YouTube",
];

const RES_OPTS: Array<[string, string]> = [
  ["auto", "自动"], ["best", "最高清"], ["1080p", "1080p"],
  ["720p", "720p"], ["480p", "480p"],
];

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

const workflowOrder = [
  "probing-source", "downloading-source", "normalizing-assets",
  "translating-assets", "moderating-assets",
  "generating-cover-image", "rendering-video",
  "generating-platform-drafts", "preflighting-targets", "publishing-targets",
];

const publishPlatforms = ["bilibili", "douyin", "xiaohongshu", "youtube", "tiktok"];
const targetPlatforms = [
  "bilibili", "douyin", "xiaohongshu", "youtube", "tiktok", "instagram", "x",
];

const platformNames: Record<string, string> = {
  youtube: "YouTube", bilibili: "Bilibili", douyin: "Douyin",
  tiktok: "TikTok", xiaohongshu: "Xiaohongshu", instagram: "Instagram", x: "X",
};

// ── Types ────────────────────────────────────────────────────────────────

interface JobData {
  id: string;
  source: {
    platform?: string;
    url?: string;
    metadata?: {
      title?: string;
      author?: string;
      duration_seconds?: number;
      formats?: Array<{
        format_id: string;
        resolution?: string;
        fps?: number;
        codec?: string;
      }>;
      language?: string;
    } | null;
  };
  targets: Array<{ platform: string; status: string; error?: string }>;
  options: {
    repeat_times?: number;
    download_quality?: string;
    target_language?: string;
    output_aspect?: string;
    output_resolution?: string;
    render_comments?: boolean;
    target_comment_count?: number;
    bilingual_subtitles?: boolean;
    subtitle_mode?: string;
    comment_mode?: string;
    sensitive_content?: string;
    style_constraints?: string;
  };
  workflow: {
    current_step: string;
    steps: Record<string, {
      status?: string;
      percent?: number;
      attempts?: number;
      started_at?: string | null;
      finished_at?: string | null;
      error?: string | null;
    }>;
  };
  artifacts: {
    source?: { media_path?: string };
    derived?: {
      render_path?: string;
      cover_path?: string | null;
      copy_path?: string;
      translated_comments_path?: string | null;
      translated_subtitles_path?: string | null;
    } | null;
    publish?: Record<string, {
      status: string;
      url: string | null;
      error: string | null;
      finished_at: string;
    }>;
  } | null;
  created_at?: string;
  updated_at?: string;
}

interface QueuedRun {
  id: string;
  job_id: string;
  steps: string[];
  status: string;
  created_at: string;
  error?: string | null;
}

interface QueueSnapshot {
  active: QueuedRun | null;
  queued: QueuedRun[];
  history: QueuedRun[];
}

interface BrowserStatus {
  running: boolean;
  cdp_port: number;
  profile_dir: string;
}

interface HealthStatus {
  healthy: boolean;
  ffmpeg_available: boolean;
  ytdlp_available: boolean;
  sidecar_running: boolean;
  llm_configured: boolean;
}

interface DiscoveryStatusData {
  last_run_at: string | null;
  last_status: string;
  stats: Record<string, number>;
  errors: string[];
}

interface ProgressEvent {
  jobId: string;
  step: string;
  percent: number;
  message: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getNested(obj: unknown, path: string, fallback = ""): string {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return fallback;
    }
  }
  return String(cur ?? fallback);
}

function jobTitle(j: JobData): string {
  return j.source?.metadata?.title || j.id;
}

function currentStep(j: JobData): string {
  return j.workflow?.current_step || "created";
}

function stepLabel(s: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  const dict: Record<string, string> = {
    "probing-source": "probing-source",
    "downloading-source": "downloading-source",
    "normalizing-assets": "normalizing-assets",
    "translating-assets": "translating-assets",
    "moderating-assets": "moderating-assets",
    "generating-cover-image": "generating-cover-image",
    "rendering-video": "rendering-video",
    "generating-platform-drafts": "generating-platform-drafts",
    "preflighting-targets": "preflighting-targets",
    "publishing-targets": "publishing-targets",
    completed: "completed",
  };
  const key = dict[s] || s;
  return t(`steps.${key}`);
}

function derivedStatus(j: JobData, queue: QueueSnapshot): string {
  if (queue.active?.job_id === j.id) return "running";
  if (queue.queued.some((r) => r.job_id === j.id)) return "queued";
  if (currentStep(j) === "completed") return "completed";
  const step = currentStep(j);
  const st = j.workflow.steps[step]?.status;
  if (st === "failed") return "failed";
  if (st === "running") {
    if (step === "publishing-targets" || step === "preflighting-targets" || step === "generating-platform-drafts") {
      return "publishing";
    }
    return "running";
  }
  if (st === "paused") return "paused";
  return "pending";
}

function stepProgress(j: JobData): number {
  if (currentStep(j) === "completed") return 100;
  const idx = workflowOrder.indexOf(currentStep(j));
  if (idx < 0) return 0;
  const base = (idx / workflowOrder.length) * 100;
  const sp =
    ((j.workflow.steps[currentStep(j)]?.percent || 0) / workflowOrder.length);
  return Math.min(99, Math.round(base + sp));
}

function stepCounter(j: JobData): {
  current: number;
  total: number;
  step: string;
} {
  const idx = workflowOrder.indexOf(currentStep(j));
  return {
    current: currentStep(j) === "completed" ? workflowOrder.length : idx + 1,
    total: workflowOrder.length,
    step: currentStep(j),
  };
}

// ── Main component ────────────────────────────────────────────────────────

export default function RevideoConsole({
  view,
}: {
  view: DashboardView;
}) {
  const { t } = useI18n();

  // ── State ────────────────────────────────────────────────────────────
  const [jobs, setJobs] = React.useState<JobData[]>([]);
  const [queue, setQueue] = React.useState<QueueSnapshot>({
    active: null,
    queued: [],
    history: [],
  });
  const [settings, setSettings] = React.useState<RevideoSettings | null>(null);
  const [browser, setBrowser] = React.useState<BrowserStatus | null>(null);
  const [health, setHealth] = React.useState<HealthStatus | null>(null);
  const [settingsFormKey, setSettingsFormKey] = React.useState(0);
  const [selectedJobId, setSelectedJobId] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(15);
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [repeatTimes, setRepeatTimes] = React.useState(1);
  const [createTargets, setCreateTargets] = React.useState<string[]>(["bilibili"]);
  const [activeSettings, setActiveSettings] = React.useState("discovery");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [discoveryStatus, setDiscoveryStatus] =
    React.useState<DiscoveryStatusData | null>(null);
  const [progress, setProgress] = React.useState<Record<string, ProgressEvent>>(
    {},
  );
  const [duplicateUrl, setDuplicateUrl] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────
  React.useEffect(() => {
    Promise.all([
      invoke<RevideoSettings>("get_settings").catch(() => null),
      invoke<BrowserStatus>("get_browser_status").catch(() => null),
      invoke<HealthStatus>("get_health").catch(() => null),
      invoke<DiscoveryStatusData>("get_discovery_status").catch(() => null),
    ]).then(([s, b, h, d]) => {
      setSettings(s);
      setBrowser(b);
      setHealth(h);
      setDiscoveryStatus(d);
      setSettingsFormKey((k) => (k === 0 ? 1 : k));
    }).catch(() => {});
  }, []);

  const refresh = React.useCallback(async (showToast = false) => {
    try {
      const [j, q] = await Promise.all([
        invoke<JobData[]>("list_jobs"),
        invoke<QueueSnapshot>("get_queue"),
      ]);
      setJobs(j);
      setQueue(q);
      setSelectedJobId((c) => c || j[0]?.id || "");
      setLoading(false);
      if (showToast) toast.success(t("actions.dashboardRefreshed"));
    } catch {
      setLoading(false);
    }
  }, [t]);

  // Poll jobs every 15s
  React.useEffect(() => {
    refresh();
    const unlisten = listen<ProgressEvent>("job:progress", (ev) => {
      setProgress((p) => ({ ...p, [ev.payload.jobId]: ev.payload }));
      if (
        ev.payload.percent === 100 ||
        ev.payload.step === "error" ||
        ev.payload.step === "completed"
      ) {
        refresh();
      }
    });
    const timer = setInterval(() => refresh(), 15000);
    return () => {
      clearInterval(timer);
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  // Discovery status polling every 5s while running
  React.useEffect(() => {
    if (discoveryStatus?.last_status !== "running") return;
    const timer = setInterval(async () => {
      try {
        const d = await invoke<DiscoveryStatusData>("get_discovery_status");
        setDiscoveryStatus(d);
      } catch {
        /* ignore */
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [discoveryStatus?.last_status]);

  const selJob = jobs.find((j) => j.id === selectedJobId) || jobs[0];

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs
      .filter((j) => {
        const s = derivedStatus(j, queue);
        const title = (jobTitle(j) || "").toLowerCase();
        return (
          (statusFilter === "all" || s === statusFilter) && (!q || title.includes(q))
        );
      })
      .sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || ""),
      );
  }, [jobs, query, queue, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Reset page to 1 when filters change
  React.useEffect(() => {
    setPage(1);
  }, [statusFilter, query]);

  async function mutate(
    label: string,
    action: () => Promise<unknown>,
    skipRefresh = false,
  ) {
    setBusy(label);
    try {
      await action();
      if (!skipRefresh) await refresh();
      toast.success(t("actions.actionSubmitted"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }

  // ── Duplicate URL detection ──────────────────────────────────────────
  React.useEffect(() => {
    if (!createOpen || !sourceUrl.trim()) {
      setDuplicateUrl(null);
      return;
    }
    const url = sourceUrl.trim().toLowerCase();
    const dup = jobs.find(
      (j) => j.source?.url?.toLowerCase() === url,
    );
    setDuplicateUrl(dup ? dup.id : null);
  }, [sourceUrl, createOpen, jobs]);

  // ── Create job ────────────────────────────────────────────────────────
  async function createJob(e: React.FormEvent) {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const url = (data.get("sourceUrl") as string || "").trim();
    if (!url) return;
    await mutate("create", () =>
      invoke("create_job", {
        request: {
          url,
          targets: createTargets,
          options: {
            repeat_times: Number(data.get("repeatTimes") || 1),
            download_quality: String(data.get("downloadQuality") || "best"),
            target_language: String(data.get("targetLanguage") || "zh-CN"),
            render_comments: data.get("renderComments") === "on",
          },
        },
      }),
    );
    setSourceUrl("");
    setCreateOpen(false);
    setDuplicateUrl(null);
  }

  // ── Debounced settings save ──────────────────────────────────────────
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSaveSettings = React.useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      const data = new FormData(form);
      const partial: Record<string, unknown> = {};
      data.forEach((v, k) => {
        if (
          k.startsWith("llm.") ||
          k.startsWith("task.") ||
          k.startsWith("agent.")
        ) {
          const keys = k.split(".");
          let cur: Record<string, unknown> = partial;
          for (let i = 0; i < keys.length - 1; i++) {
            if (!cur[keys[i]]) cur[keys[i]] = {};
            cur = cur[keys[i]] as Record<string, unknown>;
          }
          cur[keys[keys.length - 1]] = v;
        }
      });
      invoke("update_settings", { partial }).catch((e) =>
        console.error("Save failed:", e),
      );
    }, 700);
  }, []);

  // Save on unmount as safety net
  const saveSettingsRef = React.useRef(debouncedSaveSettings);
  saveSettingsRef.current = debouncedSaveSettings;
  React.useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveSettingsRef.current();
  }, []);

  // ── Discovery ─────────────────────────────────────────────────────────
  async function runDiscoveryNow() {
    try {
      await invoke("run_discovery");
      toast.success(t("actions.actionSubmitted"));
      const d = await invoke<DiscoveryStatusData>("get_discovery_status").catch(
        () => null,
      );
      setDiscoveryStatus(d);
    } catch (e) {
      toast.error(String(e));
    }
  }

  // ── StatusBadge component ────────────────────────────────────────────
  function statusBadge(status: string) {
    const ic = "size-3 mr-1";
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-emerald-600 text-white">
            <CheckCircle2 className={ic} />
            {t(`status.completed`)}
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <XCircle className={ic} />
            {t(`status.failed`)}
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="destructive">
            <XCircle className={ic} />
            {t(`status.cancelled`)}
          </Badge>
        );
      case "running":
        return (
          <Badge>
            <Loader2 className={cn(ic, "animate-spin")} />
            {t(`status.running`)}
          </Badge>
        );
      case "publishing":
        return (
          <Badge className="bg-blue-600 text-white">
            <Rocket className={ic} />
            {t(`status.publishing`)}
          </Badge>
        );
      case "queued":
        return (
          <Badge variant="secondary">{t(`status.queued`)}</Badge>
        );
      case "paused":
        return (
          <Badge className="bg-yellow-600 text-white">
            <Pause className={ic} />
            {t(`status.paused`)}
          </Badge>
        );
      default:
        return <Badge variant="outline">{t(`status.${status}`)}</Badge>;
    }
  }

  // ── Platform chooser ────────────────────────────────────────────────
  const platformChooser = (
    value: string[],
    onChange: (v: string[]) => void,
  ) => (
    <div className="flex flex-wrap gap-2">
      {targetPlatforms.map((p) => {
        const checked = value.includes(p);
        return (
          <Button
            key={p}
            type="button"
            variant={checked ? "default" : "outline"}
            size="sm"
            onClick={() =>
              onChange(checked ? value.filter((x) => x !== p) : [...value, p])
            }
          >
            {platformNames[p] || p}
          </Button>
        );
      })}
    </div>
  );

  // ── Loading ──────────────────────────────────────────────────────────
  if (loading)
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-4 animate-spin mr-2" />
        {t("app.loading")}
      </div>
    );

  // =====================================================================
  //  JOBS VIEW
  // =====================================================================
  if (view === "jobs")
    return (
      <div className="grid gap-4">
        <PageHeader
          icon={Layers}
          title={t("page.jobsTitle")}
          description={t("page.jobsDescription")}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          {/* Table */}
          <Card>
            <CardContent className="grid gap-4 pt-4">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-60">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("jobs.searchPlaceholder")}
                  />
                </div>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => v && setStatusFilter(v)}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["all", "running", "publishing", "paused", "completed", "failed"].map(
                      (s) => (
                        <SelectItem key={s} value={s}>
                          {s === "all"
                            ? t("jobs.allStatuses")
                            : t(`status.${s}`)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => refresh(true)}>
                  <RefreshCcw />
                </Button>
                <div className="ml-auto">
                  <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger>
                      <Button>
                        <Plus /> {t("actions.createWorkflow")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-[560px] max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>{t("create.dialogTitle")}</DialogTitle>
                        <DialogDescription>
                          {t("create.dialogDescription")}
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={createJob} className="grid gap-4">
                        {/* URL input */}
                        <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 ring-1 ring-border">
                          <Link2 className="size-4 text-muted-foreground" />
                          <Input
                            name="sourceUrl"
                            value={sourceUrl}
                            onChange={(e) => setSourceUrl(e.target.value)}
                            placeholder={t("create.urlPlaceholder")}
                            className="border-0 bg-transparent shadow-none"
                          />
                        </div>
                        {/* Duplicate warning */}
                        {duplicateUrl && (
                          <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                            <span>{t("create.duplicateWarning")}</span>
                          </div>
                        )}
                        {/* Quality */}
                        <div className="flex items-center justify-between">
                          <Label>{t("create.downloadQuality")}</Label>
                          <Select name="downloadQuality" defaultValue="best">
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RES_OPTS.map(([v, l]) => (
                                <SelectItem key={v} value={v}>
                                  {l}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {/* Repeat times */}
                        <div className="flex items-center justify-between">
                          <Label>{t("create.repeatTimes")}</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              name="repeatTimes"
                              type="number"
                              min={1}
                              max={10}
                              value={repeatTimes}
                              onChange={(e) =>
                                setRepeatTimes(Number(e.target.value || 1))
                              }
                              className="w-20"
                            />
                            <span className="text-xs text-muted-foreground">
                              {t("create.repeatTimesSuffix")}
                            </span>
                          </div>
                        </div>
                        {/* Render comments */}
                        <div className="flex items-center justify-between">
                          <Label>{t("create.renderComments")}</Label>
                          <Switch name="renderComments" defaultChecked />
                        </div>
                        {/* Target platforms */}
                        <div>
                          <Label className="mb-1 block">
                            {t("create.targetPlatforms")}
                          </Label>
                          {platformChooser(createTargets, setCreateTargets)}
                        </div>
                        <DialogFooter>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setCreateOpen(false)}
                          >
                            {t("actions.cancel")}
                          </Button>
                          <Button
                            type="submit"
                            disabled={busy === "create"}
                          >
                            {busy === "create" ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Plus />
                            )}
                            {t("create.createAndRun")}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              {/* Jobs table */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("jobs.job")}</TableHead>
                    <TableHead>{t("jobs.progress")}</TableHead>
                    <TableHead>{t("jobs.status")}</TableHead>
                    <TableHead className="text-right">
                      {t("jobs.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((j) => {
                    const st = derivedStatus(j, queue);
                    const p = progress[j.id];
                    return (
                      <TableRow
                        key={j.id}
                        data-state={
                          selJob?.id === j.id ? "selected" : undefined
                        }
                        className="cursor-pointer"
                        onClick={() => setSelectedJobId(j.id)}
                      >
                        <TableCell className="max-w-[300px]">
                          <div className="font-medium truncate">
                            {jobTitle(j)}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {j.source?.url}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-32">
                          <Progress
                            value={
                              p && p.percent < 100
                                ? p.percent
                                : stepProgress(j)
                            }
                          />
                          <div className="text-xs text-muted-foreground mt-1">
                            {stepCounter(j).current}/{stepCounter(j).total}{" "}
                            {stepLabel(stepCounter(j).step, t)}
                          </div>
                        </TableCell>
                        <TableCell>{statusBadge(st)}</TableCell>
                        <TableCell
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {j.source?.url && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    window.open(j.source.url!, "_blank")
                                  }
                                >
                                  <Link2 className="size-3 mr-1" />
                                  {t("jobs.source")}
                                </DropdownMenuItem>
                              )}
                              {j.artifacts?.derived?.render_path && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    window.open(
                                      convertFileSrc(
                                        j.artifacts!.derived!.render_path!,
                                      ),
                                      "_blank",
                                    )
                                  }
                                >
                                  <ExternalLink className="size-3 mr-1" />
                                  {t("actions.openOutput")}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {st === "running" && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    mutate("pause", () =>
                                      invoke("pause_job", { id: j.id }),
                                    )
                                  }
                                >
                                  <Pause className="size-3 mr-1" />
                                  {t("actions.pause")}
                                </DropdownMenuItem>
                              )}
                              {(st === "pending" ||
                                st === "paused" ||
                                st === "failed") && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    mutate("resume", () =>
                                      invoke("resume_job", { id: j.id }),
                                    )
                                  }
                                >
                                  <Play className="size-3 mr-1" />
                                  {t("actions.resume")}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() =>
                                  mutate("retry", () =>
                                    invoke("retry_job", { id: j.id }),
                                  )
                                }
                              >
                                <RotateCcw className="size-3 mr-1" />
                                {t("actions.retry")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  mutate("delete", () =>
                                    invoke("delete_job", { id: j.id }),
                                  )
                                }
                              >
                                <Trash2 className="size-3 mr-1" />
                                {t("actions.delete")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {paged.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {t("jobs.noMatchingJobs")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => v && setPageSize(Number(v))}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[15, 30, 50, 100].map((s) => (
                        <SelectItem key={s} value={String(s)}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span>
                    {t("jobs.showingRows", {
                      start: Math.min(filtered.length, (page - 1) * pageSize + 1),
                      end: Math.min(filtered.length, page * pageSize),
                      total: filtered.length,
                    })}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {t("jobs.previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t("jobs.next")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Detail panel */}
          {selJob ? (
            <Card className="xl:sticky xl:top-0">
              <CardHeader>
                <CardTitle className="truncate">{jobTitle(selJob)}</CardTitle>
                <CardDescription className="break-all text-xs">
                  {selJob.source?.url || selJob.id}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {/* Badges */}
                <div className="flex flex-wrap gap-2">
                  {statusBadge(derivedStatus(selJob, queue))}
                  <Badge variant="outline">
                    {platformNames[selJob.source?.platform || ""] ||
                      selJob.source?.platform ||
                      t("jobs.source")}
                  </Badge>
                  {selJob.options?.target_comment_count != null && (
                    <Badge variant="outline">
                      {selJob.options.target_comment_count} {t("jobs.comments")}
                    </Badge>
                  )}
                </div>

                {/* Action buttons based on job status */}
                <div className="flex flex-wrap gap-2">
                  {(derivedStatus(selJob, queue) === "pending" ||
                    derivedStatus(selJob, queue) === "failed") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        mutate("run", () =>
                          invoke("run_full_pipeline", {
                            id: selJob.id,
                          }),
                        )
                      }
                    >
                      <Play className="size-3 mr-1" />
                      Run Pipeline
                    </Button>
                  )}
                  {derivedStatus(selJob, queue) === "running" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        mutate("pause", () =>
                          invoke("pause_job", { id: selJob.id }),
                        )
                      }
                    >
                      <Pause className="size-3 mr-1" />
                      {t("actions.pause")}
                    </Button>
                  )}
                  {derivedStatus(selJob, queue) === "paused" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        mutate("resume", () =>
                          invoke("resume_job", { id: selJob.id }),
                        )
                      }
                    >
                      <Play className="size-3 mr-1" />
                      {t("actions.resume")}
                    </Button>
                  )}
                  {derivedStatus(selJob, queue) === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        mutate("retry", () =>
                          invoke("retry_job", { id: selJob.id }),
                        )
                      }
                    >
                      <RotateCcw className="size-3 mr-1" />
                      {t("actions.retry")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      mutate("delete", () =>
                        invoke("delete_job", { id: selJob.id }),
                      )
                    }
                  >
                    <Trash2 className="size-3 mr-1" />
                    {t("actions.delete")}
                  </Button>
                </div>

                {/* Real-time progress banner */}
                {progress[selJob.id] && (
                  <div className="rounded border p-2 bg-blue-50">
                    <div className="flex items-center gap-2 text-xs text-blue-700">
                      <Loader2 className="size-3 animate-spin" />
                      {progress[selJob.id].step} {progress[selJob.id].percent}%
                      {progress[selJob.id].message && (
                        <span className="text-muted-foreground">
                          — {progress[selJob.id].message}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Workflow steps with error display */}
                <div className="grid gap-1.5">
                  {workflowOrder.map((step) => {
                    const s = selJob.workflow.steps[step];
                    const isDone = s?.status === "completed";
                    const isFail = s?.status === "failed";
                    const isRun = s?.status === "running";
                    return (
                      <div
                        key={step}
                        className={cn(
                          "flex items-center justify-between rounded border p-2 text-xs",
                          isFail
                            ? "border-red-200 bg-red-50"
                            : isRun
                              ? "border-blue-200 bg-blue-50"
                              : isDone
                                ? "border-green-200 bg-green-50"
                                : "",
                        )}
                      >
                        <span className="font-medium">
                          {stepLabel(step, t)}
                        </span>
                        <div className="flex items-center gap-2">
                          {s?.percent != null ? (
                            <span className="text-muted-foreground">
                              {s.percent}%
                            </span>
                          ) : null}
                          {statusBadge(s?.status || "pending")}
                        </div>
                      </div>
                    );
                  })}
                  {workflowOrder.some(
                    (step) => selJob.workflow.steps[step]?.error,
                  ) && (
                    <div className="rounded border border-red-200 bg-red-50 p-3 text-xs">
                      {workflowOrder
                        .filter((step) => selJob.workflow.steps[step]?.error)
                        .map((step) => (
                          <div key={step} className="mb-1 last:mb-0">
                            <span className="font-medium">
                              {stepLabel(step, t)}:{" "}
                            </span>
                            <span className="text-red-700">
                              {selJob.workflow.steps[step].error}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Cover image preview */}
                {selJob.artifacts?.derived?.cover_path && (
                  <img
                    src={convertFileSrc(selJob.artifacts.derived.cover_path)}
                    alt="Cover"
                    className="w-full rounded-md border object-cover max-h-48"
                    onError={(e) =>
                      ((e.target as HTMLImageElement).style.display = "none")
                    }
                  />
                )}

                {/* Open output link */}
                {selJob.artifacts?.derived?.render_path && (
                  <a
                    href={convertFileSrc(selJob.artifacts.derived.render_path)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <ExternalLink className="size-3" />
                    {t("actions.openOutput")}
                  </a>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                {t("jobs.noJobSelected")}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );

  // =====================================================================
  //  PUBLISHING VIEW
  // =====================================================================
  if (view === "publishing")
    return (
      <div className="grid gap-4">
        <PageHeader
          icon={Rocket}
          title={t("page.publishingTitle")}
          description={t("page.publishingDescription")}
        />
        <Card>
          <CardHeader>
            <CardTitle>{t("publishing.targets")}</CardTitle>
            <CardDescription>
              {t("publishing.targetsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {jobs
              .flatMap((j) =>
                (j.targets || []).map((tgt) => ({
                  job: j,
                  target: tgt,
                })),
              )
              .slice(0, 50)
              .map(({ job, target }) => (
                <div
                  key={`${job.id}-${target.platform}`}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <div className="font-medium text-sm truncate">
                      {jobTitle(job)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {platformNames[target.platform] || target.platform}
                    </div>
                  </div>
                  {statusBadge(target.status)}
                </div>
              ))}
            {jobs.filter((j) => (j.targets || []).length > 0).length === 0 && (
              <div className="py-10 text-center text-muted-foreground">
                {t("jobs.noMatchingJobs")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );

  // =====================================================================
  //  HEALTH VIEW
  // =====================================================================
  if (view === "health")
    return (
      <div className="grid gap-4">
        <PageHeader
          icon={Activity}
          title={t("page.healthTitle")}
          description={t("page.healthDescription")}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {/* Browser card */}
          <Card>
            <CardHeader>
              <CardTitle>{t("browser.automation")}</CardTitle>
              <CardDescription>
                {t("browser.automationDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Badge
                variant={
                  browser?.running ? "default" : "outline"
                }
              >
                {browser?.running
                  ? t("browser.running")
                  : t("status.paused")}
              </Badge>
              {browser?.cdp_port && (
                <p className="text-xs text-muted-foreground">
                  CDP port: {browser.cdp_port}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    mutate("browser", () => invoke("start_browser"))
                  }
                >
                  <Play className="size-3 mr-1" />
                  {t("actions.start")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    mutate("browser", () => invoke("restart_browser"))
                  }
                >
                  <RefreshCcw className="size-3 mr-1" />
                  {t("actions.restart")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    invoke("open_platform_login", {
                      platform: "bilibili",
                    });
                    toast.success(t("actions.bilibiliLogin"));
                  }}
                >
                  {t("actions.bilibiliLogin")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    invoke("open_platform_login", {
                      platform: "douyin",
                    });
                    toast.success(t("actions.douyinLogin"));
                  }}
                >
                  {t("actions.douyinLogin")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dependencies card */}
          <Card>
            <CardHeader>
              <CardTitle>{t("browser.dependencies")}</CardTitle>
              <CardDescription>
                {t("browser.dependenciesDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {health &&
                ([
                  ["Overall", health.healthy],
                  ["FFmpeg", health.ffmpeg_available],
                  ["yt-dlp", health.ytdlp_available],
                  ["Browser", health.sidecar_running],
                  ["LLM", health.llm_configured],
                ] as [string, boolean][]).map(([n, ok]) => (
                  <div
                    key={n}
                    className="flex items-center justify-between rounded border p-2 text-sm"
                  >
                    <span>{n}</span>
                    {ok ? (
                      <CheckCircle2 className="size-4 text-green-500" />
                    ) : (
                      <XCircle className="size-4 text-red-500" />
                    )}
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );

  // =====================================================================
  //  SETTINGS VIEW
  // =====================================================================
  const groups = [
    {
      group: "Pipeline",
      items: [
        { id: "discovery", label: "Discovery", icon: Compass },
        { id: "download", label: "Download", icon: Download },
        { id: "prepare", label: "Prepare", icon: SlidersHorizontal },
        { id: "translation", label: "Translate", icon: Globe },
        { id: "cover", label: "Cover", icon: Layers },
        { id: "render", label: "Render", icon: Play },
        { id: "publish", label: "Publish", icon: Send },
      ],
    },
    {
      group: "Models",
      items: [
        { id: "llm", label: "LLM", icon: Cpu },
        { id: "agent", label: "Agent", icon: Rocket },
      ],
    },
  ];

  if (view === "settings")
    return (
      <form
        key={settingsFormKey}
        ref={formRef}
        className="grid gap-4"
        onSubmit={(e) => e.preventDefault()}
        onChange={() => debouncedSaveSettings()}
      >
        <PageHeader
          icon={SlidersHorizontal}
          title={t("page.settingsTitle")}
          description={t("page.settingsDescription")}
        />
        <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
          {/* Left sidebar nav */}
          <nav className="flex flex-col gap-5 lg:border-r lg:pr-4">
            {groups.map((g) => (
              <div key={g.group} className="grid gap-1">
                <div className="px-2.5 pb-1 font-medium text-muted-foreground text-xs uppercase">
                  {g.group}
                </div>
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSettings === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveSettings(item.id)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        active
                          ? "bg-muted font-medium"
                          : "text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      <Icon className="size-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Right content */}
          <div className="min-w-0 max-w-xl">
            {/* ── Discovery ─────────────────────────────────────────── */}
            {activeSettings === "discovery" && (
              <SettingsSection
                title="Discovery"
                desc="Auto-scan channels for new content."
              >
                <div className="space-y-3">
                  <SwitchRow
                    label="Enabled"
                    name="task.discovery.enabled"
                    defaultChecked={getNested(
                      settings,
                      "task.discovery.enabled",
                      "true",
                    ) === "true"}
                  />
                  <div>
                    <Label>Channels (one per line)</Label>
                    <Textarea
                      name="task.discovery.channels"
                      rows={4}
                      className="font-mono text-xs"
                      placeholder="https://youtube.com/@channel"
                      defaultValue={getNested(
                        settings,
                        "task.discovery.channels",
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <LabelInput
                      label="Min Views"
                      name="task.discovery.min_views"
                      type="number"
                      defaultValue={getNested(
                        settings,
                        "task.discovery.min_views",
                      )}
                    />
                    <LabelInput
                      label="Min Comments"
                      name="task.discovery.min_comments"
                      type="number"
                      defaultValue={getNested(
                        settings,
                        "task.discovery.min_comments",
                      )}
                    />
                    <LabelInput
                      label="Max Age (days)"
                      name="task.discovery.max_age_days"
                      type="number"
                      defaultValue={getNested(
                        settings,
                        "task.discovery.max_age_days",
                      )}
                    />
                  </div>
                  <div>
                    <Label>Semantic Filter Prompt</Label>
                    <Textarea
                      name="task.discovery.semantic_filter_prompt"
                      rows={2}
                      defaultValue={getNested(
                        settings,
                        "task.discovery.semantic_filter_prompt",
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <LabelInput
                      label="Max Duration (s)"
                      name="task.discovery.max_duration_sec"
                      type="number"
                      defaultValue={getNested(
                        settings,
                        "task.discovery.max_duration_sec",
                      )}
                    />
                    <LabelInput
                      label="Repeat Times"
                      name="task.discovery.repeat_times"
                      type="number"
                      defaultValue={getNested(
                        settings,
                        "task.discovery.repeat_times",
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <LabelInput
                      label="Run Hour (0-23)"
                      name="task.discovery.run_hour"
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={getNested(
                        settings,
                        "task.discovery.run_hour",
                      )}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={runDiscoveryNow}
                      disabled={discoveryStatus?.last_status === "running"}
                    >
                      <Play className="size-3 mr-1" />
                      Run Discovery Now
                    </Button>
                    {discoveryStatus?.last_status && (
                      <Badge variant="outline">
                        {discoveryStatus.last_status === "running" && (
                          <Loader2 className="size-3 mr-1 animate-spin" />
                        )}
                        {discoveryStatus.last_status}
                      </Badge>
                    )}
                  </div>
                </div>
              </SettingsSection>
            )}

            {/* ── Download ──────────────────────────────────────────── */}
            {activeSettings === "download" && (
              <SettingsSection
                title="Download"
                desc="Video quality and comment scraping."
              >
                <div className="space-y-3">
                  <SelectField
                    label="Video Quality"
                    name="task.download.video_quality"
                    defaultValue={getNested(
                      settings,
                      "task.download.video_quality",
                      "best",
                    )}
                    options={RES_OPTS}
                  />
                  <LabelInput
                    label="Max Comments"
                    name="task.download.max_comments"
                    type="number"
                    defaultValue={getNested(
                      settings,
                      "task.download.max_comments",
                    )}
                  />
                  <LabelInput
                    label="Retry Count"
                    name="task.download.retry_count"
                    type="number"
                    defaultValue={getNested(
                      settings,
                      "task.download.retry_count",
                    )}
                  />
                  <LabelInput
                    label="Timeout (sec)"
                    name="task.download.timeout_sec"
                    type="number"
                    defaultValue={getNested(
                      settings,
                      "task.download.timeout_sec",
                    )}
                  />
                </div>
              </SettingsSection>
            )}

            {/* ── Prepare ───────────────────────────────────────────── */}
            {activeSettings === "prepare" && (
              <SettingsSection
                title="Prepare"
                desc="Output aspect ratio, resolution, and fit mode."
              >
                <div className="space-y-3">
                  <SelectField
                    label="Output Aspect"
                    name="task.prepare.output_aspect"
                    defaultValue={getNested(
                      settings,
                      "task.prepare.output_aspect",
                    )}
                    options={[
                      ["portrait", "Portrait (9:16)"],
                      ["landscape", "Landscape (16:9)"],
                      ["source", "Source (original)"],
                    ]}
                  />
                  <SelectField
                    label="Output Resolution"
                    name="task.prepare.output_resolution"
                    defaultValue={getNested(
                      settings,
                      "task.prepare.output_resolution",
                    )}
                    options={[
                      ["auto", "Auto"],
                      ["1080x1920", "1080x1920"],
                      ["720x1280", "720x1280"],
                      ["1080x1920", "1080x1920"],
                      ["1920x1080", "1920x1080"],
                      ["1080x1080", "1080x1080"],
                    ]}
                  />
                  <SelectField
                    label="Fit Mode"
                    name="task.prepare.fit_mode"
                    defaultValue={getNested(
                      settings,
                      "task.prepare.fit_mode",
                    )}
                    options={[
                      ["contain", "Contain"],
                      ["cover", "Cover"],
                      ["stretch", "Stretch"],
                    ]}
                  />
                  <SwitchRow
                    label="Subtitle Cleanup"
                    name="task.prepare.subtitle_cleanup"
                    defaultChecked={getNested(
                      settings,
                      "task.prepare.subtitle_cleanup",
                      "false",
                    ) === "true"}
                  />
                </div>
              </SettingsSection>
            )}

            {/* ── Translation ───────────────────────────────────────── */}
            {activeSettings === "translation" && (
              <SettingsSection
                title="Translation"
                desc="Language, modes, style, and prompt overrides."
              >
                <div className="space-y-3">
                  <LabelInput
                    label="Target Language"
                    name="task.translation.target_language"
                    placeholder="zh-CN"
                    defaultValue={getNested(
                      settings,
                      "task.translation.target_language",
                    )}
                  />
                  <SelectField
                    label="Subtitle Mode"
                    name="task.translation.subtitle_mode"
                    defaultValue={getNested(
                      settings,
                      "task.translation.subtitle_mode",
                    )}
                    options={[
                      ["auto", t("create.auto")],
                      ["always", t("create.alwaysTranslate")],
                      ["off", t("create.noTranslate")],
                    ]}
                  />
                  <SelectField
                    label="Comment Mode"
                    name="task.translation.comment_mode"
                    defaultValue={getNested(
                      settings,
                      "task.translation.comment_mode",
                    )}
                    options={[
                      ["auto", t("create.auto")],
                      ["always", t("create.alwaysTranslate")],
                      ["off", t("create.noTranslate")],
                    ]}
                  />
                  <SwitchRow
                    label="Bilingual Subtitles"
                    name="task.translation.bilingual_subtitles"
                    defaultChecked={getNested(
                      settings,
                      "task.translation.bilingual_subtitles",
                      "false",
                    ) === "true"}
                  />
                  <SelectField
                    label="Sensitive Content"
                    name="task.translation.sensitive_content"
                    defaultValue={getNested(
                      settings,
                      "task.translation.sensitive_content",
                    )}
                    options={[
                      ["preserve", t("create.preserve")],
                      ["soften", t("create.soften")],
                      ["mark", t("create.mark")],
                      ["delete", t("create.delete")],
                    ]}
                  />
                  <LabelInput
                    label="Style Constraints"
                    name="task.translation.style_constraints"
                    defaultValue={getNested(
                      settings,
                      "task.translation.style_constraints",
                    )}
                  />
                  <PromptField
                    label={t("create.subtitlePrompt")}
                    name="task.translation.subtitle_prompt_override"
                    defaultValue={getNested(
                      settings,
                      "task.translation.subtitle_prompt_override",
                    )}
                  />
                  <PromptField
                    label={t("create.commentPrompt")}
                    name="task.translation.comment_prompt_override"
                    defaultValue={getNested(
                      settings,
                      "task.translation.comment_prompt_override",
                    )}
                  />
                </div>
              </SettingsSection>
            )}

            {/* ── Cover ──────────────────────────────────────────────── */}
            {activeSettings === "cover" && (
              <SettingsSection
                title="Cover"
                desc="Cover image generation with templates."
              >
                <CoverCopyPane
                  settings={settings as unknown as Record<string, unknown>}
                  getNested={getNested}
                  onChanged={debouncedSaveSettings}
                />
              </SettingsSection>
            )}

            {/* ── Render ────────────────────────────────────────────── */}
            {activeSettings === "render" && (
              <SettingsSection
                title="Render"
                desc="Video rendering and output settings."
              >
                <div className="space-y-3">
                  <LabelInput
                    label="Output Dir"
                    name="task.render.output_dir"
                    defaultValue={getNested(
                      settings,
                      "task.render.output_dir",
                    )}
                  />
                  <SwitchRow
                    label="Render Comments"
                    name="task.render.render_comments"
                    defaultChecked={getNested(
                      settings,
                      "task.render.render_comments",
                      "true",
                    ) === "true"}
                  />
                  <LabelInput
                    label="Comment Font Size"
                    name="task.render.comment_font_size"
                    type="number"
                    defaultValue={getNested(
                      settings,
                      "task.render.comment_font_size",
                    )}
                  />
                  <LabelInput
                    label="Subtitle Font Size"
                    name="task.render.subtitle_font_size"
                    type="number"
                    defaultValue={getNested(
                      settings,
                      "task.render.subtitle_font_size",
                    )}
                  />
                  <LabelInput
                    label="Repeat Times"
                    name="task.render.repeat_times"
                    type="number"
                    defaultValue={getNested(
                      settings,
                      "task.render.repeat_times",
                    )}
                  />
                  <SelectField
                    label="Output Format"
                    name="task.render.output_format"
                    defaultValue={getNested(
                      settings,
                      "task.render.output_format",
                      "mp4",
                    )}
                    options={[["mp4", "MP4"], ["mov", "MOV"]]}
                  />
                  <SwitchRow
                    label="Hardware Acceleration"
                    name="task.render.hardware_accel"
                    defaultChecked={getNested(
                      settings,
                      "task.render.hardware_accel",
                      "false",
                    ) === "true"}
                  />
                  <SelectField
                    label="Comment Content"
                    name="task.render.comment_content"
                    defaultValue={getNested(
                      settings,
                      "task.render.comment_content",
                    )}
                    options={[
                      ["full", "Full"],
                      ["truncated", "Truncated"],
                      ["summary", "Summary"],
                    ]}
                  />
                </div>
              </SettingsSection>
            )}

            {/* ── Publish ────────────────────────────────────────────── */}
            {activeSettings === "publish" && (
              <SettingsSection
                title="Publish"
                desc="Per-platform publishing configuration."
              >
                <Tabs defaultValue="bilibili">
                  <TabsList className="flex-wrap">
                    {publishPlatforms.map((p) => (
                      <TabsTrigger key={p} value={p} className="text-xs">
                        {platformNames[p]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {publishPlatforms.map((p) => (
                    <TabsContent
                      key={p}
                      value={p}
                      className="space-y-3 mt-2"
                    >
                      <SwitchRow
                        label="Enabled"
                        name={`task.publish.platforms.${p}.enabled`}
                        defaultChecked={getNested(
                          settings,
                          `task.publish.platforms.${p}.enabled`,
                          "false",
                        ) === "true"}
                      />
                      <SelectField
                        label="Default Action"
                        name={`task.publish.platforms.${p}.default_action`}
                        defaultValue={getNested(
                          settings,
                          `task.publish.platforms.${p}.default_action`,
                        )}
                        options={[
                          ["publish", "Publish"],
                          ["draft", "Draft"],
                          ["dry-run", "Dry Run"],
                        ]}
                      />
                      <PromptField
                        label="Title Prompt"
                        name={`task.publish.platforms.${p}.title_prompt`}
                        defaultValue={getNested(
                          settings,
                          `task.publish.platforms.${p}.title_prompt`,
                        )}
                      />
                      <PromptField
                        label="Description Prompt"
                        name={`task.publish.platforms.${p}.description_prompt`}
                        defaultValue={getNested(
                          settings,
                          `task.publish.platforms.${p}.description_prompt`,
                        )}
                      />
                      <PromptField
                        label="Tags Prompt"
                        name={`task.publish.platforms.${p}.tags_prompt`}
                        defaultValue={getNested(
                          settings,
                          `task.publish.platforms.${p}.tags_prompt`,
                        )}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              </SettingsSection>
            )}

            {/* ── LLM ────────────────────────────────────────────────── */}
            {activeSettings === "llm" && (
              <SettingsSection
                title="LLM"
                desc="OpenAI-compatible API configuration."
              >
                <div className="space-y-3">
                  <WideLabelInput
                    label="API Base URL"
                    name="llm.api_base"
                    placeholder="https://api.openai.com/v1"
                    defaultValue={getNested(settings, "llm.api_base")}
                  />
                  <WideLabelInput
                    label="Text Model"
                    name="llm.text_model"
                    placeholder="gpt-4o"
                    defaultValue={getNested(settings, "llm.text_model")}
                  />
                  <WideLabelInput
                    label="API Key"
                    name="llm.api_key"
                    type="password"
                    defaultValue={getNested(settings, "llm.api_key")}
                  />
                  <WideLabelInput
                    label="Vision Model"
                    name="llm.vision_model"
                    defaultValue={getNested(settings, "llm.vision_model")}
                  />
                  <WideLabelInput
                    label="Temperature"
                    name="llm.temperature"
                    type="number"
                    step={0.1}
                    defaultValue={getNested(settings, "llm.temperature")}
                  />
                  <WideLabelInput
                    label="Timeout (sec)"
                    name="llm.timeout_secs"
                    type="number"
                    defaultValue={getNested(settings, "llm.timeout_secs")}
                  />
                </div>
              </SettingsSection>
            )}

            {/* ── Agent ─────────────────────────────────────────────── */}
            {activeSettings === "agent" && (
              <SettingsSection
                title="Agent"
                desc="AI agent instruction for MCP integration."
              >
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Agent Instruction
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(AGENT_INSTRUCTION);
                        toast.success("Copied to clipboard");
                      }}
                    >
                      <Copy className="size-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <Textarea
                    readOnly
                    value={AGENT_INSTRUCTION}
                    className="min-h-48 bg-muted/40 font-mono text-xs"
                    rows={16}
                  />
                </div>
              </SettingsSection>
            )}
          </div>
        </div>
      </form>
    );

  return null;
}
