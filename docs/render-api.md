# Revideo Server API 文档

## 概述

Revideo Server 是一个视频渲染与发布服务，提供以下功能：

- **目录管理** — 浏览 `~/Movies` 下的视频目录
- **视频渲染** — 基于 FFmpeg 将视频、字幕和评论渲染为成品视频
- **视频发布** — 自动化发布到 B站、抖音
- **任务管理** — 追踪视频从下载、翻译、渲染到发布的完整生命周期

**基础地址**: `http://localhost:6688`

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
curl http://localhost:6688/api/dirs
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
| `hasSubtitles` | boolean | 是否包含字幕文件（`.srt` / `.vtt`） |

---

### 1.2 预览源视频

以流式方式返回指定目录中的原始视频文件。

```
GET /api/preview/:dirName
```

**示例**:

```bash
# 在浏览器中预览
open http://localhost:6688/api/preview/my-video-1

# 下载视频文件
curl http://localhost:6688/api/preview/my-video-1 -o preview.mp4
```

---

## 二、视频渲染

渲染接口支持两种模式：

- **JSON 模式**（默认）— 等待渲染完成后一次性返回结果
- **SSE 模式** — 实时接收进度推送，适合长时间渲染场景

渲染开始/完成/失败时，会自动通过目录名（= YouTube 视频 ID）匹配并更新对应任务的状态，无需手动传任务 ID。

### 2.1 按目录名称渲染

渲染 `~/Movies` 下指定名称的目录。

```
POST /api/render/:dirName
```

**请求体**（可选）:

```json
{ "force": true }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `force` | boolean | 否 | 强制重新渲染（覆盖已有输出文件） |

**示例 — JSON 模式**:

```bash
curl -X POST http://localhost:6688/api/render/my-video-1
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
curl -N -X POST http://localhost:6688/api/render/my-video-1 \
  -H "Accept: text/event-stream"
```

**SSE 事件流**:

```
data: {"stage":"preparing","percent":0,"message":"准备文件..."}

data: {"stage":"downloading-avatars","percent":3,"message":"下载头像..."}

data: {"stage":"bundling","percent":5,"message":"打包项目..."}

data: {"stage":"rendering","percent":8,"message":"开始渲染 (1800 帧, 60.0s)..."}

data: {"stage":"rendering","percent":31,"message":"渲染帧 25% (450/1800)"}

data: {"stage":"encoding","percent":60,"message":"编码视频 50% (900/1800)"}

data: {"stage":"muxing","percent":93,"message":"合成音轨 98%"}

data: {"stage":"extracting-cover","percent":96,"message":"提取封面..."}

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

**请求体**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `folder` | string | 是 | 视频文件夹的绝对路径 |
| `force` | boolean | 否 | 强制重新渲染（覆盖已有输出文件） |

**示例 — JSON 模式**:

```bash
curl -X POST http://localhost:6688/api/render-folder \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Users/auto/Movies/my-video-1"}'
```

**成功响应**:

```json
{ "outputPath": "/Users/auto/code/revideo-server/out/my-video-1.mp4" }
```

**示例 — SSE 模式**:

```bash
curl -N -X POST http://localhost:6688/api/render-folder \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"folder": "/Users/auto/Movies/my-video-1"}'
```

SSE 进度事件格式与 2.1 相同。`done` 事件格式不同：

```
event: done
data: {"outputPath":"/Users/auto/code/revideo-server/out/my-video-1.mp4"}
```

JSON 模式成功响应也是同样的 `{ "outputPath": "..." }` 格式。

### SSE 事件类型说明

| 事件 | 说明 |
|------|------|
| （无名） | 进度更新（纯 `data:` 行，无 `event:` 前缀），包含 `stage`、`percent`、`message` |
| `done` | 渲染完成，包含输出路径和时长 |
| `stopped` | 渲染被手动停止 |
| `error` | 渲染失败，包含错误信息 |

### progress 事件阶段

