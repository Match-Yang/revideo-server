# Discovery（发现）功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现「发现」功能——自动扫描监控的 YouTube 频道，经硬性过滤 + 去重 + LLM 语义过滤后，对新增视频自动创建任务并发布。

**Architecture:** 在 `src/discovery/` 下新增独立模块（types/store/llm-filter/discover/scheduler），抓取层在 `src/platforms/sources/youtube.ts` 加 `listChannelVideos` + `probeBatch`，配置在 `src/settings.ts` 扩展 `task.discovery`，路由层在 `src/server.ts` 编排 job 创建（复用现有 `createJobFromRequest`/`enqueueJobRun`），UI 在 `dashboard/.../revideo-console.tsx` 加「发现」侧边栏项。

**Tech Stack:** TypeScript (Express v5 服务端)、Next.js 16 + React dashboard、yt-dlp（child_process）、复用现有 LLM 翻译通道。

**Spec:** `docs/superpowers/specs/2026-07-08-discovery-design.md`

**测试说明:** 本项目无通用测试套件（见 CLAUDE.md）。采用既有模式：每个可独立测试的模块配一个 `scripts/*-smoke-test.ts` 脚本，用 `npx tsx` 运行；集成层用 `curl` 手动验证。

---

## 文件结构

### 新增文件
| 文件 | 职责 |
|---|---|
| `src/discovery/types.ts` | 所有发现相关 TS 类型 |
| `src/discovery/store.ts` | 读写 `~/.revideo-server/data/discovery.json` 运行记录 |
| `src/platforms/sources/youtube-list.ts` | `listChannelVideos()` + `probeBatch()`（单独成文件，避免 `youtube.ts` 膨胀） |
| `src/discovery/llm-filter.ts` | `llmFilterVideos()` LLM 语义过滤 |
| `src/discovery/discover.ts` | `runDiscovery()` 主流程编排 |
| `src/discovery/scheduler.ts` | `startDiscoveryScheduler()` 定时调度 |
| `scripts/discovery-smoke-test.ts` | 发现流程冒烟测试 |

### 修改文件
| 文件 | 改动 |
|---|---|
| `src/settings.ts` | `RevideoSettings.task.discovery` 类型 + `defaultSettings.task.discovery` |
| `src/server.ts` | `/api/discovery/run` + `/api/discovery/status` 路由；`app.listen` 启动调度器；job 创建编排 |
| `dashboard/.../revideo-console.tsx` | 「发现」侧边栏项 + Pane + 手动触发 + 状态展示 |
| `package.json` | 加 `"test:discovery": "tsx scripts/discovery-smoke-test.ts"` |

---

## Task 1: 扩展 settings 配置（后端）

**Files:**
- Modify: `src/settings.ts`（`RevideoSettings` 接口 + `defaultSettings`）

- [ ] **Step 1: 在 `RevideoSettings.task` 接口加 `discovery` 字段**

在 `src/settings.ts` 的 `RevideoSettings` 接口里，`task.render` 块之后、`task.publish` 之前插入：

```ts
    discovery: {
      enabled: boolean;
      channels: string[];
      filters: {
        minViews: number;
        minComments: number;
        maxAgeDays: number;
      };
      llmPrompt: string;
      targets: TargetPlatform[];
      shortVideo: {
        maxDurationSec: number;
        repeatTimes: number;
      };
      scheduleHour: number;
    };
```

注意：`TargetPlatform` 已在该文件顶部 import（`task.publish.defaultPlatforms: TargetPlatform[]` 用到了），无需新增 import。

- [ ] **Step 2: 在 `defaultSettings.task` 加对应默认值**

在 `defaultSettings` 的 `task.render` 之后、`task.publish` 之前插入：

```ts
    discovery: {
      enabled: false,
      channels: [],
      filters: {
        minViews: 1000,
        minComments: 10,
        maxAgeDays: 30,
      },
      llmPrompt: "",
      targets: [],
      shortVideo: {
        maxDurationSec: 60,
        repeatTimes: 3,
      },
      scheduleHour: 1,
    },
```

- [ ] **Step 3: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误（`deepMerge` 会自动给老用户 settings.json 补齐这些字段）。

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "feat(discovery): 在 settings 加 task.discovery 配置组"
```

---

## Task 2: 发现运行记录存储（`src/discovery/store.ts`）

**Files:**
- Create: `src/discovery/types.ts`
- Create: `src/discovery/store.ts`

- [ ] **Step 1: 创建 `src/discovery/types.ts`**

```ts
// 发现功能的类型定义

export interface DiscoveryRunStats {
  scanned: number;
  hardFiltered: number;
  deduped: number;
  llmFiltered: number;
  created: number;
}

export interface DiscoveryRunRecord {
  lastRunAt: string;
  lastRunStatus: "success" | "running" | "failed";
  stats: DiscoveryRunStats;
  createdJobIds: string[];
  errors: string[];
}

