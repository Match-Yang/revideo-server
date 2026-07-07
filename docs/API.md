# Revideo Server API

Base URL: `http://localhost:6688`

---

## 1. 任务（Job）管理

### 创建任务

自动探测平台、下载源视频并进入处理队列。

```
POST /api/jobs
```

**请求体：**

```json
{
  "source": {
    "url": "https://www.youtube.com/watch?v=xxx",
    "platform": "youtube"
  },
  "targets": [{ "platform": "bilibili" }],
  "options": {
    "targetLanguage": "zh-CN",
    "repeatTimes": 1,
    "downloadQuality": "auto"
  },
  "requirement": "可选的自定义需求描述"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `source.url` | 是 | 源视频 URL |
| `source.platform` | 否 | 平台标识，不传则自动识别。可选：`youtube` `tiktok` `bilibili` `douyin` `xiaohongshu` `instagram` `x` |
| `targets` | 否 | 目标平台列表，不传则使用默认配置。每项含 `platform` 字段 |
| `options` | 否 | 选项，见下表 |
| `requirement` | 否 | 自定义需求，传递给 AI 草稿生成 |

**options 字段：**

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `targetLanguage` | `"zh-CN"` | 翻译目标语言 |
| `renderTemplate` | `"comments-reaction"` | 渲染模板 |
| `downloadQuality` | `"auto"` | 下载画质：`auto` `best` `1080p` `720p` `480p` 或格式 ID |
| `repeatTimes` | `1` | 视频重复次数（1-10） |
| `targetCommentCount` | 自动计算 | 目标评论数，最多 800 |

**示例：**

```bash
curl -X POST http://localhost:6688/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{"source":{"url":"https://www.youtube.com/shorts/5ovDVjVJ1IA"}}'
```

**YouTube 快捷方式：**

```bash
curl -X POST http://localhost:6688/api/workflows/youtube \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/shorts/5ovDVjVJ1IA"}'
```

---

### 获取任务列表

```
GET /api/jobs
```

```bash
curl http://localhost:6688/api/jobs
```

**响应：** `{ "jobs": [ ...RevideoJob ] }`

---

### 获取单个任务

```
GET /api/jobs/:jobId
```

```bash
curl http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA
```

**响应：** `{ "success": true, "job": RevideoJob }`

---

### 获取任务事件日志

```
GET /api/jobs/:jobId/events
```

```bash
curl http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/events
```

---

### 获取任务产物文件

```
GET /api/jobs/:jobId/artifact?path=<相对路径>
```

`path` 必须是任务目录内的相对路径。JSON 文件返回解析后的对象，其他文件原样返回。

```bash
curl "http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/artifact?path=source/metadata/source.json"
```

---

### 删除任务

```
DELETE /api/jobs/:jobId
```

自动暂停关联的运行后删除。

```bash
curl -X DELETE http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA
```

---

## 2. 任务流程控制

### 启动任务

将任务加入处理队列。

```
POST /api/jobs/:jobId/start
```

**请求体（可选）：**

```json
{
  "steps": ["download", "normalize", "translate", "render", "generate-drafts", "preflight-publish", "publish"],
  "force": false,
  "formatId": "134"
}
```

| 字段 | 说明 |
|------|------|
| `steps` | 指定要执行的步骤，不传则执行全部后续步骤 |
| `force` | 强制重新执行已完成的步骤 |
| `formatId` | 指定下载格式 ID |

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/start
```

---

### 暂停任务

暂停正在运行或排队中的任务。

```
POST /api/jobs/:jobId/pause
```

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/pause
```

---

### 恢复任务

恢复已暂停的任务，自动检测断点继续。

```
POST /api/jobs/:jobId/resume
```

**请求体（可选）：** 同 start。

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/resume
```

---

### 取消任务

取消排队中或正在运行的任务。

```
POST /api/jobs/:jobId/cancel
```

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/cancel
```

---

### 重试任务

从失败步骤或指定步骤重新开始。

```
POST /api/jobs/:jobId/retry
```

**请求体（可选）：** 同 start。

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/retry
```