| 阶段 | 百分比范围 | 说明 |
|------|-----------|------|
| `preparing` | 0% | 复制视频、字幕、评论文件到工作目录 |
| `downloading-avatars` | 3% | 下载评论者头像 |
| `rendering` | 8%-95% | FFmpeg 渲染、编码并合成视频 |
| `extracting-cover` | 96% | 用 ffmpeg 提取封面图 |
| `done` | 100% | 全部完成 |

### 2.3 停止渲染

停止当前正在进行的渲染任务。

```
POST /api/render-stop
```

**示例**:

```bash
curl -X POST http://localhost:6688/api/render-stop
```

**成功响应**:

```json
{ "success": true, "message": "已停止渲染: my-video-1" }
```

---

## 三、视频发布

将渲染好的视频自动发布到 B站、抖音等平台。使用 Puppeteer 浏览器自动化完成。

填了 `bilibili` 配置就发 B 站，填了 `douyin` 配置就发抖音，都填就都发。不需要额外的 `platforms` 字段。

发布完成后，会自动从 `videoPath` 中提取视频 ID（文件名，不含扩展名），匹配并更新对应任务的发布状态，无需手动传任务 ID。

```
POST /api/publish
```

**请求体**:

```json
{
  "videoPath": "/path/to/video.mp4",
  "bilibili": {
    "title": "视频标题",
    "description": "视频简介",
    "tags": ["标签1", "标签2"],
    "category": "科技"
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
| `bilibili` | object | 否* | B站发布配置：`title`（必填）、`description`（必填）、`tags`（可选，string[]）、`category`（可选，string） |
| `douyin` | object | 否* | 抖音发布配置：`title`（必填）、`description`（必填） |
| `cdpEndpoint` | string | 否 | Chrome CDP WebSocket 地址，不传则自动发现 |

*`bilibili` 和 `douyin` 至少填一个。

**示例 — 发布到 B站**:

```bash
curl -X POST http://localhost:6688/api/publish \
  -H "Content-Type: application/json" \
  -d '{
    "videoPath": "/Users/auto/code/revideo-server/out/my-video-1.mp4",
    "bilibili": {
      "title": "精彩视频评论合集",
      "description": "来自YouTube的热门评论",
      "tags": ["评论", "精选", "YouTube"],
      "category": "科技"
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
curl -N -X POST http://localhost:6688/api/publish \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "videoPath": "/Users/auto/code/revideo-server/out/my-video-1.mp4",
    "bilibili": {
      "title": "精彩视频评论合集",
      "description": "来自YouTube的热门评论",
      "tags": ["评论", "精选"],
      "category": "汽车"
    },
    "douyin": {
      "title": "精彩视频评论合集",
      "description": "来自YouTube的热门评论"
    }
  }'
```

**SSE 事件流示例**:

```
data: {"stage":"connecting","percent":0,"message":"正在连接B站..."}

data: {"stage":"done-bilibili","percent":50,"message":"✅ B站投稿成功！"}

data: {"stage":"connecting","percent":50,"message":"正在连接抖音..."}

data: {"stage":"done-douyin","percent":95,"message":"✅ 抖音发布成功！"}