export interface DiscoveredVideo {
  videoId: string;
  url: string;
  title: string;
  durationSec?: number;
  viewCount?: number;
  commentCount?: number;
  publishedAt?: string;
  repeatTimes: number;
}

export interface DiscoveryOptions {
  manual?: boolean;
  signal?: AbortSignal;
}

export interface DiscoveryResult {
  stats: DiscoveryRunStats;
  videos: DiscoveredVideo[];
  errors: string[];
}

export interface ChannelVideoEntry {
  videoId: string;
  url: string;
  title: string;
  durationSec?: number;
  viewCount?: number;
}

export interface ProbeBatchOptions {
  concurrency?: number;
  delayMs?: number;
  signal?: AbortSignal;
}
```

- [ ] **Step 2: 创建 `src/discovery/store.ts`**

```ts
import path from "path";
import fs from "fs";
import { DATA_DIR } from "../config";
import type { DiscoveryRunRecord, DiscoveryRunStats } from "./types";

const DISCOVERY_FILE = path.join(DATA_DIR, "discovery.json");

const EMPTY_STATS: DiscoveryRunStats = {
  scanned: 0,
  hardFiltered: 0,
  deduped: 0,
  llmFiltered: 0,
  created: 0,
};

export function loadDiscoveryRecord(): DiscoveryRunRecord | null {
  try {
    const raw = fs.readFileSync(DISCOVERY_FILE, "utf-8");
    return JSON.parse(raw) as DiscoveryRunRecord;
  } catch {
    return null;
  }
}

export function saveDiscoveryRecord(record: DiscoveryRunRecord): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DISCOVERY_FILE, JSON.stringify(record, null, 2), "utf-8");
}

export function emptyStats(): DiscoveryRunStats {
  return { ...EMPTY_STATS };
}

/** 标记为「运行中」并写入。用于手动触发/定时触发时占位，避免重入。 */
export function markRunning(): void {
  saveDiscoveryRecord({
    lastRunAt: new Date().toISOString(),
    lastRunStatus: "running",
    stats: emptyStats(),
    createdJobIds: [],
    errors: [],
  });
}
```

- [ ] **Step 3: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/discovery/types.ts src/discovery/store.ts
git commit -m "feat(discovery): 新增运行记录存储 store.ts"
```

---

## Task 3: 频道视频列表抓取（`listChannelVideos`）

**Files:**
- Create: `src/platforms/sources/youtube-list.ts`
- Modify: `src/platforms/sources/youtube.ts`（导出 `jsRuntimeArgs` 和 `execFileText` 供新文件复用）

- [ ] **Step 1: 在 `youtube.ts` 导出内部辅助函数**

在 `src/platforms/sources/youtube.ts` 中，给 `jsRuntimeArgs` 和 `execFileText` 函数定义前加 `export`（如果还没有）。先确认它们当前是否已 export：

Run: `grep -n "function jsRuntimeArgs\|function execFileText\|export.*jsRuntimeArgs\|export.*execFileText" src/platforms/sources/youtube.ts`

若未 export，把它们改成 `export function jsRuntimeArgs(...)` 和 `export async function execFileText(...)`。

- [ ] **Step 2: 创建 `src/platforms/sources/youtube-list.ts`**

```ts
import { resolveCommand } from "../../dependencies";
import { execFileText, jsRuntimeArgs } from "./youtube";
import type { ChannelVideoEntry, ProbeBatchOptions } from "../../discovery/types";
import type { SourceProbeResult } from "../types";
import { youtubeSourceAdapter } from "./youtube";

/**
 * 用 yt-dlp flat-playlist 模式列出频道所有视频。
 * 注意：flat-playlist 不一定返回 view_count / comment_count / upload_date，
 * 需要后续 probeBatch() 逐个 probe 才能拿到准确的评论数等。
 */
export async function listChannelVideos(
  channelUrl: string,
  signal?: AbortSignal,
): Promise<ChannelVideoEntry[]> {
  const stdout = await execFileText(
    resolveCommand("yt-dlp"),
    ["--flat-playlist", "-J", "--skip-download", ...jsRuntimeArgs(), channelUrl],
    { signal },
  );
  const raw = JSON.parse(stdout) as { entries?: Array<Record<string, unknown>> };
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const result: ChannelVideoEntry[] = [];
  for (const e of entries) {
    const id = typeof e.id === "string" ? e.id : undefined;
    if (!id) continue;
    // flat-playlist 里 url 有时是完整 URL，有时需要拼接
    const url = typeof e.url === "string" ? e.url : `https://www.youtube.com/watch?v=${id}`;
    result.push({
      videoId: id,
      url,
      title: typeof e.title === "string" ? e.title : "",
      durationSec: typeof e.duration === "number" ? e.duration : undefined,
      viewCount: typeof e.view_count === "number" ? e.view_count : undefined,
    });
  }
  return result;
}

