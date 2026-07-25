# Revideo Tauri 客户端功能差距审计

> 审计日期：2026-07-25（最后更新 2026-07-25 evening）
> 对比基准：`dashboard/` (Next.js 16, ~1778 行 RevideoConsole) vs `revideo-app/` (Tauri v2, ~2300+ 行 RevideoConsole)
>
> **重要：本文档是 parity 工作的唯一 truth source。所有修复必须逐条对应本文档，完成后更新状态。**

---

## 一、已解决的差距

> 以下条目在前几轮已实现并通过 `tsc --noEmit` + `vite build` + `cargo check` 验证。

### Settings 页 — 已修复 ✅

| # | 差距项 | 提交 |
|---|--------|------|
| 1 | i18n 国际化 (zh/en) | `e42ec88` |
| 2 | 防抖保存 (700ms debounce) | `b116392` |
| 3 | Help tooltip (?) | `68daf50` |
| 4 | 13 个 settings helper 组件 | `68daf50` |
| 5 | CoverCopyPane + cover-templates.ts | `68daf50` |
| 6 | PageHeader 组件 | `68daf50` |
| 7 | 创建对话框翻译高级选项 (Accordion) | `b116392` |
| 8 | 重复 URL 检测 + 警告 | `b116392` |
| 9 | status filter 补全 (6 种) | `b116392` |
| 10 | detail panel error / comments badge | `b116392` |
| 11 | 分页筛选重置 | `b116392` |
| 12 | Discovery 启用开关 + Run Now + 轮询 | `b116392` |
| 13 | Download: timeout_sec | `b116392` |
| 14 | Prepare: fit_mode, subtitle_cleanup | `b116392` |
| 15 | Translation: subtitle_mode, comment_mode, sensitive_content, prompt overrides | `b116392` |
| 16 | Cover: image_mode, copy_mode, copy_lines, ai_prompt | `b116392` |
| 17 | Render: comment_font_size, subtitle_font_size, comment_content, hardware_accel, repeat_times | `b116392` |
| 18 | Publish: default_action, per-platform prompts | `b116392` |
| 19 | Download: comment_seconds | `965f18f` |
| 20 | Render: comment_line_height, subtitle_line_height, long_comment_behavior | `965f18f` |
| 21 | Publish: retry_count, extra JSON, 7 平台特殊配置 | `965f18f` |

### 其他已修复 ✅

| # | 差距项 | 提交 |
|---|--------|------|
| 22 | Publishing 页 CardHeader | `b116392` |
| 23 | Health 页 PageHeader | `b116392` |
| 24 | @tauri-apps/plugin-dialog (PathField) | `68a28f9` |

### Rust Bug 修复 ✅

| # | 问题 | 提交 |
|---|------|------|
| 25 | info.json 发现失败 (Path::extension vs suffix) | `03f3bbd` |
| 26 | G1: task_data_dir (Rust + UI + i18n) | 本提交 |
| 27 | G2: discovery.targets (Rust + UI + i18n) | 本提交 |
| 28 | G5: cookies_path PathField (UI + i18n) | 本提交 |
| 29 | G6: js_runtime PathField (UI + i18n) | 本提交 |
| 30 | G7: render.template LabelInput (UI + i18n) | 本提交 |
| 31 | G8: publish.max_retries LabelInput (UI + i18n) | 本提交 |
| 32 | G9: publish.retry_delay_secs LabelInput (UI + i18n) | 本提交 |

---

## 二、剩余差距

> 以下条目未经修复，需逐条实施并更新状态。

### 🔴 P0 — Dashboard 有但 Tauri 完全缺失

