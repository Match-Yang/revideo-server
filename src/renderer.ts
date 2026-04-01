import fs from "fs";
import path from "path";
import os from "os";
import { execSync, spawn } from "child_process";
import type { DirInfo } from "./types";
import { scanMoviesDir } from "./scan-dir";

const PUBLIC_DIR = path.join(process.cwd(), "public");

export interface RenderOptions {
  dirName: string;
}

function preparePublicDir(dir: DirInfo) {
  if (fs.existsSync(PUBLIC_DIR)) {
    fs.rmSync(PUBLIC_DIR, { recursive: true });
  }
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  // Copy video
  const videoExt = path.extname(dir.videoFile!);
  fs.copyFileSync(dir.videoFile!, path.join(PUBLIC_DIR, `video${videoExt}`));

  // Copy comment file
  if (dir.commentFile) {
    fs.copyFileSync(dir.commentFile, path.join(PUBLIC_DIR, "comments.json"));
  }

  // Copy subtitle files
  for (const subFile of dir.subtitleFiles) {
    fs.copyFileSync(subFile, path.join(PUBLIC_DIR, "subtitles.vtt"));
  }

  // Copy audio files
  for (const audioFile of dir.audioFiles) {
    const basename = path.basename(audioFile);
    fs.copyFileSync(audioFile, path.join(PUBLIC_DIR, basename));
  }
}

export function getDirs(): DirInfo[] {
  return scanMoviesDir();
}

export function getDirByName(name: string): DirInfo | undefined {
  return getDirs().find((d) => d.name === name);
}

export function render(dir: DirInfo): { output: string; durationSec: number } {
  preparePublicDir(dir);

  // Get duration from comments.json
  let durationSec = 60;
  if (dir.commentFile) {
    try {
      const data = JSON.parse(fs.readFileSync(dir.commentFile, "utf-8"));
      durationSec = data.duration || 60;
    } catch {}
  }

  const fps = 30;
  const totalFrames = Math.ceil(durationSec * fps);

  const videoExt = path.extname(dir.videoFile!);
  const props = {
    dirPath: dir.path,
    videoFile: `video${videoExt}`,
    commentFile: dir.commentFile ? "comments.json" : "",
    subtitleFiles: dir.subtitleFiles.length > 0 ? ["subtitles.vtt"] : [],
    durationInFrames: totalFrames,
  };

  const propsArg = JSON.stringify(JSON.stringify(props));

  // Ensure out dir exists
  const outDir = path.join(process.cwd(), "out");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  execSync(
    `npx remotion render VideoComments out/${dir.name}.mp4 ` +
      `--props '${propsArg}' ` +
      `--fps ${fps}`,
    {
      stdio: "pipe",
      cwd: process.cwd(),
    }
  );

  return { output: `out/${dir.name}.mp4`, durationSec };
}
