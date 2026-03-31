# 设置页 UI 契约与功能审计

审计日期：2026-06-07

本轮审计规则调整为：**一切以当前设置页 UI 为准**。设置页不展示的字段不再保留在 `RevideoSettings` 类型和 `defaultSettings` 中；业务仍需要的默认行为改为对应模块里的固定常量或普通 fallback。

范围约定：
- 不审计 `agent.*` 的真实功能，只检查 UI 与定义是否能保存。
- 不审计 `llm.*` 的真实功能，只检查 UI 与定义是否能保存。
- 发布功能只要求 B 站闭环；其他平台设置即使 UI 展示，也先按预留配置处理。

状态说明：
- 已生效：设置页 UI 能保存，后端任务链路明确读取，并影响真实任务。
- 半接线：能保存且有代码读取，但选项语义未完整实现。
- 预留 UI：能保存，但当前阶段明确不要求真实生效。
- 固定逻辑：设置页不展示，且不属于 `RevideoSettings`；由业务代码固定处理。

## 设置页 UI 与定义差异

### UI 正在展示的设置字段

| 模块 | UI 字段 |
| --- | --- |
| 下载与存储 | `task.storage.taskDataDir`, `task.download.videoQuality`, `task.download.commentSeconds`, `task.download.maxComments`, `task.download.retryCount`, `task.download.timeoutSec` |
| 素材整理与适配 | `task.prepare.outputAspect`, `task.prepare.outputResolution`, `task.prepare.fitMode`, `task.prepare.subtitleCleanup` |
| 翻译 | `task.translation.targetLanguage`, `task.translation.subtitleMode`, `task.translation.commentMode`, `task.translation.bilingualSubtitles`, `task.translation.sensitiveContent`, `task.translation.styleConstraints`, `task.translation.prompts.subtitle`, `task.translation.prompts.comment` |
| 封面与文案 | `task.coverAndCopy.template`, `task.coverAndCopy.imageMode`, `task.coverAndCopy.fixedFrameIndex`, `task.coverAndCopy.copyMode`, `task.coverAndCopy.fixedCopy.*`, `task.coverAndCopy.aiPrompt` |
| 渲染 | `task.render.outputDir`, `task.render.renderComments`, `task.render.commentFontSize`, `task.render.commentLineHeight`, `task.render.subtitleFontSize`, `task.render.subtitleLineHeight`, `task.render.commentContent`, `task.render.longCommentBehavior`, `task.render.repeatTimes`, `task.render.outputFormat` |
| 发布 | `task.publish.defaultPlatforms`（由平台启用开关写入）, `task.publish.platformConfigs.*.defaultAction`, `task.publish.platformConfigs.*.retryCount`, 各平台特殊配置, 各平台 `prompts.title/description/tags` |
| LLM | `llm.serviceMode`, `llm.provider`, `llm.baseUrl`, `llm.apiKeyEnv`, `llm.textModel`, `llm.visionModel`, `llm.thinking`, `llm.temperatureMode`, `llm.maxOutputMode`, `llm.timeoutSec`, `llm.retryCount` |
| Agent | `agent.enabled`, `agent.type`, `agent.connectionMode`, `agent.handoffMode`, `agent.token`, `agent.channels.*` |

### 已从设置类型移除并改为固定逻辑的字段

| 原字段 | 固定逻辑 |
| --- | --- |
| `task.source.defaultPlatform` | 创建任务弹窗可单次选择来源平台；未选择时固定为 `auto` |
| `task.source.duplicateStrategy` | 重复任务固定为 `block`，需要覆盖时由创建任务接口的 `force` 控制 |
| `task.source.loginMode` | 暂无设置入口，不保留隐藏配置 |
| `task.source.sourceLanguage` | 来源语言固定使用平台探测结果，任务目标语言由 UI 设置 |
| `task.download.qualityFallback` | YouTube 下载固定向下 fallback |
| `task.download.audioMode` | YouTube 下载固定音频跟随视频 |
| `task.download.subtitleMode` | YouTube 固定尝试下载平台字幕，优先中文，再英文/其他语言 |
| `task.download.subtitleFallback` | 不保留假的 STT 配置；没有本地 STT 实现就不暴露设置 |
| `task.download.commentSampling` | 评论排序固定为热度；评论数量由 `commentSeconds` 和 `maxComments` 控制 |
| `task.prepare.audioNormalize` | FFmpeg 渲染固定执行 `loudnorm` |
| `task.prepare.commentCleanup` | 评论规范化固定执行丢空和去重 |
| `task.translation.glossary` | UI 无入口，翻译 prompt 不再读取 |
| `task.translation.prompts.title/description/tags` | 改为平台级发布提示词：`task.publish.platformConfigs.*.prompts.*` |
| `task.render.commentStyle` | 评论样式固定为 `classic-dark` |
| `task.render.commentSpeed` | 评论速度固定为 `standard` |
| `task.publish.defaultAction` | 创建任务弹窗单次选择发布方式；未选择时固定为 `publish` |
| `task.publish.retryCount` | 只保留平台级 `retryCount`；缺省为 `1` |
| `task.publish.preflightChecks.*` | 发布预检固定执行 adapter、文件、文案、登录检查 |
| `llm.apiKey` | UI 只保留 `apiKeyEnv`，不保存明文 Key |

