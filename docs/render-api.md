# Revideo Server API 文档

## 概述

Revideo Server 是一个视频渲染与发布服务，提供以下功能：

- **目录管理** — 浏览 `~/Movies` 下的视频目录
- **视频渲染** — 基于 Remotion 将视频评论渲染为成品视频
- **视频发布** — 自动化发布到 B站、抖音
- **任务管理** — 追踪视频从下载、翻译、渲染到发布的完整生命周期

**基础地址**: `http://localhost:3001`

**通用约定**:
- 所有接口使用 JSON 格式（`Content-Type: application/json`）
- 渲染和发布接口额外支持 SSE 实时进度推送（请求头加 `Accept: text/event-stream`）
- 错误响应格式: `{ "error": "错误描述" }`

---

## 一、目录管理

### 1.1 获取可用目录列表

扫描 `~/Movies` 下的视频文件夹，返回每个文件夹的名称及资源情况。

```
GET /api/dirs
```

**示例**:

```bash
curl http://localhost:3001/api/dirs
```

**响应**:

```json
[
  {
    "name": "my-video-1",
    "hasComments": true,
    "hasSubtitles": false
  },
  {
    "name": "my-video-2",
    "hasComments": false,
    "hasSubtitles": true
  }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 目录名称（也是目录文件夹名） |
| `hasComments` | boolean | 是否包含评论数据文件（`comments.json`） |
| `hasSubtitles` | boolean | 是否包含字幕文件（`.srt` / `.ass`） |

---

### 1.2 准备预览目录

将指定目录的视频、字幕、评论文件复制到工作目录，用于 Remotion Studio 预览。

```
POST /api/prepare/:dirName
```

**示例**:

```bash
curl -X POST http://localhost:3001/api/prepare/my-video-1
```

**成功响应**:

```json
{ "success": true }
```

---

### 1.3 预览源视频

以流式方式返回指定目录中的原始视频文件。

```
GET /api/preview/:dirName
```

**示例**:

```bash
# 在浏览器中预览
open http://localhost:3001/api/preview/my-video-1

# 下载视频文件
curl http://localhost:3001/api/preview/my-video-1 -o preview.mp4
```

---

## 二、视频渲染

渲染接口支持两种模式：

- **JSON 模式**（默认）— 等待渲染完成后一次性返回结果
- **SSE 模式** — 实时接收进度推送，适合长时间渲染场景

### 2.1 按目录名称渲染

渲染 `~/Movies` 下指定名称的目录。

```
POST /api/render/:dirName
```

**示例 — JSON 模式**:

```bash
curl -X POST http://localhost:3001/api/render/my-video-1
```

**成功响应**:

```json
{
  "success": true,
  "output": "out/my-video-1.mp4",
  "durationSec": 60.0
}
```

**示例 — SSE 模式**:

```bash
curl -N -X POST http://localhost:3001/api/render/my-video-1 \
  -H "Accept: text/event-stream"
```

**SSE 事件流**:

```
event: progress
data: {"stage":"preparing","percent":0,"message":"准备文件..."}

event: progress
data: {"stage":"downloading-avatars","percent":5,"message":"下载头像..."}

event: progress
data: {"stage":"rendering","percent":10,"message":"开始渲染 (1800 帧, 60.0s)..."}

event: progress
data: {"stage":"rendering","percent":31,"message":"渲染中 25% 450/1800 帧"}

event: progress
data: {"stage":"rendering","percent":95,"message":"渲染中 100% 1800/1800 帧"}

event: progress
data: {"stage":"extracting-cover","percent":96,"message":"提取封面..."}

event: progress
data: {"stage":"done","percent":100,"message":"渲染完成"}

