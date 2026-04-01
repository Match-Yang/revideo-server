import express from "express";
import path from "path";
import fs from "fs";
import { getDirs, getDirByName, render } from "./renderer";

const app = express();
const PORT = 3001;

app.use(express.json());

// Serve static UI files
const uiDir = path.join(__dirname, "ui");
app.use(express.static(uiDir));

// Serve rendered output files
const outDir = path.join(process.cwd(), "out");
app.use("/out", express.static(outDir));

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

// Start rendering
app.post("/api/render/:dirName", (req, res) => {
  const { dirName } = req.params;
  const dir = getDirByName(dirName);

  if (!dir) {
    res.status(404).json({ error: `目录不存在: ${dirName}` });
    return;
  }

  try {
    const result = render(dir);
    res.json({ success: true, output: result.output, durationSec: result.durationSec });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`\n  视频渲染UI已启动: http://localhost:${PORT}\n`);
});