event: done
data: {"results":{"bilibili":{"success":true},"douyin":{"success":true}}}
```

---

## 四、任务管理

管理视频从下载到发布的完整生命周期。任务数据以 JSON 文件存储在本地（`data/tasks.json`），自动清理超过 7 天的任务。

**核心设计：任务 ID = 视频 ID。** 任务的 `id` 字段直接使用 YouTube 视频 ID（如 `Dt-s1q3K7P0`），无需额外的独立 ID。同一个视频只会对应一个任务，重复创建会自动合并（upsert）。

服务启动时会自动同步：将旧格式的任务 ID 迁移为视频 ID，去重合并同视频的多条记录，并检查 `out/` 目录下已有输出文件，自动修正渲染状态。

### 任务数据结构

```json
{
  "id": "Dt-s1q3K7P0",
  "originalUrl": "https://www.youtube.com/watch?v=Dt-s1q3K7P0",
  "requirement": "重复5次",
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
      "category": "科技",
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
| `"queued"` | 已排队等待渲染 |
| `"rendering"` | 渲染中 |
| `"completed"` | 渲染完成 |
| `"failed"` | 渲染失败 |

**发布状态** (`publishStatus`): 按平台分别记录，每个平台包含 `title`、`description`、`published`，B站额外包含 `tags`（string[]）和 `category`（string，可选）。

**任务完成条件**: 下载全部完成 + 翻译完成（或无需翻译）+ 渲染完成 + 所有配置的平台已发布。

---

### 4.1 创建任务

如果同一视频 ID 的任务已存在，会更新（upsert）现有任务而非创建重复记录。

```
POST /api/tasks
```

**请求体**:

```json
{
  "originalUrl": "https://www.youtube.com/watch?v=xxx",
  "requirement": "重复5次",
  "initialStatus": {
    "downloadStatus": { "video": false, "subtitles": false, "comments": false },
    "renderStatus": "pending"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `originalUrl` | string | 是 | 原始视频链接（必须包含 YouTube 视频 ID，否则返回 500） |
| `requirement` | string | 否 | 处理要求说明 |
| `initialStatus` | object | 否 | 初始状态，未指定的字段使用默认值 |

**示例**:

```bash
curl -X POST http://localhost:6688/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"originalUrl": "https://www.youtube.com/watch?v=Dt-s1q3K7P0"}'
```

**响应**:

```json
{
  "success": true,
  "task": {
    "id": "Dt-s1q3K7P0",
    "originalUrl": "https://www.youtube.com/watch?v=Dt-s1q3K7P0",
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
| `status` | string | 按渲染状态过滤: `pending` / `queued` / `rendering` / `completed` / `failed` |
| `platform` | string | 按发布平台过滤: `bilibili` / `douyin` |
| `published` | string | 按发布状态过滤: `true` / `false` |
| `since` | number | 只返回指定时间戳之后更新的任务 |

**示例 — 查询所有任务**:

```bash
curl http://localhost:6688/api/tasks
```

**响应**:

```json
{
  "tasks": [
    {
      "id": "Dt-s1q3K7P0",
      "originalUrl": "https://www.youtube.com/watch?v=Dt-s1q3K7P0",
      "downloadStatus": { "video": true, "subtitles": true, "comments": true },
      "translationStatus": { "subtitles": "translated", "comments": "translated" },
      "renderStatus": "completed",
      "publishStatus": {
        "douyin": { "title": "视频标题", "description": "描述", "published": true }
      },
      "createdAt": 1714567890123,
      "updatedAt": 1714567950000
    }
  ],
  "total": 1,
  "pending": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `tasks` | array | 任务列表，按更新时间倒序排列 |
| `total` | number | 任务总数 |
| `pending` | number | 未完成任务数 |

**示例 — 按渲染状态过滤**:

```bash
curl "http://localhost:6688/api/tasks?status=pending"
```

**示例 — 按平台过滤**:

```bash
curl "http://localhost:6688/api/tasks?platform=bilibili"
```

**示例 — 组合过滤**:

```bash
curl "http://localhost:6688/api/tasks?platform=douyin&published=false"
```

---

### 4.3 查询特定任务

通过视频 ID 查询单个任务的详细状态，包含完成判定和进度百分比。

```
GET /api/tasks/:videoId
```

**示例**:

```bash
curl http://localhost:6688/api/tasks/Dt-s1q3K7P0
```

**响应**:

```json
{
  "success": true,
  "task": {
    "id": "Dt-s1q3K7P0",
    "originalUrl": "https://www.youtube.com/watch?v=Dt-s1q3K7P0",
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

通过视频 ID 更新指定任务的下载或翻译状态。更新的字段会与已有数据合并。

```
PUT /api/tasks/:videoId
```

**请求体**:

```json
{
  "updates": {
    "downloadStatus": { "video": true },
    "translationStatus": { "subtitles": "translated", "comments": "translated" }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `updates.downloadStatus` | object | 否 | 合并更新下载状态，只需传变化的字段 |
| `updates.translationStatus` | object | 否 | 合并更新翻译状态 |

注意：`renderStatus` 和 `publishStatus` 由系统内部自动管理（渲染/发布接口自动更新），不支持通过此接口手动修改。

**示例 — 标记下载完成**:

```bash
curl -X PUT http://localhost:6688/api/tasks/Dt-s1q3K7P0 \
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

**示例 — 标记翻译完成**:

```bash
curl -X PUT http://localhost:6688/api/tasks/Dt-s1q3K7P0 \
  -H "Content-Type: application/json" \
  -d '{"updates":{"translationStatus":{"subtitles":"not-needed","comments":"translated"}}}'
```

---

### 4.5 删除任务

通过视频 ID 删除指定任务。

```
DELETE /api/tasks/:videoId
```

**示例**:

```bash
curl -X DELETE http://localhost:6688/api/tasks/Dt-s1q3K7P0
```

**成功响应**:

```json
{ "success": true }
```

---

### 4.6 清除所有任务

删除所有任务数据。

```
DELETE /api/tasks
```

**示例**:

```bash
curl -X DELETE http://localhost:6688/api/tasks
```

**响应**:

```json
{
  "success": true,
  "removedCount": 11
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `removedCount` | number | 被删除的任务数量 |

---

### 4.7 获取任务统计

返回所有任务的汇总统计信息。

```
GET /api/tasks/stats
```

**示例**:

```bash
curl http://localhost:6688/api/tasks/stats
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
| `pending` | number | 待处理（渲染状态为 pending 或 queued） |
| `inProgress` | number | 进行中（渲染中或渲染完成但未全部完成） |
| `completed` | number | 已全部完成 |
| `failed` | number | 渲染失败 |
| `byPlatform.bilibili.published` | number | B站已发布数 |
| `byPlatform.bilibili.pending` | number | B站待发布数 |
| `byPlatform.douyin.published` | number | 抖音已发布数 |
| `byPlatform.douyin.pending` | number | 抖音待发布数 |

---

### 4.8 手动清理过期任务

手动触发清理超过 7 天的任务。正常情况下每次查询时会自动清理，此接口用于主动触发。

```
POST /api/tasks/cleanup
```

**示例**:

```bash
curl -X POST http://localhost:6688/api/tasks/cleanup
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

BASE = "http://localhost:6688"

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
        if event == "done":
            video_path = payload["outputPath"]
            print(f"渲染完成: {video_path}")
        elif event == "error":
            print(f"失败: {payload['error']}")
        elif event == "stopped":
            print(f"已停止: {payload['message']}")
        else:
            # 进度更新（纯 data 行）
            print(f"[{payload['percent']}%] {payload['message']}")

# 2. 发布到 B站（发布状态会自动更新到 video ID 对应的任务）
resp = requests.post(f"{BASE}/api/publish",
    json={
        "videoPath": video_path,
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
const BASE = "http://localhost:6688";

// 创建任务（任务 ID = 视频 ID，重复创建会自动更新）
const { task } = await fetch(`${BASE}/api/tasks`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    originalUrl: "https://www.youtube.com/watch?v=Dt-s1q3K7P0",
    requirement: "重复5次"
  })
}).then(r => r.json());
console.log(`任务ID: ${task.id}`); // "Dt-s1q3K7P0"

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

// 渲染（自动更新任务 renderStatus，无需传 taskId）
await fetch(`${BASE}/api/render/${task.id}`, {
  method: "POST",
  headers: { "Accept": "text/event-stream" }
});

// 获取统计
const stats = await fetch(`${BASE}/api/tasks/stats`).then(r => r.json());
console.log(`总任务: ${stats.total}, 已完成: ${stats.completed}`);

// 清除所有任务
await fetch(`${BASE}/api/tasks`, { method: "DELETE" });
```