event: done
data: {"success":true,"output":"out/my-video-1.mp4","durationSec":60}
```

### 2.2 按文件夹路径渲染

渲染任意路径的视频文件夹，适合 Agent 自动化调用。

```
POST /api/render-folder
Body: { "folder": "/absolute/path/to/folder" }
```

**示例 — JSON 模式**:

```bash
curl -X POST http://localhost:3001/api/render-folder \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Users/auto/Movies/my-video-1"}'
```

**成功响应**:

```json
{ "outputPath": "/Users/auto/code/revideo-server/out/my-video-1.mp4" }
```

**示例 — SSE 模式**:

```bash
curl -N -X POST http://localhost:3001/api/render-folder \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"folder": "/Users/auto/Movies/my-video-1"}'
```

SSE 事件格式与 2.1 相同。

### SSE 事件类型说明

| 事件 | 说明 |
|------|------|
| `progress` | 进度更新，包含 `stage`、`percent`、`message` |
| `done` | 渲染完成，包含输出路径和时长 |
| `error` | 渲染失败，包含错误信息 |

### progress 事件阶段

| 阶段 | 百分比范围 | 说明 |
|------|-----------|------|
| `preparing` | 0% | 复制视频、字幕、评论文件到工作目录 |
| `downloading-avatars` | 5% | 下载评论者头像 |
| `rendering` | 10%-95% | Remotion 渲染视频（最耗时） |
| `extracting-cover` | 96% | 用 ffmpeg 提取封面图 |
| `done` | 100% | 全部完成 |

---

## 三、视频发布

将渲染好的视频自动发布到 B站、抖音等平台。使用 Puppeteer 浏览器自动化完成。

```
POST /api/publish
```

**请求体**:

```json
{
  "videoPath": "/path/to/video.mp4",
  "platforms": ["bilibili", "douyin"],
  "taskId": "task_1234567890_abc",
  "bilibili": {
    "title": "视频标题",
    "description": "视频简介",
    "tags": ["标签1", "标签2"]
  },
  "douyin": {
    "title": "视频标题",
    "description": "视频描述"
  },
  "cdpEndpoint": "ws://127.0.0.1:9222/devtools/browser/xxx"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `videoPath` | string | 是 | 待发布视频的绝对路径 |
| `platforms` | string[] | 是 | 发布平台列表，支持 `"bilibili"` 和 `"douyin"` |
| `taskId` | string | 否 | 关联的任务ID，发布成功后自动更新任务发布状态 |
| `bilibili` | object | 否 | B站发布配置，包含 `title`、`description`、`tags` |
| `douyin` | object | 否 | 抖音发布配置，包含 `title`、`description` |
| `cdpEndpoint` | string | 否 | Chrome CDP WebSocket 地址，不传则自动发现 |

**示例 — 发布到 B站**:

```bash
curl -X POST http://localhost:3001/api/publish \
  -H "Content-Type: application/json" \
  -d '{
    "videoPath": "/Users/auto/code/revideo-server/out/my-video-1.mp4",
    "platforms": ["bilibili"],
    "bilibili": {
      "title": "精彩视频评论合集",
      "description": "来自YouTube的热门评论",
      "tags": ["评论", "精选", "YouTube"]
    }
  }'
```

**成功响应**:

```json
{
  "results": {
    "bilibili": { "success": true }
  }
}
```

**示例 — 同时发布到多平台（SSE 模式）**:

```bash
curl -N -X POST http://localhost:3001/api/publish \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "videoPath": "/Users/auto/code/revideo-server/out/my-video-1.mp4",
    "platforms": ["bilibili", "douyin"],
    "bilibili": {
      "title": "精彩视频评论合集",
      "description": "来自YouTube的热门评论",
      "tags": ["评论", "精选"]
    },
    "douyin": {
      "title": "精彩视频评论合集",
      "description": "来自YouTube的热门评论"
    }
  }'
```

**SSE 事件流示例**:

```
event: progress
data: {"stage":"connecting","percent":0,"message":"正在连接B站..."}

event: progress
data: {"stage":"done-bilibili","percent":50,"message":"✅ B站投稿成功！"}

event: progress
data: {"stage":"connecting","percent":50,"message":"正在连接抖音..."}

event: progress
data: {"stage":"done-douyin","percent":95,"message":"✅ 抖音发布成功！"}

event: done
data: {"results":{"bilibili":{"success":true},"douyin":{"success":true}}}
```

---

## 四、任务管理

管理视频从下载到发布的完整生命周期。任务数据以 JSON 文件存储在本地（`data/tasks.json`），自动清理超过 7 天的任务。

### 任务数据结构

```json
{
  "id": "task_1714567890123_abc123",
  "originalUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "downloadStatus": {
    "video": false,
    "subtitles": false,
    "comments": false
  },
  "translationStatus": {
    "subtitles": "pending",
    "comments": "pending"
  },
  "renderStatus": "pending",
  "publishStatus": {
    "bilibili": {
      "title": "视频标题",
      "description": "视频描述",
      "tags": ["标签1"],
      "published": false
    }
  },
  "createdAt": 1714567890123,
  "updatedAt": 1714567890123
}
```

### 状态说明

**下载状态** (`downloadStatus`):

| 字段 | 类型 | 说明 |
|------|------|------|
| `video` | boolean | 音视频是否已下载 |
| `subtitles` | boolean | 字幕是否已下载 |
| `comments` | boolean | 评论是否已下载 |

**翻译状态** (`translationStatus`):

| 字段 | 值 | 说明 |
|------|-----|------|
| `subtitles` | `"pending"` | 字幕待翻译 |
| | `"translated"` | 字幕已翻译 |
| | `"not-needed"` | 字幕无需翻译 |
| `comments` | `"pending"` | 评论待翻译 |
| | `"translated"` | 评论已翻译 |

**渲染状态** (`renderStatus`):

| 值 | 说明 |
|-----|------|
| `"pending"` | 待渲染 |
| `"rendering"` | 渲染中 |
| `"completed"` | 渲染完成 |
| `"failed"` | 渲染失败 |

**发布状态** (`publishStatus`): 按平台分别记录，每个平台包含 `title`、`description`、`published`，B站额外包含 `tags`。

**任务完成条件**: 下载全部完成 + 翻译完成（或无需翻译）+ 渲染完成 + 所有配置的平台已发布。

---

### 4.1 创建任务

```
POST /api/tasks
```

**请求体**:

```json
{
  "originalUrl": "https://www.youtube.com/watch?v=xxx",
  "initialStatus": {
    "downloadStatus": { "video": false, "subtitles": false, "comments": false },
    "renderStatus": "pending"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `originalUrl` | string | 是 | 原始视频链接 |
| `initialStatus` | object | 否 | 初始状态，未指定的字段使用默认值 |

**示例**:

```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"originalUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

**响应**:

```json
{
  "success": true,
  "task": {
    "id": "task_1714567890123_abc123",
    "originalUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "downloadStatus": { "video": false, "subtitles": false, "comments": false },
    "translationStatus": { "subtitles": "pending", "comments": "pending" },
    "renderStatus": "pending",
    "publishStatus": {},
    "createdAt": 1714567890123,
    "updatedAt": 1714567890123
  }
}
```

---

### 4.2 查询任务列表

返回任务列表，支持按状态、平台等条件过滤。

```
GET /api/tasks
```

**查询参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `status` | string | 按渲染状态过滤: `pending` / `rendering` / `completed` / `failed` |
| `platform` | string | 按发布平台过滤: `bilibili` / `douyin` |
| `published` | string | 按发布状态过滤: `true` / `false` |
| `since` | number | 只返回指定时间戳之后更新的任务 |

**示例 — 查询所有任务**:

```bash
curl http://localhost:3001/api/tasks
```

**响应**:

```json
{
  "tasks": [
    {
      "id": "task_1714567890123_abc123",
      "originalUrl": "https://www.youtube.com/watch?v=xxx",
      "downloadStatus": { "video": true, "subtitles": true, "comments": false },
      "translationStatus": { "subtitles": "translated", "comments": "pending" },
      "renderStatus": "pending",
      "publishStatus": {},
      "createdAt": 1714567890123,
      "updatedAt": 1714567900000
    }
  ],
  "total": 1,
  "pending": 1
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `tasks` | array | 任务列表，按更新时间倒序排列 |
| `total` | number | 任务总数 |
| `pending` | number | 未完成任务数 |

**示例 — 按渲染状态过滤**:

```bash
curl "http://localhost:3001/api/tasks?status=pending"
```

**示例 — 按平台过滤**:

```bash
curl "http://localhost:3001/api/tasks?platform=bilibili"
```

**示例 — 组合过滤**:

```bash
curl "http://localhost:3001/api/tasks?platform=douyin&published=false"
```

---

### 4.3 查询特定任务

查询单个任务的详细状态，包含完成判定和进度百分比。

```
GET /api/tasks/:taskId
```

**示例**:

```bash
curl http://localhost:3001/api/tasks/task_1714567890123_abc123
```

**响应**:

```json
{
  "success": true,
  "task": {
    "id": "task_1714567890123_abc123",
    "originalUrl": "https://www.youtube.com/watch?v=xxx",
    "downloadStatus": { "video": true, "subtitles": true, "comments": true },
    "translationStatus": { "subtitles": "translated", "comments": "translated" },
    "renderStatus": "completed",
    "publishStatus": {
      "bilibili": { "title": "视频标题", "description": "描述", "tags": ["标签"], "published": true }
    },
    "createdAt": 1714567890123,
    "updatedAt": 1714567950000
  },
  "isCompleted": true,
  "progress": {
    "download": 100,
    "translation": 100,
    "render": 100,
    "publish": 100,
    "overall": 100
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `isCompleted` | boolean | 任务是否已全部完成 |
| `progress.download` | number | 下载进度 0-100 |
| `progress.translation` | number | 翻译进度 0-100 |
| `progress.render` | number | 渲染进度 0-100 |
| `progress.publish` | number | 发布进度 0-100 |
| `progress.overall` | number | 总体进度 0-100 |

---

### 4.4 更新任务状态

更新指定任务的下载、翻译、渲染或发布状态。更新的字段会与已有数据合并。

```
PUT /api/tasks/:taskId
```

**请求体**:

```json
{
  "updates": {
    "downloadStatus": { "video": true },
    "renderStatus": "completed"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `updates.downloadStatus` | object | 否 | 合并更新下载状态，只需传变化的字段 |
| `updates.translationStatus` | object | 否 | 合并更新翻译状态 |
| `updates.renderStatus` | string | 否 | 更新渲染状态 |
| `updates.publishStatus` | object | 否 | 合并更新发布状态 |

**示例 — 下载完成**:

```bash
curl -X PUT http://localhost:3001/api/tasks/task_1714567890123_abc123 \
  -H "Content-Type: application/json" \
  -d '{"updates":{"downloadStatus":{"video":true,"subtitles":true,"comments":true}}}'
```

**响应**:

```json
{
  "success": true,
  "task": { "..." : "..." },
  "isCompleted": false,
  "progress": { "download": 100, "translation": 0, "render": 0, "publish": 0, "overall": 20 }
}
```

**示例 — 翻译完成**:

```bash
curl -X PUT http://localhost:3001/api/tasks/task_1714567890123_abc123 \
  -H "Content-Type: application/json" \
  -d '{"updates":{"translationStatus":{"subtitles":"translated","comments":"translated"}}}'
```

**示例 — 设置 B站发布信息**:

```bash
curl -X PUT http://localhost:3001/api/tasks/task_1714567890123_abc123 \
  -H "Content-Type: application/json" \
  -d '{"updates":{"publishStatus":{"bilibili":{"title":"我的视频","description":"视频简介","tags":["标签1"],"published":true}}}}'
```

---

### 4.5 删除任务

```
DELETE /api/tasks/:taskId
```

**示例**:

```bash
curl -X DELETE http://localhost:3001/api/tasks/task_1714567890123_abc123
```

**成功响应**:

```json
{ "success": true }
```

---

### 4.6 获取任务统计

返回所有任务的汇总统计信息。

```
GET /api/tasks/stats
```

**示例**:

```bash
curl http://localhost:3001/api/tasks/stats
```

**响应**:

```json
{
  "total": 10,
  "pending": 3,
  "inProgress": 2,
  "completed": 4,
  "failed": 1,
  "byPlatform": {
    "bilibili": { "published": 3, "pending": 2 },
    "douyin": { "published": 2, "pending": 1 }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `total` | number | 任务总数 |
| `pending` | number | 待处理（渲染状态为 pending） |
| `inProgress` | number | 进行中（渲染中或渲染完成但未全部完成） |
| `completed` | number | 已全部完成 |
| `failed` | number | 渲染失败 |
| `byPlatform.bilibili.published` | number | B站已发布数 |
| `byPlatform.bilibili.pending` | number | B站待发布数 |
| `byPlatform.douyin.published` | number | 抖音已发布数 |
| `byPlatform.douyin.pending` | number | 抖音待发布数 |

---

### 4.7 手动清理过期任务

手动触发清理超过 7 天的任务。正常情况下每次查询时会自动清理，此接口用于主动触发。

```
POST /api/tasks/cleanup
```

**示例**:

```bash
curl -X POST http://localhost:3001/api/tasks/cleanup
```

**响应**:

```json
{
  "success": true,
  "removedCount": 3
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `removedCount` | number | 被清理的过期任务数量 |

---

## 五、代码集成示例

### Python — 渲染 + 发布完整流程

```python
import requests
import json

BASE = "http://localhost:3001"

# 1. 渲染视频（SSE 进度）
resp = requests.post(f"{BASE}/api/render-folder",
    json={"folder": "/Users/auto/Movies/my-video"},
    headers={"Accept": "text/event-stream"},
    stream=True)

for line in resp.iter_lines(decode_unicode=True):
    if not line:
        continue
    if line.startswith("event: "):
        event = line[7:]
    elif line.startswith("data: "):
        payload = json.loads(line[6:])
        if event == "progress":
            print(f"[{payload['percent']}%] {payload['message']}")
        elif event == "done":
            video_path = payload["outputPath"]
            print(f"渲染完成: {video_path}")
        elif event == "error":
            print(f"失败: {payload['error']}")

# 2. 发布到 B站
resp = requests.post(f"{BASE}/api/publish",
    json={
        "videoPath": video_path,
        "platforms": ["bilibili"],
        "bilibili": {
            "title": "精彩评论合集",
            "description": "来自YouTube的热门评论",
            "tags": ["评论", "精选"]
        }
    })
print(resp.json())
```

### Node.js — 任务管理

```javascript
const BASE = "http://localhost:3001";

// 创建任务
const { task } = await fetch(`${BASE}/api/tasks`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    originalUrl: "https://www.youtube.com/watch?v=xxx"
  })
}).then(r => r.json());

// 更新下载完成
await fetch(`${BASE}/api/tasks/${task.id}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    updates: {
      downloadStatus: { video: true, subtitles: true, comments: true }
    }
  })
});

// 查询待处理任务
const { tasks, pending } = await fetch(`${BASE}/api/tasks`).then(r => r.json());
console.log(`待处理: ${pending} 个`);

// 获取统计
const stats = await fetch(`${BASE}/api/tasks/stats`).then(r => r.json());
console.log(`总任务: ${stats.total}, 已完成: ${stats.completed}`);
```
