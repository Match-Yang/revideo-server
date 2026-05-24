import fs from "fs";
import path from "path";
import type { RevideoJob } from "./types";

export interface NormalizedAssets {
  mediaPath?: string;
  sourceInfoPath?: string;
  rawCommentsPath?: string;
  normalizedCommentsPath?: string;
  subtitlePaths: string[];
  durationSec?: number;
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function copyIfDifferent(source: string, target: string): void {
  if (path.resolve(source) === path.resolve(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function detectMedia(files: string[]): string | undefined {
  return files.find((file) => /\.(mp4|mkv|webm|mov)$/i.test(file));
}

function detectInfo(files: string[]): string | undefined {
  return files.find((file) => /\.info\.json$/i.test(file));
}

function detectSubtitles(files: string[]): string[] {
  return files.filter((file) => /\.(vtt|srt)$/i.test(file));
}

export function normalizeJobAssets(job: RevideoJob): NormalizedAssets {
  const files = walkFiles(job.artifacts.sourceDir);
  const mediaPath = detectMedia(files);
  const infoPath = detectInfo(files);
  const subtitlePaths = detectSubtitles(files);

  let sourceInfoPath: string | undefined;
  let rawCommentsPath: string | undefined;
  let normalizedCommentsPath: string | undefined;
  let durationSec: number | undefined;

  if (infoPath) {
    const rawInfo = JSON.parse(fs.readFileSync(infoPath, "utf-8")) as Record<string, unknown>;
    durationSec = typeof rawInfo.duration === "number" ? rawInfo.duration : undefined;

    sourceInfoPath = path.join(job.artifacts.sourceDir, "metadata", "source.json");
    copyIfDifferent(infoPath, sourceInfoPath);

    if (Array.isArray(rawInfo.comments)) {
      rawCommentsPath = path.join(job.artifacts.sourceDir, "comments", "raw.json");
      normalizedCommentsPath = path.join(job.artifacts.sourceDir, "comments", "normalized.json");
      fs.mkdirSync(path.dirname(rawCommentsPath), { recursive: true });
      fs.writeFileSync(rawCommentsPath, JSON.stringify(rawInfo.comments, null, 2));
      fs.writeFileSync(
        normalizedCommentsPath,
        JSON.stringify(
          {
            id: rawInfo.id,
            title: rawInfo.title,
            duration: durationSec,
            comments: rawInfo.comments,
          },
          null,
          2
        )
      );
    }
  }

  const canonicalSubtitlePaths = subtitlePaths.map((subtitlePath) => {
    const target = path.join(job.artifacts.sourceDir, "subtitles", path.basename(subtitlePath));
    copyIfDifferent(subtitlePath, target);
    return target;
  });

  return {
    mediaPath,
    sourceInfoPath,
    rawCommentsPath,
    normalizedCommentsPath,
    subtitlePaths: canonicalSubtitlePaths,
    durationSec,
  };
}
