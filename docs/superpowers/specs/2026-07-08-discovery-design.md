# Discovery（发现）功能设计

> 日期：2026-07-08
> 状态：已设计，待实现

## 一、功能概述

用户在 Dashboard 设置页配置一组 YouTuber 频道链接 + 过滤规则 + LLM 语义提示词 + 渲染参数 + 目标平台。系统每天凌晨 1 点自动执行（也可手动触发）一次「发现」流程：

```
扫描频道全部视频/shorts
  → 硬性过滤（观看数 / 评论数 / 发布时间）
  → 去重（job 已存在即跳过，不分状态）
  → LLM 语义过滤（按用户提示词判断标题 + 元数据）
  → 对符合条件的新视频创建任务（短视频按重复渲染参数填 repeatTimes）
  → 自动完整发布到用户配置的目标平台
```

### 已确认的需求决策

| 决策点 | 结论 |
|---|---|
| 发布动作 | 自动完整发布（`publishAction: "publish"`） |
| 目标平台 | 用户在发现设置里配置（多选 `targets`） |
| 「重复渲染次数」含义 | 即 `JobOptions.repeatTimes`；视频时长 < 阈值时填入发现设置的重复次数 |
| 元数据获取 | 分阶段：flat-playlist 拿列表 → 硬过滤 → 剩余的 probe 拿评论数 |
| LLM 过滤输入 | 视频**标题 + 已有元数据**（观看数/评论数/发布时间） |
| 去重范围 | 任何状态的 job 都算已存在 |
| 手动触发 | 设置页「发现」区块提供「立即执行」按钮 |
| UI 位置 | 设置页左侧导航独立侧边栏项「发现」 |
| 定时 | 每天凌晨 1 点（用户可在设置里改 `scheduleHour`） |

## 二、数据模型与配置

### 2.1 settings 扩展（`src/settings.ts`）

在 `RevideoSettings.task` 下新增 `discovery` 分组，与 `download` / `render` 等同级：

```ts
task.discovery: {
  enabled: boolean;              // 总开关，默认 false（避免一启用就跑）
  channels: string[];            // YouTuber 频道链接列表
  filters: {
    minViews: number;            // 最小观看次数，默认 1000
    minComments: number;         // 最小评论数量，默认 10
    maxAgeDays: number;          // 最大发布时间天数间隔，默认 30
  };
  llmPrompt: string;             // 发现提示词（语义过滤），默认空串
  targets: TargetPlatform[];     // 发布目标平台，默认 []
  shortVideo: {
    maxDurationSec: number;      // 启动重复渲染的最短时长阈值（秒），默认 60
    repeatTimes: number;         // 短视频的重复渲染次数，默认 3
  };
  scheduleHour: number;          // 每天执行的小时（0-23），默认 1（凌晨1点）
};
```

`defaultSettings` 对应默认值。`deepMerge` 会自动给老用户补齐这些字段，无需迁移。

### 2.2 发现运行历史（`~/.revideo-server/data/discovery.json`）

独立持久化文件，记录最近一次运行结果，供 UI 展示状态与供重启后恢复。结构：

```ts
interface DiscoveryRunRecord {
  lastRunAt: string;             // ISO 时间戳
  lastRunStatus: "success" | "running" | "failed";
  stats: {
    scanned: number;             // 扫描到的视频总数
    hardFiltered: number;        // 硬过滤后剩余
    deduped: number;             // 去重后剩余（即新增）
    llmFiltered: number;         // LLM 过滤后剩余
    created: number;             // 最终创建的任务数
  };
  createdJobIds: string[];
  errors: string[];
}
```

新增模块 `src/discovery/store.ts` 负责读写该文件（`loadDiscoveryRecord()` / `saveDiscoveryRecord()`），路径解析复用 `src/config.ts` 的 `DATA_DIR`。

## 三、核心抓取与过滤

### 3.1 频道视频列表抓取（`src/platforms/sources/youtube.ts` 新增）

新增导出函数 `listChannelVideos(channelUrl, signal?)`，使用 yt-dlp flat-playlist 模式：

```ts
export interface ChannelVideoEntry {
  videoId: string;
  url: string;
  title: string;
  durationSec?: number;
  viewCount?: number;            // flat-playlist 可能返回，不一定准确
}

export async function listChannelVideos(
  channelUrl: string,
  signal?: AbortSignal,
): Promise<ChannelVideoEntry[]>;
```