/** 受控并发批量 probe，拿准确的 view_count / comment_count / upload_date。 */
export async function probeBatch(
  urls: string[],
  options?: ProbeBatchOptions,
): Promise<SourceProbeResult[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 3);
  const delayMs = Math.max(0, options?.delayMs ?? 500);
  const signal = options?.signal;
  const results: SourceProbeResult[] = [];
  let index = 0;

  async function worker() {
    while (index < urls.length) {
      if (signal?.aborted) return;
      const current = index++;
      const url = urls[current];
      try {
        const probed = await youtubeSourceAdapter.probe(url);
        results.push(probed);
      } catch (err) {
        // 单个失败不阻塞整体，跳过
        console.error(`[probeBatch] probe failed: ${url}`, err);
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 3: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误。若 `SourceProbeResult` 类型名不对，参考 `src/platforms/types.ts` 实际导出名修正。

- [ ] **Step 4: 冒烟测试 listChannelVideos（需要网络）**

创建临时测试脚本 `scripts/test-list-channel.ts`：

```ts
import { listChannelVideos } from "../src/platforms/sources/youtube-list";

(async () => {
  const url = process.argv[2] || "https://www.youtube.com/@carview_global";
  console.log(`Listing: ${url}`);
  const videos = await listChannelVideos(url);
  console.log(`Found ${videos.length} videos`);
  for (const v of videos.slice(0, 5)) {
    console.log(`  ${v.videoId} | ${v.title} | duration=${v.durationSec}s | views=${v.viewCount}`);
  }
})();
```

Run: `npx tsx scripts/test-list-channel.ts`
Expected: 打印频道视频数量和前 5 个视频标题。（若网络问题失败，换一个小频道重试；这是外部依赖验证。）

- [ ] **Step 5: 删除临时测试脚本，Commit**

```bash
rm scripts/test-list-channel.ts
git add src/platforms/sources/youtube.ts src/platforms/sources/youtube-list.ts
git commit -m "feat(discovery): 新增 listChannelVideos 和 probeBatch 抓取函数"
```

---

## Task 4: LLM 语义过滤（`src/discovery/llm-filter.ts`）

**Files:**
- Create: `src/discovery/llm-filter.ts`

- [ ] **Step 1: 创建 `src/discovery/llm-filter.ts`**

```ts
import { translateText } from "../translate/openai-compatible";
import type { DiscoveredVideo } from "./types";

/**
 * 让 LLM 按用户提示词对视频列表做语义过滤，返回保留的 videoId 列表。
 * 容错：若 LLM 返回非法 JSON 或调用失败，降级为「全部保留」（宁滥勿缺）。
 */
export async function llmFilterVideos(
  videos: DiscoveredVideo[],
  prompt: string,
  signal?: AbortSignal,
): Promise<{ kept: string[]; error?: string }> {
  if (!prompt.trim() || videos.length === 0) {
    return { kept: videos.map((v) => v.videoId) };
  }

  const lines = videos.map((v, i) => {
    const meta = [
      `views=${v.viewCount ?? "?"}`,
      `comments=${v.commentCount ?? "?"}`,
      `date=${v.publishedAt ?? "?"}`,
    ].join(" ");
    return `${i + 1}. [${v.videoId}] ${v.title}  (${meta})`;
  });
  const videoListText = lines.join("\n");

  const systemPrompt = `你是一个视频筛选助手。用户会给你一个筛选标准和一组带编号的视频（含 videoId、标题、观看数、评论数、发布日期）。
请严格按照筛选标准判断哪些视频符合，返回一个 JSON 数组，元素是符合的视频的 videoId 字符串。
只返回 JSON 数组，不要任何其他文字。例如：["abc123","def456"]

筛选标准：
${prompt}

待筛选视频：
${videoListText}`;

  try {
    const raw = await translateText({
      text: "请按上述标准筛选视频，返回 JSON 数组。",
      sourceLanguage: "auto",
      targetLanguage: "zh",
      systemPrompt,
    });
    // 尝试从返回文本里提取 JSON 数组
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      return { kept: videos.map((v) => v.videoId), error: "LLM 未返回 JSON 数组，已全部保留" };
    }
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) {
      return { kept: videos.map((v) => v.videoId), error: "LLM 返回非数组，已全部保留" };
    }
    const validIds = new Set(videos.map((v) => v.videoId));
    const kept = parsed.filter((id): id is string => typeof id === "string" && validIds.has(id));
    return { kept };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kept: videos.map((v) => v.videoId), error: `LLM 过滤失败：${msg}，已全部保留` };
  }
}
```

注意：`translateText` 的实际签名是 `TranslateRequest { text, sourceLanguage?, targetLanguage, systemPrompt?, ... }`，`sourceLanguage: "auto"` 是否被接受需在 Step 2 验证；若不接受则省略该字段。

- [ ] **Step 2: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误。若 `sourceLanguage` 字段不存在于 `TranslateRequest`，删掉该行。

- [ ] **Step 3: Commit**

```bash
git add src/discovery/llm-filter.ts
git commit -m "feat(discovery): 新增 LLM 语义过滤 llm-filter.ts"
```

---

## Task 5: 发现主流程编排（`src/discovery/discover.ts`）

**Files:**
- Create: `src/discovery/discover.ts`

- [ ] **Step 1: 创建 `src/discovery/discover.ts`**

```ts
import path from "path";
import { loadSettings } from "../settings";
import { createJobId, loadJob } from "../jobs/store";
import { listChannelVideos, probeBatch } from "../platforms/sources/youtube-list";
import { llmFilterVideos } from "./llm-filter";
import { emptyStats } from "./store";
import type {
  DiscoveredVideo,
  DiscoveryOptions,
  DiscoveryResult,
  ChannelVideoEntry,
} from "./types";

function daysSince(dateStr: string): number | undefined {
  // dateStr 格式可能是 yt-dlp 的 YYYYMMDD 或 ISO
  const normalized = dateStr.length === 8
    ? `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`
    : dateStr;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return undefined;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

export async function runDiscovery(options?: DiscoveryOptions): Promise<DiscoveryResult> {
  const settings = loadSettings();
  const cfg = settings.task.discovery;
  const stats = emptyStats();
  const errors: string[] = [];

  if (!cfg.channels.length || !cfg.targets.length) {
    return { stats, videos: [], errors };
  }

  // 1. 扫描所有频道
  const allEntries: ChannelVideoEntry[] = [];
  for (const channelUrl of cfg.channels) {
    try {
      const entries = await listChannelVideos(channelUrl, options?.signal);
      allEntries.push(...entries);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`频道抓取失败 ${channelUrl}: ${msg}`);
    }
  }
  // 按 videoId 去重
  const seen = new Set<string>();
  const unique: ChannelVideoEntry[] = [];
  for (const e of allEntries) {
    if (!seen.has(e.videoId)) {
      seen.add(e.videoId);
      unique.push(e);
    }
  }
  stats.scanned = unique.length;

  // 3. 硬过滤粗筛（只能用 flat-playlist 提供的 viewCount）
  const afterCoarse = unique.filter((e) => {
    if (e.viewCount !== undefined && e.viewCount < cfg.filters.minViews) return false;
    return true;
  });

  // 4. 去重（job 已存在即跳过）
  const newEntries = afterCoarse.filter((e) => {
    const jobId = createJobId("youtube", e.videoId);
    return !loadJob(jobId);
  });
  stats.hardFiltered = afterCoarse.length;
  stats.deduped = newEntries.length;

  // 5. 批量 probe 拿准确元数据
  const probes = await probeBatch(
    newEntries.map((e) => e.url),
    { concurrency: 3, delayMs: 500, signal: options?.signal },
  );

  // 6. 精确硬过滤
  const cfgMinViews = cfg.filters.minViews;
  const cfgMinComments = cfg.filters.minComments;
  const cfgMaxAgeDays = cfg.filters.maxAgeDays;
  const passed: DiscoveredVideo[] = [];
  for (const p of probes) {
    const raw = p.raw as Record<string, unknown> | undefined;
    const viewCount = typeof raw?.view_count === "number" ? raw.view_count : undefined;
    const commentCount = typeof raw?.comment_count === "number" ? raw.comment_count : undefined;
    const uploadDate = typeof raw?.upload_date === "string" ? raw.upload_date : undefined;
    const ageDays = uploadDate ? daysSince(uploadDate) : undefined;

    if (viewCount !== undefined && viewCount < cfgMinViews) continue;
    if (commentCount !== undefined && commentCount < cfgMinComments) continue;
    if (ageDays !== undefined && ageDays > cfgMaxAgeDays) continue;

    // 计算建议的 repeatTimes
    const duration = p.durationSec ?? 0;
    const repeatTimes =
      cfg.shortVideo.maxDurationSec > 0 && duration < cfg.shortVideo.maxDurationSec
        ? cfg.shortVideo.repeatTimes
        : 1;

    passed.push({
      videoId: p.contentId,
      url: p.url,
      title: p.title ?? "",
      durationSec: p.durationSec,
      viewCount,
      commentCount,
      publishedAt: uploadDate,
      repeatTimes,
    });
  }

  // 7. LLM 语义过滤
  let finalVideos = passed;
  if (cfg.llmPrompt.trim() && passed.length > 0) {
    const { kept, error } = await llmFilterVideos(passed, cfg.llmPrompt, options?.signal);
    if (error) errors.push(error);
    const keepSet = new Set(kept);
    finalVideos = passed.filter((v) => keepSet.has(v.videoId));
  }
  stats.llmFiltered = finalVideos.length;

  return { stats, videos: finalVideos, errors };
}
```

- [ ] **Step 2: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误。注意 `p.raw` 的类型——`SourceProbeResult.raw` 可能是具体类型，按实际调整取值。

- [ ] **Step 3: Commit**

```bash
git add src/discovery/discover.ts
git commit -m "feat(discovery): 新增发现主流程 runDiscovery 编排"
```

---

## Task 6: 定时调度（`src/discovery/scheduler.ts`）

**Files:**
- Create: `src/discovery/scheduler.ts`

- [ ] **Step 1: 创建 `src/discovery/scheduler.ts`**

```ts
import { loadSettings } from "../settings";

let timer: NodeJS.Timeout | null = null;

/** 计算到下一个 scheduleHour 的毫秒数 */
function msUntilNextRun(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    // 今天该时刻已过，排到明天
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startDiscoveryScheduler(runFn: () => Promise<void>): void {
  stopDiscoveryScheduler();
  const schedule = () => {
    const cfg = loadSettings().task.discovery;
    const delay = msUntilNextRun(cfg.scheduleHour);
    timer = setTimeout(async () => {
      if (!loadSettings().task.discovery.enabled) {
        schedule(); // 未启用，跳过本次，继续排下次
        return;
      }
      try {
        await runFn();
      } catch (err) {
        console.error("[discovery] scheduled run failed", err);
      }
      schedule(); // 重新排下次
    }, delay);
  };
  schedule();
}

export function stopDiscoveryScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
```

注意：`runFn` 由 `server.ts` 注入（封装了 job 创建逻辑），避免 scheduler 直接依赖 server.ts 内部函数。

- [ ] **Step 2: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/discovery/scheduler.ts
git commit -m "feat(discovery): 新增定时调度 scheduler.ts"
```

---

## Task 7: API 路由 + 启动调度器（`src/server.ts`）

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: 在 server.ts 顶部 import 发现模块**

在 `src/server.ts` 现有 import 区域加：

```ts
import { runDiscovery } from "./discovery/discover";
import { startDiscoveryScheduler } from "./discovery/scheduler";
import {
  loadDiscoveryRecord,
  saveDiscoveryRecord,
  markRunning,
  emptyStats,
} from "./discovery/store";
import type { DiscoveryRunRecord } from "./discovery/types";
```

- [ ] **Step 2: 加重入锁 + job 创建编排函数**

在 `src/server.ts` 中（在路由定义前，比如 `enqueueJobRun` 函数附近）加：

```ts
// 发现功能：重入锁，防止定时触发与手动触发撞车
let discoveryRunning = false;

/**
 * 执行发现流程并创建 job。被定时调度器和手动触发 API 共用。
 * 写入 discovery.json 运行记录。
 */
async function executeDiscoveryRun(): Promise<void> {
  if (discoveryRunning) {
    console.log("[discovery] already running, skip");
    return;
  }
  discoveryRunning = true;
  markRunning();
  const errors: string[] = [];
  const createdJobIds: string[] = [];
  try {
    const result = await runDiscovery();
    errors.push(...result.errors);
    const cfg = loadSettings().task.discovery;
    // 创建 job（路由层负责，复用 createJobFromRequest + enqueueJobRun）
    for (const video of result.videos) {
      try {
        const { job } = await createJobFromRequest({
          source: { url: video.url, platform: "youtube" },
          options: { publishAction: "publish", repeatTimes: video.repeatTimes },
          targets: cfg.targets.map((platform) => ({ platform })),
        });
        enqueueJobRun(job.id);
        createdJobIds.push(job.id);
      } catch (err) {
        if (err instanceof Error && err.name === "JobConflict") {
          // 并发去重冲突，跳过
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`创建任务失败 ${video.url}: ${msg}`);
      }
    }
    const record: DiscoveryRunRecord = {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "success",
      stats: { ...result.stats, created: createdJobIds.length },
      createdJobIds,
      errors,
    };
    saveDiscoveryRecord(record);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`发现流程异常: ${msg}`);
    saveDiscoveryRecord({
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "failed",
      stats: emptyStats(),
      createdJobIds,
      errors,
    });
  } finally {
    discoveryRunning = false;
  }
}
```

- [ ] **Step 3: 加 API 路由**

在 `src/server.ts` 现有路由区域（其他 `app.get`/`app.post` 附近）加：

```ts
// 发现：手动触发
app.post("/api/discovery/run", async (req, res) => {
  if (discoveryRunning) {
    return res.status(409).json({ success: false, error: "发现任务正在运行中" });
  }
  // 异步执行，立即返回
  void executeDiscoveryRun();
  res.json({ success: true, message: "发现任务已启动" });
});

// 发现：查询运行状态
app.get("/api/discovery/status", (req, res) => {
  const record = loadDiscoveryRecord();
  res.json({ success: true, record });
});
```

- [ ] **Step 4: 在 `app.listen` 回调里启动调度器**

在 `src/server.ts` 的 `app.listen(PORT, () => { ... })` 回调里，`recoverInterruptedJobRuns();` 之后加：

```ts
  startDiscoveryScheduler(executeDiscoveryRun);
```

- [ ] **Step 5: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误。若 `createJobFromRequest` 返回值不含 `job` 字段，按实际返回结构调整（参考 `server.ts:1145` 它返回 `{ job, probe }`）。

- [ ] **Step 6: 编译并启动服务，手动验证 API**

Run: `npm run build && node dist/server.js &`

在另一个终端配置发现（用 curl 先 PUT settings，设置一个频道）：

```bash
# 设置发现配置（示例）
curl -X PUT http://localhost:6688/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "task": {
      "discovery": {
        "enabled": true,
        "channels": ["https://www.youtube.com/@carview_global"],
        "filters": {"minViews": 100, "minComments": 1, "maxAgeDays": 365},
        "llmPrompt": "",
        "targets": ["bilibili"],
        "shortVideo": {"maxDurationSec": 60, "repeatTimes": 3},
        "scheduleHour": 1
      }
    }
  }'

