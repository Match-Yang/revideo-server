import fs from "fs";
import path from "path";
import type { RevideoJob } from "./types";
import { loadSettings, type RevideoSettings } from "../settings";
import { normalizeShortWebVttCues, normalizeYouTubeRollingWebVtt, serializeWebVttCues } from "../subtitles/normalize";

const COMMENT_CLEANUP = ["dedupe", "drop-empty"] as const;

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

function getJobSettings(job: RevideoJob): RevideoSettings {
  const snapshot = job.settingsSnapshot as RevideoSettings | undefined;
  if (snapshot?.task?.prepare) return snapshot;
  return loadSettings();
}

function normalizeCommentList(comments: unknown[]): unknown[] {
  let next = comments.filter((comment) => {
    const text = typeof (comment as { text?: unknown }).text === "string" ? (comment as { text: string }).text.trim() : "";
    return text.length > 0;
  });

  if (COMMENT_CLEANUP.includes("dedupe")) {
    const seen = new Set<string>();
    next = next.filter((comment) => {
      const item = comment as { text?: unknown; author_id?: unknown; author?: unknown };
      const key = `${String(item.author_id || item.author || "")}\u0000${String(item.text || "").trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return next;
}

function normalizeSubtitleFile(source: string, target: string, cleanup: RevideoSettings["task"]["prepare"]["subtitleCleanup"]): void {
  if (cleanup !== "merge-short" || !/\.vtt$/i.test(source)) {
    copyIfDifferent(source, target);
    return;
  }
  const content = fs.readFileSync(source, "utf-8");
  const cues = normalizeYouTubeRollingWebVtt(content) || normalizeShortWebVttCues(content);
  if (!cues) {
    copyIfDifferent(source, target);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serializeWebVttCues(cues));
}

export function normalizeJobAssets(job: RevideoJob): NormalizedAssets {
  const settings = getJobSettings(job);
  const prepare = settings.task.prepare;
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
      const comments = normalizeCommentList(rawInfo.comments);
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
            comments,
          },
          null,
          2
        )
      );
    }
  }

  const canonicalSubtitlePaths = subtitlePaths.map((subtitlePath) => {
    const target = path.join(job.artifacts.sourceDir, "subtitles", path.basename(subtitlePath));
    normalizeSubtitleFile(subtitlePath, target, prepare.subtitleCleanup);
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