实现：`yt-dlp --flat-playlist -J --skip-download ...jsRuntimeArgs() <channelUrl>`，解析返回 JSON 的 `entries[]`。

### 3.2 批量 probe（`src/platforms/sources/youtube.ts` 新增）

新增 `probeBatch(urls, options)`，受控并发调用现有 `probe()`：

```ts
export interface ProbeBatchOptions {
  concurrency?: number;          // 默认 3
  delayMs?: number;              // 每个之间的间隔，默认 500ms
  signal?: AbortSignal;
}

export async function probeBatch(
  urls: string[],
  options?: ProbeBatchOptions,
): Promise<SourceProbeResult[]>;
```

实现：简单的并发池（Promise 池），复用现有 `probe()` 和 `jsRuntimeArgs()`。返回包含准确的 `view_count` / `comment_count` / `upload_date`。

### 3.3 发现主流程（`src/discovery/discover.ts`）

核心编排函数 `runDiscovery(options)`：

```ts
export interface DiscoveryOptions {
  manual?: boolean;              // 是否手动触发（影响日志/事件）
  signal?: AbortSignal;
}

export interface DiscoveredVideo {
  videoId: string;
  url: string;
  title: string;
  durationSec?: number;
  viewCount?: number;
  commentCount?: number;
  publishedAt?: string;         // ISO 日期
  repeatTimes: number;          // 路由层创建 job 时填入 JobOptions.repeatTimes
}

export interface DiscoveryResult {
  stats: DiscoveryRunRecord["stats"];
  videos: DiscoveredVideo[];    // 过滤后待创建的视频列表（路由层据此创建 job）
  errors: string[];
}

export async function runDiscovery(options?: DiscoveryOptions): Promise<DiscoveryResult>;
```

**执行步骤**：

1. **读取配置**：`loadSettings().task.discovery`；若 `channels` 为空或 `targets` 为空，直接返回空结果。
2. **扫描频道**：对每个 `channelUrl` 调 `listChannelVideos()`，合并所有 `ChannelVideoEntry`（按 videoId 去重）。
3. **硬过滤（基于 flat-playlist 数据）**：用 `maxAgeDays` 和 `minViews`（若 flat-playlist 返回了 viewCount）先粗筛一轮，减少后续 probe 数量。
   - 发布时间：flat-playlist 通常不返回，此条件在 probe 后再判断。
   - 此阶段主要剔除明显不合格的，减少 probe 调用。
4. **去重**：对每个 videoId 构造 `createJobId("youtube", videoId)`，调 `loadJob(jobId)`；存在则跳过（不分状态）。
5. **批量 probe**：对去重后剩余的视频调 `probeBatch()`，拿到准确的 view_count / comment_count / upload_date / duration。
6. **硬过滤（精确）**：用 probe 拿到的准确数据再过一遍 `minViews` / `minComments` / `maxAgeDays`。
7. **LLM 语义过滤**：若 `llmPrompt` 非空，把剩余视频的 `{ title, viewCount, commentCount, publishedAt }` 打包，调 `translateText()` 让 LLM 按提示词返回保留的 videoId 列表。
8. **返回待创建列表**：`runDiscovery()` **只负责扫描+过滤**，返回最终的 `DiscoveredVideo[]`（含 videoId、url、title、durationSec、元数据、建议的 repeatTimes）。**不**在 discovery 模块内创建 job——因为 `createJobFromRequest()` / `enqueueJobRun()` 是 `server.ts` 的内部函数（未导出），导出它们会污染核心模块边界。
9. **创建任务（在 server.ts 路由层）**：`POST /api/discovery/run` 的处理函数拿到 `runDiscovery()` 返回的视频列表后，在 server.ts 内部遍历调 `createJobFromRequest({ source: { url, platform: "youtube" }, options: { publishAction: "publish", repeatTimes }, targets })`（`force: false`，再次去重防并发）+ `enqueueJobRun(jobId, ...)`。repeatTimes 按视频时长判断（< `maxDurationSec` 则填 `shortVideo.repeatTimes`，否则用默认 1）。
10. **记录结果**：路由层把创建结果写入 `discovery.json`，返回给前端。

### 3.4 关于 `createJobFromRequest` 的重复 probe