# 手动触发发现
curl -X POST http://localhost:6688/api/discovery/run

# 等几秒后查状态
sleep 10
curl http://localhost:6688/api/discovery/status
```

Expected: `/api/discovery/run` 返回 `{success:true}`；`/api/discovery/status` 返回 stats（scanned > 0）。

验证后停掉服务：`kill %1`

- [ ] **Step 7: Commit**

```bash
git add src/server.ts
git commit -m "feat(discovery): 新增发现 API 路由与定时调度启动"
```

---

## Task 8: Dashboard UI —— 侧边栏项与配置表单

**Files:**
- Modify: `dashboard/src/app/(main)/dashboard/_components/revideo-console.tsx`

- [ ] **Step 1: 加 Compass 图标 import**

在 `revideo-console.tsx` 顶部的 lucide-react import 里加 `Compass`（若已有图标 import 块）。

- [ ] **Step 2: 在 `settingsGroups` 加「发现」侧边栏项**

找到 `settingsGroups` 数组（约 line 1021-1040），在「任务流程」组里，`render` 项之后、`publish` 项之前加：

```ts
        { id: "discovery", label: "发现", icon: Compass },
```

- [ ] **Step 3: 加「发现」Pane**

在现有 `<SettingsPane active={activeSettings} id="download">...</SettingsPane>` 之后，加新的 Pane：

```tsx
<SettingsPane active={activeSettings} id="discovery">
  <div className="space-y-4">
    <SettingsSection title="总开关" description="启用后每天定时扫描频道并自动创建任务">
      <SwitchRow
        label="启用发现"
        name="task.discovery.enabled"
        defaultChecked={getNested(settings, "task.discovery.enabled", false)}
      />
    </SettingsSection>

    <SettingsSection title="监控频道" description="每行一个 YouTuber 频道链接，如 https://www.youtube.com/@carview_global">
      <FieldControl label="频道链接列表">
        <Textarea
          name="task.discovery.channels"
          defaultValue={(getNested(settings, "task.discovery.channels", []) as string[]).join("\n")}
          placeholder={"https://www.youtube.com/@carview_global\nhttps://www.youtube.com/@another_channel"}
          className="min-h-[120px] font-mono text-sm"
          onChange={scheduleSave}
        />
      </FieldControl>
    </SettingsSection>

    <SettingsSection title="硬性过滤" description="不满足条件的视频直接丢弃">
      <LabelInput
        label="最小观看次数"
        help="观看数小于此值的视频丢弃"
        name="task.discovery.filters.minViews"
        type="number"
        min={0}
        defaultValue={getNested(settings, "task.discovery.filters.minViews", 1000)}
        className="w-28"
      />
      <LabelInput
        label="最小评论数量"
        help="评论数小于此值的视频丢弃"
        name="task.discovery.filters.minComments"
        type="number"
        min={0}
        defaultValue={getNested(settings, "task.discovery.filters.minComments", 10)}
        className="w-28"
      />
      <LabelInput
        label="最大发布天数"
        help="如填 7，则距离今天超过 7 天的视频丢弃"
        name="task.discovery.filters.maxAgeDays"
        type="number"
        min={1}
        defaultValue={getNested(settings, "task.discovery.filters.maxAgeDays", 30)}
        className="w-28"
      />
    </SettingsSection>

    <SettingsSection title="语义过滤" description="让 LLM 根据提示词对过滤后的视频再做一轮语义筛选">
      <PromptField
        label="发现提示词"
        help="描述你想要什么样的视频，LLM 会据此保留符合条件的"
        name="task.discovery.llmPrompt"
        defaultValue={getNested(settings, "task.discovery.llmPrompt", "")}
      />
    </SettingsSection>

    <SettingsSection title="渲染参数" description="短视频（短于阈值）按重复渲染次数创建任务">
      <LabelInput
        label="重复渲染时长阈值（秒）"
        help="视频时长小于此值时启用重复渲染"
        name="task.discovery.shortVideo.maxDurationSec"
        type="number"
        min={0}
        defaultValue={getNested(settings, "task.discovery.shortVideo.maxDurationSec", 60)}
        className="w-28"
      />
      <LabelInput
        label="重复渲染次数"
        help="短视频的重复渲染次数"
        name="task.discovery.shortVideo.repeatTimes"
        type="number"
        min={1}
        max={10}
        defaultValue={getNested(settings, "task.discovery.shortVideo.repeatTimes", 3)}
        className="w-28"
      />
    </SettingsSection>

    <SettingsSection title="定时" description="每天在指定时间自动执行一次">
      <LabelInput
        label="每日执行时间（小时）"
        help="0-23，如 1 表示凌晨 1 点"
        name="task.discovery.scheduleHour"
        type="number"
        min={0}
        max={23}
        defaultValue={getNested(settings, "task.discovery.scheduleHour", 1)}
        className="w-28"
      />
    </SettingsSection>

    {/* 目标平台多选 + 手动触发按钮 + 运行状态 见 Task 9 */}
  </div>