| # | 字段路径 | Dashboard 组件 | 类型 | Rust 支持 | 需要改 |
|---|---------|---------------|------|----------|--------|
| G1 | `task.storage.taskDataDir` | `PathField` + 文件夹浏览 | string | ✅ `TaskSettings.task_data_dir` | ✅ 已修复 (#26) |
| G2 | `task.discovery.targets` | Checkbox 多选 (bilibili/douyin/youtube/tiktok) | string[] | ✅ `DiscoverySettings.targets` | ✅ 已修复 (#27) |
| G3 | `agent.enabled` | SwitchRow | boolean | ❌ 跳过 — 非 core 功能，复杂度高 | ⏭️ 跳过（设计决策） |
| G4 | `agent.channels` | 7 渠道 × 4 字段 = 28 个 | object[] | ❌ 跳过 | ⏭️ 跳过（设计决策） |

### 🟡 P1 — Rust 有但 Tauri 无 UI

| # | 字段路径 | Dashboard | Tauri UI | 说明 |
|---|---------|-----------|---------|------|
| G5 | `task.download.cookies_path` | 无 | ✅ PathField | ✅ 已修复 (#28) |
| G6 | `task.download.js_runtime` | 无 | ✅ PathField | ✅ 已修复 (#29) |
| G7 | `task.render.template` | 无 | ✅ LabelInput | ✅ 已修复 (#30) |
| G8 | `task.publish.max_retries` | 无 | ✅ LabelInput | ✅ 已修复 (#31) |
| G9 | `task.publish.retry_delay_secs` | 无 | ✅ LabelInput | ✅ 已修复 (#32) |

### 🟠 P2 — Dashboard 和 Rust 值不一致（以 Rust 为准，不改）

| # | 字段 | Dashboard 值 | Rust 值 | 状态 |
|---|------|-------------|---------|------|
| G10 | `task.prepare.fit_mode` | smart-crop / blur-background / keep-bars / center-crop | contain / cover / stretch | ✅ 以 Rust 为准 |
| G11 | `task.prepare.subtitle_cleanup` | 字符串枚举 merge-short / keep | 布尔值 boolean | ✅ 以 Rust 为准 |
| G12 | `task.render.comment_content` | original-translated / translated-only | full / truncated / summary | ✅ 以 Rust 为准 |
| G13 | `task.render.comment_font_size` | select: small / medium / large | u32 数字 (default 24) | ✅ 以 Rust 为准 |
| G14 | `task.render.subtitle_font_size` | select: small / medium / large | u32 数字 (default 32) | ✅ 以 Rust 为准 |
| G15 | `task.prepare.output_resolution` | 1080p / 720p 等分辨率 | 1080x1920 等尺寸对 | ✅ 以 Rust 为准 |
| G16 | `task.prepare.output_aspect` | portrait / landscape / source | 9:16 / 16:9 (值格式不同) | ✅ 以 Rust 为准 |
| G17 | `task.download.video_quality` | 8 选项 (含 8k/4k/2k) | 5 选项 (无 8k/4k/2k) | ✅ 以 Rust 为准 |
| G18 | `task.download.retry_count` | 默认 2 | 默认 3 | ✅ 以 Rust 为准 |
| G19 | `task.download.max_comments` | 默认 800 | 默认 800 | ✅ 一致 |
| G20 | `llm.text_model` | 默认 gpt-4.1-mini | 默认 gpt-4o | ✅ 以 Rust 为准 |
| G21 | `llm.timeoutSec` | Dashboard 有但非 UI 字段 | `timeout_secs` Rust 有 | ✅ 以 Rust 为准 |

> **P2 说明**：这些差异是 Dashboard (Next.js 服务版) 和 Rust 桌面版从一开始就用了不同的设计。
> **决策：全部以 Rust 类型为准**，不做任何修改。

---

## 三、修复执行记录

> 每次修复后在此记录，保持可追溯。

| 日期 | 解决的编号 | 提交 | 说明 |
|------|-----------|------|------|
| 2026-07-25 | #1-18 | `68daf50` ~ `e42ec88` | 首轮 parity 实现 |
| 2026-07-25 | #19-21 | `965f18f` | Rust 类型扩展 + 前端 parity |
| 2026-07-26 | Bug #25 | `03f3bbd` | info.json 后缀匹配修复 |
| 2026-07-25 | G1,G2,Rust | 本提交 | TaskSettings.task_data_dir + DiscoverySettings.targets |
| 2026-07-25 | G1-G9,UI | 本提交 | RevideoConsole 7 个新 UI 字段 |
| 2026-07-25 | G1-G9,i18n | 本提交 | ~30 个新 i18n keys |
| 2026-07-25 | G3,G4 跳过 | — | 设计决策：非 core 功能，不加 |
| 2026-07-25 | G10-G21 关闭 | — | 决策：全部以 Rust 为准 |