步骤 5 的 `probeBatch()` 是**过滤阶段必需的**（拿评论数做硬过滤、拿标题给 LLM），无法省略。而 `createJobFromRequest()` 内部会**再调一次** `adapter.probe(url)`（`server.ts:1080`），所以最终通过过滤的视频会被 probe 两次。

权衡后**接受这个重复**：通过 LLM 过滤后创建任务的视频数量通常很少（个位数到几十），多一轮 probe 成本可控；新增「跳过 probe」路径要改动核心 job 创建逻辑，风险大于收益。

## 四、LLM 语义过滤（`src/discovery/llm-filter.ts`）

### 4.1 调用现有 LLM

复用 `src/translate/openai-compatible.ts` 的 `translateText()`。该函数读取 settings 里的 LLM 配置（URL/Key/Model），发送 chat completion 请求。

### 4.2 过滤流程

```ts
export async function llmFilterVideos(
  videos: Array<{ videoId: string; title: string; viewCount?: number; commentCount?: number; publishedAt?: string }>,
  prompt: string,
  signal?: AbortSignal,
): Promise<string[]>;  // 返回保留的 videoId 列表
```

**实现**：
- 把视频列表格式化为文本（编号 + 标题 + 元数据）。
- 构造 system prompt：用户给的 `llmPrompt` 作为筛选标准，要求 LLM 返回 JSON 数组 `["videoId1", "videoId2", ...]` 表示保留的视频。
- 调 `translateText({ messages, ... })`，解析返回的 JSON。
- **容错**：若 LLM 返回非法 JSON 或全部失败，降级为「全部保留」（宁滥勿缺，避免 LLM 抖动导致漏掉视频）。记录到 errors。

## 五、定时调度（`src/discovery/scheduler.ts`）

### 5.1 调度机制

由于项目无现有定时框架，采用 `setTimeout` 计算到下次执行时间的延迟 + 执行后重新调度（`app.listen` 回调里启动，参考 `recoverInterruptedJobRuns()` 的启动模式）。

```ts
export function startDiscoveryScheduler(): void;
export function stopDiscoveryScheduler(): void;
```

**实现**：
- `startDiscoveryScheduler()` 在 `server.ts` 的 `app.listen` 回调里调用。
- 计算到下一个 `scheduleHour`（默认 1 点）的毫秒数，`setTimeout` 注册。
- 到点执行 `runDiscovery()`，结束后重新计算下次时间并 `setTimeout`（循环）。
- 每次调度前重新读 `loadSettings().task.discovery.scheduleHour`，让用户改配置即时生效。

### 5.2 并发控制

用模块级 `let discoveryRunning = false` 防止重入（手动触发 + 定时触发可能撞车）。若正在运行，手动触发返回 409。

### 5.3 进程退出

调度器不持久化（重启后由 `startDiscoveryScheduler` 重新计算下次时间）。运行中的发现流程不可中断（进程重启会丢失，下次定时再跑）。

## 六、API 接口（`src/server.ts` 新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/discovery/run` | 手动触发发现。返回 `{ runId }` 后异步执行。若正在运行返回 409。 |
| `GET` | `/api/discovery/status` | 获取 `discovery.json` 的最新运行记录（状态、stats、createdJobIds、errors）。 |

**MCP 工具**（可选，后续再加）：暂不在本期实现。

## 七、Dashboard UI（`dashboard/.../revideo-console.tsx`）

### 7.1 侧边栏项

在 `settingsGroups`（line 1021-1040）的「任务流程」组新增：
```ts
{ id: "discovery", label: "发现", icon: Compass }  // 从 lucide-react 导入 Compass
```

### 7.2 「发现」Pane 内容

新增 `<SettingsPane active={activeSettings} id="discovery">`，包含以下表单区块（沿用现有 helper 组件 `LabelInput` / `SwitchRow` / `FieldControl` / `SettingsSection`）：

1. **总开关**：`SwitchRow`，`name="task.discovery.enabled"`
2. **频道列表**：`Textarea`（多行，每行一个链接），`name="task.discovery.channels"`（提交时按换行拆分数组——需要在 `parseFieldValue` 加一个数组处理分支）
3. **过滤条件**（一个 bordered card）：
   - `LabelInput` 最小观看次数 `task.discovery.filters.minViews`（number）
   - `LabelInput` 最小评论数量 `task.discovery.filters.minComments`（number）
   - `LabelInput` 最大发布时间天数间隔 `task.discovery.filters.maxAgeDays`（number）