</SettingsPane>
```

注意：`SettingsSection` / `SwitchRow` / `FieldControl` / `PromptField` / `LabelInput` 这些 helper 组件都在该文件内定义（见 spec 7.2）。`Textarea` 从 shadcn import。

- [ ] **Step 4: 验证类型检查通过**

Run: `cd dashboard && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/app/\(main\)/dashboard/_components/revideo-console.tsx
git commit -m "feat(discovery): 新增发现设置 Pane（配置表单）"
```

---

## Task 9: Dashboard UI —— 目标平台多选、手动触发、运行状态

**Files:**
- Modify: `dashboard/.../revideo-console.tsx`（继续 Task 8 的 Pane）

- [ ] **Step 1: 在发现 Pane 加目标平台多选**

参考现有「发布」设置里 `defaultPlatforms` 多选组件的写法（在文件里搜索 `defaultPlatforms` 找到实现），复制一份改为 `name="task.discovery.targets"`。若现有发布设置用的是一组 checkbox，则复用同样模式：

```tsx
<SettingsSection title="目标平台" description="发现的新视频自动发布到这些平台">
  {/* 参考现有 publish pane 里 defaultPlatforms 的多选实现，name 改为 task.discovery.targets */}
  <div className="flex gap-4">
    {(["bilibili", "douyin", "youtube", "tiktok"] as const).map((p) => (
      <label key={p} className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="task.discovery.targets"
          value={p}
          defaultChecked={(getNested(settings, "task.discovery.targets", []) as string[]).includes(p)}
          onChange={scheduleSave}
        />
        {p}
      </label>
    ))}
  </div>
