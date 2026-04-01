import fs from "fs";
import path from "path";
import type { DirInfo } from "./types";

function getMoviesDir(): string {
  return path.join(process.env.HOME || "/Users/auto", "Movies");
}

const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".mov"];
const AUDIO_EXTS = [".mp3", ".m4a", ".wav", ".aac"];
const COMMENT_EXTS = [".json"];
const SUBTITLE_EXTS = [".srt", ".vtt"];

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

    const files = fs.readdirSync(fullPath);
    const dirInfo: DirInfo = {
      name: entry,
      path: fullPath,
      audioFiles: [],
      subtitleFiles: [],
    };

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const filePath = path.join(fullPath, file);

      if (VIDEO_EXTS.includes(ext) && !dirInfo.videoFile) {
        dirInfo.videoFile = filePath;
      } else if (AUDIO_EXTS.includes(ext)) {
        dirInfo.audioFiles.push(filePath);
      } else if (COMMENT_EXTS.includes(ext)) {
        dirInfo.commentFile = filePath;
      } else if (SUBTITLE_EXTS.includes(ext)) {
        dirInfo.subtitleFiles.push(filePath);
      }
    }

    // Only include directories that have at least a video file
    if (dirInfo.videoFile) {
      results.push(dirInfo);
    }
  }

  return results;
}
