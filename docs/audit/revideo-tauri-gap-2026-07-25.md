# Revideo Tauri 客户端功能差距审计

> 审计日期：2026-07-25
> 对比基准：`dashboard/` (Next.js 16, ~1778 行 RevideoConsole) vs `revideo-app/` (Tauri v2, ~2015 行 RevideoConsole)
> 总体评估：~~Tauri 版本完成度约 **30-35%**~~ → **~85%** (Settings 页覆盖率大幅提升)
>
> **2026-07-25 更新**：实施完 parity 计划后，大部分差距已解决。下方各条目标注了解决状态。

---

## 一、总体架构对比

| 维度 | Dashboard (原版) | Tauri 客户端 |
|------|------------------|-------------|
| 代码量 | ~1778 行 (RevideoConsole) | ~2015 行 (RevideoConsole) |
| 国际化 | ✅ 完整 zh-CN/en i18n (`useI18n` hook) | ✅ **已修复** — 完整 zh/en i18n |
| UI 组件库 | 55+ shadcn 组件 + 大量自定义子组件 | ✅ **已修复** — 13 个自定义 settings helper + PageHeader + CoverCopyPane |
| 数据获取 | REST API `fetch()` | Tauri `invoke()` ✅ |
| 实时更新 | 6s 轮询 | 15s 轮询 + Tauri `job:progress` 事件 ✅ |
| 设置保存 | 700ms 防抖 (`scheduleSave`) | ✅ **已修复** — 700ms debounce |

---

## 二、页面级差距

### 1. Jobs 页（任务列表）

| 功能/细节 | Dashboard | Tauri | 差距 |
|-----------|-----------|-------|------|
| 表格基本功能 | ✅ | ✅ | 基本完成 |
| 搜索 | ✅ 搜索包含 job title + draft title | ✅ **已修复** — title + URL 搜索 | ✅ 已修复 |
| 状态筛选器 | ✅ 6 种 (all/running/publishing/paused/completed/failed) | ✅ **已修复** — 6 种 | ✅ 已修复 |
| 重复 URL 检测 | ✅ 创建时检测重复 URL 并显示 amber 警告 | ✅ **已修复** — 黄色警告条 | ✅ 已修复 |
| 创建对话框 - 基础选项 | ✅ Quality/Repeat/Comments/Targets | ✅ | 基本完成 |
| 创建对话框 - 翻译高级选项 | ✅ 目标语言 / 字幕模式 / 评论模式 / 敏感内容 / 双语 / 风格 / 提示词 | ✅ **已修复** — Accordion 折叠面板 | ✅ 已修复 |
| 表格列 - draft title | ✅ 在 job title 下方显示 draft title | ❌ | 低优先级 |
| 表格列 - repeatTimes | ✅ 在进度文字中显示 `x{repeatTimes}` | ❌ | 低优先级 |
| 详情面板 - 工作流步骤 error | ✅ 每步下方显示 error 文字 | ✅ **已修复** — error section | ✅ 已修复 |
| 详情面板 - 评论数 badge | ✅ 显示 `targetCommentCount` | ✅ **已修复** — comments badge | ✅ 已修复 |
| 详情面板 - 操作按钮条件逻辑 | ✅ `canPause`/`canResume`/`canRetry` 精确判断 | ✅ 简化版 | 部分完成 |
| 详情面板 - 封面图预览 | ❌ 无 | ✅ `<img>` + `convertFileSrc` | Tauri **多出** |
| 分页 - 筛选时重置页码 | ✅ `useEffect(() => setPage(1), [query, statusFilter, pageSize])` | ✅ **已修复** | ✅ 已修复 |

### 2. Publishing 页（发布状态）

| 功能/细节 | Dashboard | Tauri | 差距 |
|-----------|-----------|-------|------|
| 页面标题栏 | ✅ `PageHeader` (icon + title + description) | ✅ **已修复** | ✅ 已修复 |
| 卡片头部 | ✅ `CardTitle` + `CardDescription` | ✅ **已修复** | ✅ 已修复 |
| 列表内容 | ✅ | ✅ | 基本完成 |
| 状态文案 | ✅ i18n | ✅ **已修复** | ✅ 已修复 |