</SettingsSection>
```

- [ ] **Step 2: 加手动触发按钮**

在发现 Pane 底部加：

```tsx
<div className="flex items-center gap-3">
  <button
    type="button"
    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    disabled={discoveryStatus?.lastRunStatus === "running"}
    onClick={async () => {
      try {
        const res = await fetch("/api/discovery/run", { method: "POST" });
        if (res.status === 409) {
          toast.error("发现任务正在运行中");
          return;
        }
        toast.success("发现任务已启动");
        // 开始轮询状态
        refreshDiscoveryStatus();
      } catch (e) {
        toast.error("触发失败");
      }
    }}
  >
    立即执行
  </button>
</div>
```

- [ ] **Step 3: 加运行状态展示**

需要新增 state 和轮询。在组件内（其他 useState 附近）加：

```tsx
const [discoveryStatus, setDiscoveryStatus] = useState<{ record: DiscoveryRunRecord | null } | null>(null);

const refreshDiscoveryStatus = useCallback(async () => {
  try {
    const res = await fetch("/api/discovery/status");
    const data = await res.json();
    setDiscoveryStatus(data);
  } catch {}
}, []);

// 在 mount 和刷新时调用（在现有 refresh() 函数里加，或用 useEffect）
useEffect(() => {
  refreshDiscoveryStatus();
  const id = setInterval(refreshDiscoveryStatus, 5000);
  return () => clearInterval(id);
}, [refreshDiscoveryStatus]);
```

在发现 Pane 底部展示状态：

```tsx
{discoveryStatus?.record && (
  <SettingsSection title="最近运行" description={`时间：${new Date(discoveryStatus.record.lastRunAt).toLocaleString()}`}>
    <div className="space-y-2 text-sm">
      <div>状态：
        <span className={
          discoveryStatus.record.lastRunStatus === "success" ? "text-green-600" :
          discoveryStatus.record.lastRunStatus === "running" ? "text-blue-600" :
          "text-red-600"
        }>
          {discoveryStatus.record.lastRunStatus === "success" ? "成功" :
           discoveryStatus.record.lastRunStatus === "running" ? "运行中" : "失败"}
        </span>
      </div>
      <div>扫描 {discoveryStatus.record.stats.scanned} → 硬过滤 {discoveryStatus.record.stats.hardFiltered} → 去重 {discoveryStatus.record.stats.deduped} → LLM 过滤 {discoveryStatus.record.stats.llmFiltered} → 创建 {discoveryStatus.record.stats.created}</div>
      {discoveryStatus.record.createdJobIds.length > 0 && (
        <div>创建的任务：{discoveryStatus.record.createdJobIds.join(", ")}</div>
      )}
      {discoveryStatus.record.errors.length > 0 && (
        <div className="text-red-600">错误：{discoveryStatus.record.errors.join("; ")}</div>
      )}
    </div>
  </SettingsSection>
)}
```

并在文件顶部内联定义一个精简类型（dashboard 是独立 Next 项目，无法直接 import 后端 src/）：

```ts
type DiscoveryRunStatus = "success" | "running" | "failed";
interface DiscoveryRunRecord {
  lastRunAt: string;
  lastRunStatus: DiscoveryRunStatus;
  stats: { scanned: number; hardFiltered: number; deduped: number; llmFiltered: number; created: number };
  createdJobIds: string[];
  errors: string[];
}
```

- [ ] **Step 4: 处理 channels/targets 数组字段的提交**

在 `persistSettings` 函数的 `parseFieldValue` 里加 `channels` 数组处理。找到处理 FormData 的逻辑，增加：

- `task.discovery.channels`：从 Textarea 的多行文本按 `\n` 拆分，过滤空行，转 string[]。
- `task.discovery.targets`：收集所有勾选的 checkbox value。

参考现有 `styleConstraints`（line 386 附近）和 `agent.channels` 的数组处理分支写。

- [ ] **Step 5: 验证类型检查通过**

Run: `cd dashboard && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 手动验证 UI**