---

### 同步执行步骤

在线同步执行指定步骤（绕过队列），等待完成后返回结果。

```
POST /api/jobs/:jobId/run
```

**请求体：**

```json
{
  "steps": ["download", "render"],
  "force": true
}
```

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/run \
  -H 'Content-Type: application/json' \
  -d '{"steps":["download","normalize"]}'
```

---

## 3. 单步执行

每个步骤可独立调用，适用于需要精细控制的场景。

### 下载源视频

```
POST /api/jobs/:jobId/download
```

**请求体（可选）：** `{ "formatId": "134" }`

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/download
```

---

### 标准化资源

```
POST /api/jobs/:jobId/normalize
```

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/normalize
```

---

### 翻译（字幕 + 评论）

```
POST /api/jobs/:jobId/translate
```

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/translate
```

---

### 渲染视频

```
POST /api/jobs/:jobId/render
```

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/render
```

---

### 生成平台草稿

```
POST /api/jobs/:jobId/drafts/generate
```

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/drafts/generate
```

---

### 发布预检

```
POST /api/jobs/:jobId/preflight-publish
```

```bash
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/preflight-publish
```

---

### 发布

```
POST /api/jobs/:jobId/publish
```

**请求体（可选）：**

```json
{
  "platforms": ["bilibili"],
  "force": false
}
```

| 字段 | 说明 |
|------|------|
| `platforms` | 指定发布的平台列表，不传则发布所有目标平台 |
| `force` | 强制重新发布已发布的目标 |

```bash
# 发布到所有目标平台
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/publish

# 只发布到 B站
curl -X POST http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA/publish \
  -H 'Content-Type: application/json' \
  -d '{"platforms":["bilibili"]}'
```

---

## 4. 队列

### 查看队列状态

```
GET /api/jobs/queue
```

返回当前活跃任务、排队队列和最近完成记录。

```bash
curl http://localhost:6688/api/jobs/queue
```

---

## 5. 源视频探测

### 探测 URL

```
POST /api/sources/probe
```

**请求体：** `{ "url": "https://www.youtube.com/watch?v=xxx" }`

```bash
curl -X POST http://localhost:6688/api/sources/probe \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/shorts/5ovDVjVJ1IA"}'
```

### 获取可用格式

```
GET /api/download/formats?url=<编码后的URL>
```

```bash
curl "http://localhost:6688/api/download/formats?url=https%3A%2F%2Fwww.youtube.com%2Fshorts%2F5ovDVjVJ1IA"
```

---

## 7. 浏览器管理

管理用于自动发布的 Chromium 浏览器实例。

### 浏览器状态

```
GET /api/browser/status
```

### 启动浏览器

```
POST /api/browser/start
```

### 停止浏览器

```
POST /api/browser/stop
```

### 重启浏览器

```
POST /api/browser/restart
```

### 浏览器健康检查

```
GET /api/browser/health
```

### 检查平台登录状态

```
GET /api/browser/login/:platform
```

`platform` 可选：`bilibili` `douyin`

```bash
curl http://localhost:6688/api/browser/login/bilibili
```

### 打开平台登录页

```
POST /api/browser/open-login/:platform
```

```bash
curl -X POST http://localhost:6688/api/browser/open-login/bilibili
```

---

## 8. 翻译

### 获取翻译提供商列表

```
GET /api/translate/providers
```

### 测试翻译

```
POST /api/translate/test
```

**请求体：**

```json
{
  "text": "Hello world",
  "sourceLanguage": "en",
  "targetLanguage": "zh-CN",
  "systemPrompt": "可选的系统提示"
}
```

```bash
curl -X POST http://localhost:6688/api/translate/test \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello world","targetLanguage":"zh-CN"}'
```

---

## 9. 系统与设置

### 健康检查

```
GET /api/health
```

### 平台能力

```
GET /api/platforms
```

### 获取设置

```
GET /api/settings
```

### 更新设置

```
PUT /api/settings
```