## 功能审计（以当前设置页 UI 为准）

### 下载与存储

| 设置项 | 状态 | 当前使用点 | 备注 |
| --- | --- | --- | --- |
| `task.storage.taskDataDir` | 已生效 | `src/jobs/store.ts` | 任务缓存根目录 |
| `task.download.videoQuality` | 已生效 | `src/platforms/sources/youtube.ts` | 已支持设置页的 `8k/4k/2k/1080p/720p/480p/best/auto` |
| `task.download.commentSeconds` | 已生效 | `calculateTargetCommentCount()` | 按视频时长计算目标评论数 |
| `task.download.maxComments` | 已生效 | `calculateTargetCommentCount()` | 限制评论数量上限 |
| `task.download.retryCount` | 已生效 | YouTube adapter | 控制下载重试 |
| `task.download.timeoutSec` | 已生效 | YouTube adapter | 控制下载超时 |

### 素材整理与适配

| 设置项 | 状态 | 当前使用点 | 备注 |
| --- | --- | --- | --- |
| `task.prepare.outputAspect` | 已生效 | `src/jobs/render-job.ts`, `src/renderer.ts` | 影响最终画幅和评论渲染画布 |
| `task.prepare.outputResolution` | 已生效 | `src/jobs/render-job.ts`, `src/renderer.ts` | 已支持设置页的档位值，也兼容创建任务弹窗的 `1080x1920` 等具体尺寸 |
| `task.prepare.fitMode` | 半接线 | `src/renderer.ts` | `keep-bars` 生效；`blur-background` 当前还是黑边补边；`smart-crop` 和 `center-crop` 暂时都是居中裁剪 |
| `task.prepare.subtitleCleanup` | 已生效 | `src/jobs/normalize.ts`, `src/subtitles/normalize.ts` | `merge-short` 会合并过短 WebVTT cue |

### 翻译

| 设置项 | 状态 | 当前使用点 | 备注 |
| --- | --- | --- | --- |
| `task.translation.targetLanguage` | 已生效 | 创建任务、翻译流程 | 控制字幕和评论目标语言 |
| `task.translation.subtitleMode` | 已生效 | `src/jobs/translate-job.ts` | `off` 跳过；`auto` 同语言跳过；`always` 强制翻译 |
| `task.translation.commentMode` | 已生效 | `src/jobs/translate-job.ts` | `off` 跳过；`auto` 同语言跳过；`always` 强制翻译 |
| `task.translation.bilingualSubtitles` | 已生效 | `src/jobs/render-job.ts` | 控制是否优先使用双语字幕文件 |
| `task.translation.sensitiveContent` | 已生效 | `src/jobs/translate-job.ts` | 拼入翻译提示词，是 prompt 约束 |
| `task.translation.styleConstraints` | 已生效 | `src/jobs/translate-job.ts` | 拼入翻译提示词 |
| `task.translation.prompts.subtitle` | 已生效 | `src/jobs/translate-job.ts` | 字幕翻译额外提示词 |
| `task.translation.prompts.comment` | 已生效 | `src/jobs/translate-job.ts` | 评论翻译额外提示词 |

### 封面与文案