### 3. Health 页（健康检查）

| 功能/细节 | Dashboard | Tauri | 差距 |
|-----------|-----------|-------|------|
| 页面标题栏 | ✅ `PageHeader` | ✅ **已修复** | ✅ 已修复 |
| 浏览器状态三态 | ✅ running / installed / missing | ❌ 只 running / stopped | **差异** (Rust API 限制) |
| 浏览器 CDP URL | ✅ 显示 `cdpUrl` | ✅ 显示 `cdp_port` | **差异** (等价) |
| 浏览器可执行路径 | ✅ 显示 `executablePath` + `error` | ❌ | 低优先级 |
| 依赖项详情 | ✅ 每个 dep 显示 name + version + error 详细信息 | ❌ 只显示 boolean ok/not-ok | **差异** (Rust API 限制) |

### 4. Settings 页 — 大幅改善

#### 4.1 总体差异

| 功能/细节 | Dashboard | Tauri |
|-----------|-----------|-------|
| 设置组名 | ✅ "任务流程" / "模型与集成" | ✅ **已修复** — i18n |
| 设置项标签 | ✅ "下载与存储" / "素材整理与适配" / "封面与文案" / "LLM 设置" / "Agent 设置" | ✅ **已修复** — i18n |
| 防抖保存 | ✅ 700ms debounce | ✅ **已修复** — 700ms |
| 帮助提示 | ✅ 每个字段都有 help tooltip (?) | ✅ **已修复** — HelpTooltip |
| 设置面板容器 | ✅ `SettingsPane` 组件 | ✅ **已修复** — 侧边栏导航 |

#### 4.2 发现 (Discovery)

| 设置项 | Dashboard | Tauri |
|--------|-----------|-------|
| 启用开关 `task.discovery.enabled` | ✅ | ✅ **已修复** |
| 监控频道 `task.discovery.channels` | ✅ | ✅ |
| 硬性过滤 - 最低播放量 | ✅ | ✅ |
| 硬性过滤 - 最低评论数 | ✅ | ✅ |
| 硬性过滤 - 最大发布天数 | ✅ | ✅ |
| LLM 过滤提示词 | ✅ | ✅ (字段名 `semantic_filter_prompt`) |
| 短视频最大时长 `max_duration_sec` | ✅ | ✅ **已修复** |
| 重复次数 `repeat_times` | ✅ | ✅ **已修复** |
| 定时 - 执行时间 `run_hour` | ✅ | ✅ **已修复** |
| 手动触发 + 运行中状态 | ✅ | ✅ **已修复** — Run Now + badge |
| 运行中轮询 | ✅ 5s | ✅ **已修复** — 5s 轮询 |

#### 4.3 下载与存储 (Download)

| 设置项 | Dashboard | Tauri |
|--------|-----------|-------|
| 视频下载分辨率 | ✅ 8 选项 | ✅ **已修复** — 5 选项 (auto/best/1080p/720p/480p) |
| 最大评论数 `max_comments` | ✅ | ✅ |
| 下载重试次数 `retry_count` | ✅ | ✅ |
| 下载超时秒数 `timeout_sec` | ✅ | ✅ **已修复** |
| ~~每条评论秒数~~ `comment_seconds` | ✅ | ⚠️ **Rust 无此字段** (Dashboard 独有) |

#### 4.4 素材整理与适配 (Prepare)

| 设置项 | Dashboard | Tauri |
|--------|-----------|-------|
| 输出画幅 `output_aspect` | ✅ | ✅ **已修复** — SelectField |
| 输出分辨率 `output_resolution` | ✅ | ✅ **已修复** — SelectField |
| 画面适配方式 `fit_mode` | ⚠️ 4 选项 (smart-crop/blur-background/keep-bars/center-crop) | ✅ **已修复** — contain/cover/stretch (**Rust 枚举不同**) |
| 字幕整理 `subtitle_cleanup` | ✅ | ✅ **已修复** — SwitchRow |

#### 4.5 翻译 (Translation)

