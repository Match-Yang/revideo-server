import fs from "fs";
import path from "path";
import type { DirInfo } from "./types";

function getMoviesDir(): string {
  return path.join(process.env.HOME || "/Users/auto", "Movies");
}

const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".mov"];
const AUDIO_EXTS = [".mp3", ".m4a", ".wav", ".aac"];
const SUBTITLE_EXTS = [".srt", ".vtt"];

export function scanDir(dirPath: string): DirInfo | null {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return null;
  }

  const name = path.basename(resolved);
  const files = fs.readdirSync(resolved);
  const dirInfo: DirInfo = {
    name,
    path: resolved,
    audioFiles: [],
    subtitleFiles: [],
  };

  // Only pick comments.json — nothing else
  const commentsPath = path.join(resolved, "comments.json");
  if (fs.existsSync(commentsPath)) {
    dirInfo.commentFile = commentsPath;
  }

  const allSubtitles: { filePath: string; isZh: boolean }[] = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const filePath = path.join(resolved, file);

    if (VIDEO_EXTS.includes(ext) && !dirInfo.videoFile) {
      dirInfo.videoFile = filePath;
    } else if (AUDIO_EXTS.includes(ext)) {
      dirInfo.audioFiles.push(filePath);
    } else if (SUBTITLE_EXTS.includes(ext)) {
      allSubtitles.push({ filePath, isZh: /zh/i.test(file) });
    }
  }

  // Prefer zh subtitles, keep only one
  allSubtitles.sort((a, b) => (b.isZh ? 1 : 0) - (a.isZh ? 1 : 0));
  if (allSubtitles.length > 0) {
    dirInfo.subtitleFiles = [allSubtitles[0].filePath];
  }

  return dirInfo.videoFile ? dirInfo : null;
}

export function scanMoviesDir(): DirInfo[] {
  const moviesDir = getMoviesDir();
  const results: DirInfo[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(moviesDir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(moviesDir, entry);
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) continue;

    const dirInfo = scanDir(fullPath);
    if (dirInfo) {
      results.push(dirInfo);
    }
  }

  return results;
}