| 设置项 | 状态 | 当前使用点 | 备注 |
| --- | --- | --- | --- |
| `task.coverAndCopy.template` | 已生效 | `src/jobs/generate-cover.ts`, `dashboard/src/lib/cover-templates.ts` | 控制封面模板 |
| `task.coverAndCopy.imageMode` | 已生效 | `src/jobs/generate-cover.ts` | 固定帧或 AI 选帧 |
| `task.coverAndCopy.fixedFrameIndex` | 已生效 | `src/jobs/generate-cover.ts` | 固定帧模式读取 |
| `task.coverAndCopy.copyMode` | 已生效 | `src/jobs/generate-cover.ts` | 无文案、固定文案、AI 文案 |
| `task.coverAndCopy.fixedCopy.*` | 已生效 | `src/jobs/generate-cover.ts` | 按模板字段数量读取 |
| `task.coverAndCopy.aiPrompt` | 已生效 | `src/jobs/generate-cover.ts` | 封面生成额外提示词 |

### 渲染

| 设置项 | 状态 | 当前使用点 | 备注 |
| --- | --- | --- | --- |
| `task.render.outputDir` | 已生效 | `src/jobs/render-job.ts`, `src/server.ts` | 渲染输出目录和重启恢复复用都读取 |
| `task.render.renderComments` | 已生效 | 创建任务、翻译、渲染 | 控制是否渲染评论 |
| `task.render.commentFontSize` | 已生效 | `src/jobs/render-job.ts`, `src/renderers/ffmpeg-comments.ts` | 评论字号倍率 |
| `task.render.commentLineHeight` | 已生效 | `src/jobs/render-job.ts`, `src/renderers/ffmpeg-comments.ts` | 评论行距倍率 |
| `task.render.subtitleFontSize` | 已生效 | `src/jobs/render-job.ts`, `src/renderer.ts`, `src/renderers/ffmpeg-comments.ts` | 字幕字号倍率 |
| `task.render.subtitleLineHeight` | 已生效 | `src/jobs/render-job.ts`, `src/renderer.ts`, `src/renderers/ffmpeg-comments.ts` | 字幕行距 |
| `task.render.commentContent` | 已生效 | `src/jobs/translate-job.ts` | 控制评论原文/译文组合 |
| `task.render.longCommentBehavior` | 已生效 | `src/renderers/ffmpeg-comments.ts` | 控制长评论换行、截断、缩小 |
| `task.render.repeatTimes` | 已生效 | 创建任务、渲染流程 | 控制视频重复次数 |
| `task.render.outputFormat` | 已生效 | `src/renderer.ts`, `src/server.ts` | 输出 `.mp4` 或 `.mov`，重启恢复也按格式查找 |

### B 站发布

| 设置项 | 状态 | 当前使用点 | 备注 |
| --- | --- | --- | --- |
| `task.publish.defaultPlatforms` | 已生效 | 创建任务 | 设置页平台启用开关会写入默认目标平台 |
| `task.publish.platformConfigs.bilibili.defaultAction` | 已生效 | `src/jobs/publish-job.ts`, `src/server.ts` | 控制 B 站目标是保存草稿还是发布 |
| `task.publish.platformConfigs.bilibili.retryCount` | 已生效 | `src/jobs/publish-job.ts` | 平台级发布重试次数 |
| `task.publish.platformConfigs.bilibili.category` | 已生效 | `src/jobs/drafts.ts`, B 站 publisher | B 站分区 |
| `task.publish.platformConfigs.bilibili.declaration` | 已生效 | `src/jobs/drafts.ts`, B 站 publisher | B 站创作声明 |
| `task.publish.platformConfigs.bilibili.tags` | 已生效 | `src/jobs/drafts.ts` | 固定标签与生成标签合并 |
| `task.publish.platformConfigs.bilibili.prompts.title` | 已生效 | `src/jobs/drafts.ts` | 标题额外提示词 |
| `task.publish.platformConfigs.bilibili.prompts.description` | 已生效 | `src/jobs/drafts.ts` | 描述额外提示词 |
| `task.publish.platformConfigs.bilibili.prompts.tags` | 已生效 | `src/jobs/drafts.ts` | 标签额外提示词 |

## 仍需后续补强

1. `task.prepare.fitMode` 需要补齐完整语义：真正的模糊背景、主体智能裁剪、居中裁剪差异。
2. 创建任务弹窗和设置页的分辨率选项仍不完全一致，后端已兼容两套值，但 UI 后续最好统一。
3. 发布页仍展示非 B 站平台配置，但真实发布只要求 B 站闭环；后续可按平台逐个启用。