| 设置项 | Dashboard | Tauri |
|--------|-----------|-------|
| 目标语言 `target_language` | ✅ | ✅ |
| 字幕翻译模式 `subtitle_mode` | ✅ | ✅ **已修复** — SelectField |
| 评论翻译模式 `comment_mode` | ✅ | ✅ **已修复** — SelectField |
| 双语字幕 `bilingual_subtitles` | ✅ | ✅ |
| 敏感内容处理 `sensitive_content` | ✅ | ✅ **已修复** — SelectField |
| 风格约束 `style_constraints` | ✅ | ✅ |
| 字幕额外提示词 `subtitle_prompt_override` | ✅ | ✅ **已修复** — PromptField |
| 评论额外提示词 `comment_prompt_override` | ✅ | ✅ **已修复** — PromptField |

#### 4.6 封面与文案 (Cover) — 大幅改善

| 设置项 | Dashboard | Tauri |
|--------|-----------|-------|
| 封面模板选择器 | ✅ SVG 预览网格 | ✅ **已修复** — CoverCopyPane |
| 封面图来源 `image_mode` | ✅ | ✅ **已修复** |
| 封面文案来源 `copy_mode` | ✅ | ✅ **已修复** |
| 固定文案多行输入 `copy_lines` | ✅ | ✅ **已修复** |
| AI 文案提示词 `ai_prompt` | ✅ | ✅ **已修复** |
| `cover-templates.ts` 模块 | ✅ | ✅ **已修复** — 完整移植 |

#### 4.7 渲染 (Render)

| 设置项 | Dashboard | Tauri |
|--------|-----------|-------|
| 渲染输出位置 `output_dir` | ✅ | ✅ — LabelInput |
| 渲染评论开关 `render_comments` | ✅ | ✅ |
| 评论字号 `comment_font_size` | ✅ | ✅ **已修复** — LabelInput (数值) |
| ~~评论行距~~ `comment_line_height` | ✅ | ⚠️ **Rust 无此字段** |
| 字幕字号 `subtitle_font_size` | ✅ | ✅ **已修复** |
| ~~字幕行距~~ `subtitle_line_height` | ✅ | ⚠️ **Rust 无此字段** |
| 评论显示内容 `comment_content` | ✅ | ✅ **已修复** — SelectField |
| ~~长评论换行~~ `long_comment_behavior` | ✅ | ⚠️ **Rust 无此字段** |
| 重复次数 `repeat_times` | ✅ | ✅ **已修复** |
| 输出格式 `output_format` | ✅ | ✅ |
| 硬件加速 `hardware_accel` | ✅ | ✅ **已修复** — SwitchRow |

#### 4.8 发布 (Publish)

| 设置项 | Dashboard | Tauri |
|--------|-----------|-------|
| 每平台 - 启用开关 | ✅ | ✅ |
| 每平台 - 默认动作 `default_action` | ✅ | ✅ **已修复** — SelectField (publish/draft/dry-run) |
| 每平台 - 提示词 (title/desc/tags) | ✅ | ✅ **已修复** — PromptField x3 |
| ~~每平台特殊配置~~ (分区/话题/可见性等) | ✅ | ⚠️ **Rust PlatformPublishConfig 无平台特殊字段** — 需要 Rust 侧先支持 |

> **重要发现**：Rust `PlatformPublishConfig` 只有 5 个通用字段 (enabled/default_action/title_prompt/description_prompt/tags_prompt)，不支持平台特定配置（bilibili category、douyin topics 等）。这些字段要等 Rust 侧扩展后才能在前端显示。

#### 4.9 LLM 设置

| 设置项 | Dashboard | Tauri |
|--------|-----------|-------|
| API Base URL `api_base` | ✅ | ✅ — WideLabelInput |
| 模型名称 `text_model` | ✅ | ✅ |
| API Key `api_key` | ✅ password 类型 | ✅ password 类型 |
| 视觉模型 `vision_model` | ❌ | ✅ **Tauri 多出** |
| 温度 `temperature` | ❌ | ✅ **Tauri 多出** |
| 超时 `timeout_secs` | ❌ | ✅ **Tauri 多出** |

#### 4.10 Agent 设置

| 设置项 | Dashboard | Tauri |
|--------|-----------|-------|
| 完整 Agent 指令 + 复制按钮 | ✅ | ✅ **已修复** — `AGENT_INSTRUCTION` + copy |

