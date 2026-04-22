# 渲染 API 使用文档

## 概述

渲染 API 提供两种接口：按目录名称渲染和按文件夹路径渲染。支持 **SSE（Server-Sent Events）** 实时进度推送，适合长时间渲染场景。

- 默认返回 JSON（向后兼容）
- 请求头加 `Accept: text/event-stream` 即切换为 SSE 模式，实时接收进度

---

## 接口列表

### 1. 按目录名称渲染

渲染 `~/Movies` 下的视频目录。

```
POST /api/render/:dirName
```

### 2. 按文件夹路径渲染

渲染任意路径的视频文件夹。

```
POST /api/render-folder
Body: { "folder": "/absolute/path/to/folder" }
```

---

## 使用方式

### curl — 普通 JSON 模式（等待完成后一次性返回）

```bash
# 按目录名称
curl -X POST http://localhost:3001/api/render/my-video

# 按文件夹路径
curl -X POST http://localhost:3001/api/render-folder \
  -H "Content-Type: application/json" \
  -d '{"folder": "/Users/auto/Movies/my-video"}'
```

**成功响应：**

按目录名称：
```json
{
  "success": true,
  "output": "out/my-video.mp4",
  "durationSec": 60.0
}
```

按文件夹路径：
```json
{
  "outputPath": "/Users/auto/code/copy-video/out/my-video.mp4"
}
```

**失败响应：**
```json
{
  "error": "错误信息"
}
```

### curl — SSE 进度模式（实时接收进度）

加 `-N` 禁用缓冲，加 `Accept: text/event-stream` 请求头：

```bash
# 按目录名称（带进度）
curl -N -X POST http://localhost:3001/api/render/my-video \
  -H "Accept: text/event-stream"

# 按文件夹路径（带进度）
curl -N -X POST http://localhost:3001/api/render-folder \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"folder": "/Users/auto/Movies/my-video"}'
```

**SSE 事件流示例：**

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
data: {"stage":"rendering","percent":53,"message":"渲染中 50% 900/1800 帧"}

event: progress
data: {"stage":"rendering","percent":74,"message":"渲染中 75% 1350/1800 帧"}

event: progress
data: {"stage":"rendering","percent":95,"message":"渲染中 100% 1800/1800 帧"}

event: progress
data: {"stage":"extracting-cover","percent":96,"message":"提取封面..."}

event: progress
data: {"stage":"done","percent":100,"message":"渲染完成"}

event: done
data: {"success":true,"output":"out/my-video.mp4","durationSec":60}
```

**错误情况：**

```
event: error
data: {"error":"Remotion 渲染失败 (退出码 1)"}
```

---

## SSE 事件类型

| 事件 | 说明 |
|------|------|
| `progress` | 进度更新，包含 `stage`、`percent`、`message` |
| `done` | 渲染完成，包含输出路径和时长 |
| `error` | 渲染失败，包含错误信息 |

### progress 事件字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `stage` | string | 当前阶段：`preparing` / `downloading-avatars` / `rendering` / `extracting-cover` / `done` |
| `percent` | number | 总体进度 0-100 |
| `message` | string | 人类可读的进度描述 |

### 进度阶段说明

| 阶段 | 百分比范围 | 说明 |
|------|-----------|------|
| `preparing` | 0% | 复制视频、字幕、评论文件到工作目录 |
| `downloading-avatars` | 5% | 下载评论者头像 |
| `rendering` | 10%-95% | Remotion 渲染视频（最耗时） |
| `extracting-cover` | 96% | 用 ffmpeg 提取封面图 |
| `done` | 100% | 全部完成 |

---

## 代码集成示例

### Python（requests + SSE）

```python
import requests
import json

url = "http://localhost:3001/api/render-folder"
headers = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
}
data = {"folder": "/Users/auto/Movies/my-video"}

response = requests.post(url, json=data, headers=headers, stream=True)

for line in response.iter_lines(decode_unicode=True):
    if not line:
        continue
    if line.startswith("event: "):
        event = line[7:]
    elif line.startswith("data: "):
        payload = json.loads(line[6:])
        if event == "progress":
            print(f"[{payload['percent']}%] {payload['message']}")
        elif event == "done":
            print(f"完成: {payload}")
        elif event == "error":
            print(f"失败: {payload['error']}")
```

### Node.js

```javascript
const response = await fetch("http://localhost:3001/api/render/my-video", {
  method: "POST",
  headers: { Accept: "text/event-stream" },
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  const events = buffer.split("\n\n");
  buffer = events.pop();

  for (const event of events) {
    let eventName = "", data = "";
    for (const line of event.split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice(7);
      else if (line.startsWith("data: ")) data = JSON.parse(line.slice(6));
    }
    if (eventName === "progress") {
      console.log(`[${data.percent}%] ${data.message}`);
    } else if (eventName === "done") {
      console.log("完成:", data);
    } else if (eventName === "error") {
      console.error("失败:", data.error);
    }
  }
}
```

---

## 其他接口

### 获取可用目录列表

```bash
curl http://localhost:3001/api/dirs
```

```json
[
  { "name": "video-1", "hasComments": true, "hasSubtitles": false },
  { "name": "video-2", "hasComments": false, "hasSubtitles": true }
]
```

### 预览源视频

```bash
curl http://localhost:3001/api/preview/my-video -o preview.mp4
```
