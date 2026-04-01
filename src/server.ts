import express from "express";
import path from "path";
import { getDirs, getDirByName, render } from "./renderer";

const app = express();
const PORT = 3001;

app.use(express.json());

// Serve static UI files
const uiDir = path.join(__dirname, "ui");
app.use(express.static(uiDir));

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