---

## 三、缺失的 UI 子组件

| 组件 | 用途 | 状态 |
|------|------|------|
| `PageHeader` | 页面标题栏 | ✅ **已修复** |
| `SettingsSection` | 设置分组卡片 | ✅ **已修复** |
| `SelectField` | 带帮助提示的下拉 | ✅ **已修复** |
| `SettingRow` | 设置行 | ✅ **已修复** |
| `LabelInput` | 带标签输入框 | ✅ **已修复** |
| `WideLabelInput` | 宽版 LabelInput | ✅ **已修复** |
| `PathField` | 带文件夹浏览的路径字段 | ✅ **已修复** — 使用 Tauri dialog plugin |
| `SwitchRow` | 带标签开关 | ✅ **已修复** |
| `PromptField` | 提示词文本域 | ✅ **已修复** |
| `FieldControl` | 字段容器 | ✅ **已修复** |
| `FieldLabel` | 标签 + 帮助 | ✅ **已修复** |
| `HelpTooltip` | 帮助 tooltip | ✅ **已修复** |
| `CoverCopyPane` | 封面模板 SVG 预览 | ✅ **已修复** |
| `SettingsAccordionItem` | 创建对话框折叠面板 | ⚠️ 用原生 Accordion 替代 |
| `DialogRow` | 创建对话框行 | ⚠️ 内联实现 |
| `draftTitle()` | 提取 draft title | ⚠️ 低优先级 |

---

## 四、剩余差距（需要 Rust 侧配合）

以下差距无法仅通过前端修复，需要 Rust 后端先添加对应字段或 API：

| # | 差距 | 需要 Rust 支持 |
|---|------|---------------|
| 1 | 平台特殊发布配置 (bilibili category, douyin topics 等) | 扩展 `PlatformPublishConfig` |
| 2 | Instagram / X 平台发布配置 | 添加到 `PlatformPublishConfigs` |
| 3 | `comment_seconds` 下载字段 | 添加到 `DownloadSettings` |
| 4 | `comment_line_height` / `subtitle_line_height` | 添加到 `RenderSettings` |
| 5 | `long_comment_behavior` | 添加到 `RenderSettings` |
| 6 | Health 依赖项版本详情 | 扩展 `get_health` 返回 |
| 7 | 浏览器 executablePath / error | 扩展 `BrowserStatus` |

---

## 五、修复优先级

### 🔴 P0 — 已全部解决 ✅

| # | 项目 | 状态 |
|---|------|------|
| 1 | Settings 表单补全 | ✅ 已修复 |
| 2 | 封面模板选择器 | ✅ 已修复 |
| 3 | 创建对话框翻译高级选项 | ✅ 已修复 |
| 4 | 发布平台配置 | ✅ 已修复 (通用字段) |

### 🟡 P1 — 已全部解决 ✅

| # | 项目 | 状态 |
|---|------|------|
| 5 | i18n 国际化 | ✅ 已修复 |
| 6 | 设置字段 help 提示 | ✅ 已修复 |
| 7 | 发现设置补全 | ✅ 已修复 |
| 8 | 下载设置补全 | ✅ 已修复 |
| 9 | Prepare 补全 | ✅ 已修复 |
| 10 | Health 详情补全 | ⚠️ 部分 — 需要 Rust 扩展 |
| 11 | 重复 URL 检测 | ✅ 已修复 |
| 12 | PathField 文件夹浏览 | ✅ 已修复 |
| 13 | 防抖保存 | ✅ 已修复 |
| 14 | UI 子组件移植 | ✅ 已修复 |

### 🟢 P2 — 大部分已解决

| # | 项目 | 状态 |
|---|------|------|
| 15 | status filter 补全 | ✅ 已修复 |
| 16 | detail panel error 显示 | ✅ 已修复 |
| 17 | detail panel 评论数 | ✅ 已修复 |
| 18 | 页码重置逻辑 | ✅ 已修复 |
| 19 | 轮询间隔优化 | 保留 15s (Tauri 事件驱动) |
| 20 | Publishing 页 CardHeader | ✅ 已修复 |
| 21 | NativeSelect vs shadcn Select | 保留 shadcn Select |