Run: `bash scripts/dev.sh`（启动 dashboard dev server）

浏览器打开 http://localhost:3000 → 设置 → 「发现」侧边栏项：
- 验证所有字段渲染正常
- 改一个字段，确认 700ms 后 toast「已保存」
- 点「立即执行」，确认状态变为「运行中」再变「成功/失败」

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/app/\(main\)/dashboard/_components/revideo-console.tsx
git commit -m "feat(discovery): 发现 Pane 加目标平台/手动触发/运行状态展示"
```

---

## Task 10: 冒烟测试脚本 + package.json

**Files:**
- Create: `scripts/discovery-smoke-test.ts`
- Modify: `package.json`

- [ ] **Step 1: 创建 `scripts/discovery-smoke-test.ts`**

```ts
import { runDiscovery } from "../src/discovery/discover";

(async () => {
  console.log("Running discovery smoke test...");
  const result = await runDiscovery();
  console.log("Stats:", result.stats);
  console.log(`Found ${result.videos.length} new videos`);
  for (const v of result.videos.slice(0, 10)) {
    console.log(`  ${v.videoId} | ${v.title} | dur=${v.durationSec}s repeat=${v.repeatTimes}`);
  }
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const e of result.errors) console.log(`  ${e}`);
  }
  console.log("Done.");
})();
```

注意：此脚本依赖 settings 里已配置 channels/targets，否则返回空。运行前先用 curl 配置，或临时改 settings.json。

- [ ] **Step 2: 在 package.json 加 script**

```json
"test:discovery": "tsx scripts/discovery-smoke-test.ts"
```

- [ ] **Step 3: 验证**

Run: `npx tsx scripts/discovery-smoke-test.ts`
Expected: 打印 stats（即便 videos 为 0 也算通过，只要不抛异常）。

- [ ] **Step 4: Commit**

```bash
git add scripts/discovery-smoke-test.ts package.json
git commit -m "test(discovery): 新增发现流程冒烟测试脚本"
```

---

## Task 11: 全流程集成验证

- [ ] **Step 1: 完整跑一遍后端流程**

```bash
npm run build && node dist/server.js &
```

配置一个真实频道（用 curl，参考 Task 7 Step 6），设置较低的过滤阈值确保能筛出视频。

```bash
curl -X POST http://localhost:6688/api/discovery/run
sleep 30  # 等待发现跑完
curl http://localhost:6688/api/discovery/status | python3 -m json.tool
```

验证 stats.created > 0，且 `GET /api/jobs` 能看到新创建的 job。

- [ ] **Step 2: 验证定时调度器已启动**

看服务启动日志，确认无报错。调度器静默启动（不打印），可通过修改 `scheduleHour` 为当前小时 + 几分钟后重启验证（可选）。

- [ ] **Step 3: 验证去重**

再次触发发现，确认 `stats.created === 0`（因为上次创建的 job 还在，去重生效）。

- [ ] **Step 4: 最终 commit（若有遗漏改动）**

```bash
git add -A
git status  # 确认无遗漏
```

---

## 自审清单（实现时对照）

- [ ] spec 2.1 配置字段全部实现（settings.ts）
- [ ] spec 2.2 discovery.json 读写（store.ts）
- [ ] spec 3.1 listChannelVideos
- [ ] spec 3.2 probeBatch
- [ ] spec 3.3 runDiscovery 步骤 1-10
- [ ] spec 4 LLM 过滤 + 容错
- [ ] spec 5 定时调度 + 重入锁
- [ ] spec 6 两个 API 路由
- [ ] spec 7 侧边栏项 + Pane + 手动触发 + 状态展示
- [ ] spec 9 风险对策（并发 3 + 间隔 500ms + LLM 降级）
