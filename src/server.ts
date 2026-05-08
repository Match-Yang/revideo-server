import express from "express";
import path from "path";
import fs from "fs";
import { getDirs, getDirByName, render, preparePublicDir } from "./renderer";
import { scanDir } from "./scan-dir";
import { publish, type PublishRequest } from "./publish";
import {
  createTask,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
  getTaskStatistics,
  isTaskComplete,
  getTaskProgress,
  cleanupExpiredTasks,
} from "./task-manager";
import type { AddTaskRequest, UpdateTaskRequest, TaskFilter } from "./types";

const app = express();
const PORT = 3001;

app.use(express.json());

// SSE helpers
function isSSERequest(req: express.Request): boolean {
  return req.headers.accept?.includes("text/event-stream") === true;
}

function setupSSE(res: express.Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  return {
    sendProgress(data: any) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    sendEvent(event: string, data: any) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() { res.end(); },
  };
}

// Serve static UI files
const ui_dir = path.join(__dirname, "ui");
app.use(express.static(ui_dir));

// Serve rendered output files
const outDir = path.join(process.cwd(), "out");
app.use("/out", express.static(outDir));

// ============================================================
// Agent API: single endpoint to render a video folder
// POST /api/render-folder
// Body: { "folder": "/absolute/path/to/folder" }
// Returns: { "outputPath": "/full/system/path/to/output.mp4" }
// ============================================================
app.post("/api/render-folder", async (req, res) => {
  const { folder } = req.body;
  if (!folder || typeof folder !== "string") {
    res.status(400).json({ error: "Missing or invalid 'folder' field in request body" });
    return;
  }

  const dir = scanDir(folder);
  if (!dir) {
    res.status(404).json({ error: `No video file found in: ${folder}` });
    return;
  }

  console.log(`[Agent API] Rendering: ${dir.path}`);

  if (isSSERequest(req)) {
    const sse = setupSSE(res);
    try {
      const result = await render(dir, (p) => sse.sendProgress(p));
      const outputPath = path.resolve(process.cwd(), result.output);
      console.log(`[Agent API] Done: ${outputPath}`);
      sse.sendEvent("done", { outputPath });
    } catch (err: any) {
      console.error(`[Agent API] Error: ${err?.message || err}`);
      sse.sendEvent("error", { error: err?.message || String(err) });
    }
    sse.end();
  } else {
    try {
      const result = await render(dir);
      const outputPath = path.resolve(process.cwd(), result.output);
      console.log(`[Agent API] Done: ${outputPath}`);
      res.json({ outputPath });
    } catch (err: any) {
      console.error(`[Agent API] Error: ${err?.message || err}`);
      res.status(500).json({ error: err?.message || String(err) });
    }
  }
});

