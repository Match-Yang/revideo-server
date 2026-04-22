import express from "express";
import path from "path";
import fs from "fs";
import { getDirs, getDirByName, render, preparePublicDir } from "./renderer";
import { scanDir } from "./scan-dir";
import { publish, type PublishRequest } from "./publish";

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

  if (isSSERequest(req)) {
    const sse = setupSSE(res);
    try {
      const results = await publish(body, (p) => sse.sendProgress(p));
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
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  }
});

app.listen(PORT, () => {
  console.log(`\n  视频渲染服务已启动: http://localhost:${PORT}`);
  console.log(`  Agent API: POST /api/render-folder  { "folder": "/path/to/video/folder" }`);
  console.log(`  Agent API: POST /api/publish        { "videoPath": "...", "platforms": ["bilibili","douyin"] }\n`);
});