4. **发现提示词**：`PromptField`（Textarea），`name="task.discovery.llmPrompt"`
5. **渲染参数**（一个 bordered card）：
   - `LabelInput` 启动重复渲染的最短时长（秒）`task.discovery.shortVideo.maxDurationSec`
   - `LabelInput` 重复渲染次数 `task.discovery.shortVideo.repeatTimes`
6. **目标平台**：复用现有发布设置里的多选组件（`targets` 多选），`name="task.discovery.targets"`
7. **定时**：`LabelInput` 每日执行时间（小时 0-23）`task.discovery.scheduleHour`
8. **手动触发**：一个「立即执行」按钮，`POST /api/discovery/run`，触发后轮询 `/api/discovery/status` 显示运行状态和结果统计。

### 7.3 运行状态展示

Pane 底部展示最近一次运行记录（从 `GET /api/discovery/status` 拉取）：
- 状态徽章（运行中 / 成功 / 失败）
- 统计数字（扫描数 → 硬过滤 → 去重 → LLM 过滤 → 创建）
- 创建的 jobId 列表（可点击跳转到 jobs）
- 错误信息（若有）

### 7.4 数组字段处理

`channels`（string[]）和 `targets`（TargetPlatform[]）需要在 `persistSettings` 的 `parseFieldValue` 增加数组处理：
- `channels`：从 Textarea 按行拆分，过滤空行。
- `targets`：复用现有 `agent.channels` 或 `publish.defaultPlatforms` 的多选/序列化逻辑。

## 八、文件清单

### 新增文件
| 文件 | 职责 |
|---|---|
| `src/discovery/discover.ts` | 发现主流程编排 `runDiscovery()` |
| `src/discovery/scheduler.ts` | 定时调度 `startDiscoveryScheduler()` |
| `src/discovery/llm-filter.ts` | LLM 语义过滤 `llmFilterVideos()` |
| `src/discovery/store.ts` | 读写 `discovery.json` 运行记录 |
| `src/discovery/types.ts` | 发现相关 TS 类型（`DiscoveryOptions` / `DiscoveryResult` / `DiscoveryRunRecord` 等） |

### 修改文件
| 文件 | 改动 |
|---|---|
| `src/settings.ts` | `RevideoSettings.task.discovery` 类型 + `defaultSettings` 默认值 |
| `src/platforms/sources/youtube.ts` | 新增 `listChannelVideos()` + `probeBatch()` |
| `src/server.ts` | 新增 `/api/discovery/run` + `/api/discovery/status` 路由；`app.listen` 回调调 `startDiscoveryScheduler()` |
| `dashboard/.../revideo-console.tsx` | 新增「发现」侧边栏项 + Pane + 手动触发 + 状态展示 + 数组字段处理 |

### 不动的部分
- `src/jobs/*`：完全复用现有 job 创建/调度逻辑，不改。
- `src/config.ts`：复用 `DATA_DIR`，不加新配置。
- 现有翻译模块：复用 `translateText()`，不改。

## 九、风险与对策

| 风险 | 对策 |
|---|---|
| YouTube 429 限流（频道多/视频多时） | `probeBatch` 并发默认 3 + 间隔 500ms；flat-playlist 先粗筛减少 probe 量；复用现有 429 重试逻辑 |
| LLM 返回非法 JSON | 降级为「全部保留」，记录到 errors |
| `createJobFromRequest` 重复 probe | 已评估：LLM 过滤后创建数通常很少，可接受；不改核心逻辑 |
| 定时不准（系统休眠/进程重启） | 重启时 `startDiscoveryScheduler` 重新计算下次时间；笔记本休眠导致的错过的执行不补跑（YAGNI） |
| 频道链接格式多样（/@user、/channel/UC...、/user/...） | yt-dlp flat-playlist 对 YouTube 频道 URL 兼容性好，不做额外解析 |

## 十、不做的事（YAGNI）

- 不做「补跑错过的定时」（进程重启或休眠错过的执行不补偿）。
- 不做 MCP 工具（`submit_discovery` 等，后续按需再加）。
- 不做发现历史的多版本记录（只存最近一次）。
- 不做每频道的独立配置（所有频道共享一套过滤规则）。
- 不做 shorts 与普通视频的区分处理（yt-dlp flat-playlist 一并返回，统一过滤）。