**请求体：** 完整的设置对象（与 GET 返回的结构一致）。

```bash
curl -X PUT http://localhost:6688/api/settings \
  -H 'Content-Type: application/json' \
  -d @settings.json
```

---

## 10. 典型使用流程

### 完整的一键流程

创建任务时自动进入队列，按顺序执行全部步骤：

```bash
# 创建并自动执行（下载→标准化→翻译→封面→渲染→草稿→预检→发布）
curl -X POST http://localhost:6688/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{"source":{"url":"https://www.youtube.com/shorts/5ovDVjVJ1IA"}}'

# 查看进度
curl http://localhost:6688/api/jobs/youtube_5ovDVjVJ1IA
```

### 手动逐步执行

```bash
JOB_ID="youtube_5ovDVjVJ1IA"

# 1. 创建任务（不自动执行）
curl -X POST http://localhost:6688/api/workflows/youtube \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/shorts/5ovDVjVJ1IA"}'

# 2. 下载
curl -X POST http://localhost:6688/api/jobs/$JOB_ID/download

# 3. 标准化
curl -X POST http://localhost:6688/api/jobs/$JOB_ID/normalize

# 4. 翻译
curl -X POST http://localhost:6688/api/jobs/$JOB_ID/translate

# 5. 渲染
curl -X POST http://localhost:6688/api/jobs/$JOB_ID/render

# 6. 生成草稿
curl -X POST http://localhost:6688/api/jobs/$JOB_ID/drafts/generate

# 7. 发布预检
curl -X POST http://localhost:6688/api/jobs/$JOB_ID/preflight-publish

# 8. 发布
curl -X POST http://localhost:6688/api/jobs/$JOB_ID/publish
```

### 暂停 / 恢复 / 删除

```bash
JOB_ID="youtube_5ovDVjVJ1IA"

# 暂停
curl -X POST http://localhost:6688/api/jobs/$JOB_ID/pause

# 恢复
curl -X POST http://localhost:6688/api/jobs/$JOB_ID/resume

# 删除
curl -X DELETE http://localhost:6688/api/jobs/$JOB_ID
```

### 批量暂停/恢复

没有专用的批量接口，通过列表 + 循环实现：

```bash
# 暂停所有运行中的任务
curl -s http://localhost:6688/api/jobs | python3 -c "
import json, sys, subprocess
jobs = json.load(sys.stdin)['jobs']
for j in jobs:
    step = j.get('workflow',{}).get('currentStep','')
    if step in ('downloading-source','normalizing-assets','translating-assets','rendering-video','publishing-targets'):
        subprocess.run(['curl','-s','-X','POST',f'http://localhost:6688/api/jobs/{j[\"id\"]}/pause'])
        print(f'paused {j[\"id\"]}')
"
```

---

## 任务状态说明

### 工作流步骤（JobStep）

按执行顺序：

| 步骤 | 说明 |
|------|------|
| `created` | 任务已创建 |
| `probing-source` | 探测源视频信息 |
| `downloading-source` | 下载源视频 |
| `normalizing-assets` | 标准化资源 |
| `translating-assets` | 翻译字幕和评论 |
| `moderating-assets` | 内容审核 |
| `generating-cover-image` | 生成封面 |
| `rendering-video` | 渲染视频 |
| `generating-platform-drafts` | 生成各平台草稿 |
| `preflighting-targets` | 发布预检 |
| `publishing-targets` | 发布到各平台 |
| `completed` | 完成 |

### 步骤状态（StepStatus）

| 状态 | 说明 |
|------|------|
| `pending` | 等待执行 |
| `running` | 执行中 |
| `completed` | 已完成 |
| `failed` | 失败 |
| `skipped` | 已跳过 |
| `paused` | 已暂停 |

### 目标平台状态（TargetStatus）

| 状态 | 说明 |
|------|------|
| `pending` | 等待 |
| `drafted` | 已生成草稿 |
| `preflighting` | 预检中 |
| `publishing` | 发布中 |
| `published` | 已发布 |
| `failed` | 失败 |