// Prepare public dir for Remotion Studio preview
app.post("/api/prepare/:dirName", (_req, res) => {
  const dir = getDirByName(_req.params.dirName);
  if (!dir) {
    res.status(404).json({ error: "目录不存在" });
    return;
  }
  try {
    preparePublicDir(dir);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Get available directories
app.get("/api/dirs", (_req, res) => {
  try {
    const dirs = getDirs();
    res.json(
      dirs.map((d) => ({
        name: d.name,
        hasComments: !!d.commentFile,
        hasSubtitles: d.subtitleFiles.length > 0,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Serve source video for preview
app.get("/api/preview/:dirName", (req, res) => {
  const dir = getDirByName(req.params.dirName);
  if (!dir || !dir.videoFile) {
    res.status(404).json({ error: "视频不存在" });
    return;
  }
  const videoPath = dir.videoFile;
  if (!fs.existsSync(videoPath)) {
    res.status(404).json({ error: "视频文件不存在" });
    return;
  }
  const stat = fs.statSync(videoPath);
  const ext = path.extname(videoPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };
  res.setHeader("Content-Type", mimeMap[ext] || "video/mp4");
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(videoPath).pipe(res);
});

// Start rendering (by dir name under ~/Movies)
app.post("/api/render/:dirName", async (req, res) => {
  const { dirName } = req.params;
  const dir = getDirByName(dirName);

  if (!dir) {
    res.status(404).json({ error: `目录不存在: ${dirName}` });
    return;
  }

  if (isSSERequest(req)) {
    const sse = setupSSE(res);
    try {
      const result = await render(dir, (p) => sse.sendProgress(p));
      sse.sendEvent("done", { success: true, output: result.output, durationSec: result.durationSec });
    } catch (err: any) {
      sse.sendEvent("error", { error: err?.message || String(err) });
    }
    sse.end();
  } else {
    try {
      const result = await render(dir);
      res.json({ success: true, output: result.output, durationSec: result.durationSec });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  }
});

// ============================================================
// Agent API: publish video to platforms
// POST /api/publish
// Body: { videoPath, platforms, bilibili?, douyin?, cdpEndpoint? }
// Returns: SSE stream with progress events
// ============================================================
app.post("/api/publish", async (req, res) => {
  const body = req.body as PublishRequest;

  if (!body.videoPath || !body.platforms?.length) {
    res.status(400).json({ error: "Missing videoPath or platforms" });
    return;
  }

  console.log(`[Publish API] Publishing ${body.videoPath} to ${body.platforms.join(", ")}`);

  const markTaskPublished = async (results: Record<string, { success: boolean; error?: string }>) => {
    if (!body.taskId) return;
    const task = getTaskById(body.taskId);
    if (!task) {
      console.warn(`[Publish API] Task ${body.taskId} not found, skipping status update`);
      return;
    }

    const publishStatus = { ...task.publishStatus };
    if (results.bilibili?.success) {
      publishStatus.bilibili = {
        title: body.bilibili?.title || "",
        description: body.bilibili?.description || "",
        tags: body.bilibili?.tags || [],
        category: body.bilibili?.category,
        published: true,
      };
    }
    if (results.douyin?.success) {
      publishStatus.douyin = {
        title: body.douyin?.title || "",
        description: body.douyin?.description || "",
        published: true,
      };
    }

    updateTask(body.taskId, { publishStatus });
    console.log(`[Publish API] Task ${body.taskId} publish status updated`);
  };

  if (isSSERequest(req)) {
    const sse = setupSSE(res);
    try {
      const results = await publish(body, (p) => sse.sendProgress(p));
      await markTaskPublished(results);
      sse.sendEvent("done", { results });
      console.log(`[Publish API] Done:`, JSON.stringify(results));
    } catch (err: any) {
      console.error(`[Publish API] Error: ${err?.message || err}`);
      sse.sendEvent("error", { error: err?.message || String(err) });
    }
    sse.end();
  } else {
    try {
      const results = await publish(body, () => {});
      await markTaskPublished(results);
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  }
});

// ============================================================
// Task Management API
// ============================================================

// Create a new publish task
app.post("/api/tasks", (req, res) => {
  try {
    const { originalUrl, requirement, initialStatus } = req.body as AddTaskRequest;
    if (!originalUrl) {
      res.status(400).json({ error: "originalUrl is required" });
      return;
    }
    const task = createTask(originalUrl, requirement, initialStatus);
    res.json({ success: true, task });
  } catch (err) {
    console.error("[Tasks API] Error creating task:", err);
    res.status(500).json({ error: String(err) });
  }
});

// List tasks (with optional filters)
app.get("/api/tasks", (req, res) => {
  try {
    const filter: TaskFilter = {};
    if (req.query.status) filter.status = req.query.status as any;
    if (req.query.platform) filter.platform = req.query.platform as any;
    if (req.query.published !== undefined)
      filter.published = req.query.published === "true";
    if (req.query.since)
      filter.since = parseInt(req.query.since as string);

    const tasks = getAllTasks(filter);
    const pending = tasks.filter((t) => !isTaskComplete(t)).length;

    res.json({ tasks, total: tasks.length, pending });
  } catch (err) {
    console.error("[Tasks API] Error fetching tasks:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Get a specific task
app.get("/api/tasks/stats", (_req, res) => {
  try {
    const stats = getTaskStatistics();
    res.json(stats);
  } catch (err) {
    console.error("[Tasks API] Error fetching statistics:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/tasks/:taskId", (req, res) => {
  try {
    const task = getTaskById(req.params.taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({
      success: true,
      task,
      isCompleted: isTaskComplete(task),
      progress: getTaskProgress(task),
    });
  } catch (err) {
    console.error("[Tasks API] Error fetching task:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Update a task
app.put("/api/tasks/:taskId", (req, res) => {
  try {
    const { updates } = req.body as UpdateTaskRequest;
    if (!updates) {
      res.status(400).json({ error: "updates field is required" });
      return;
    }
    const task = updateTask(req.params.taskId, updates);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({
      success: true,
      task,
      isCompleted: isTaskComplete(task),
      progress: getTaskProgress(task),
    });
  } catch (err) {
    console.error("[Tasks API] Error updating task:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Delete a task
app.delete("/api/tasks/:taskId", (req, res) => {
  try {
    const success = deleteTask(req.params.taskId);
    if (!success) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Tasks API] Error deleting task:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Manual cleanup of expired tasks
app.post("/api/tasks/cleanup", (_req, res) => {
  try {
    const removedCount = cleanupExpiredTasks();
    res.json({ success: true, removedCount });
  } catch (err) {
    console.error("[Tasks API] Error cleaning up tasks:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`\n  视频渲染服务已启动: http://localhost:${PORT}`);
  console.log(`  Agent API: POST /api/render-folder  { "folder": "/path/to/video/folder" }`);
  console.log(`  Agent API: POST /api/publish        { "videoPath": "...", "platforms": ["bilibili","douyin"] }`);
  console.log(`  Task API:   GET/POST/PUT/DELETE /api/tasks\n`);
});
