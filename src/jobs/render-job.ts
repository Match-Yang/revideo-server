import fs from "fs";
import path from "path";
import type { DirInfo } from "../types";
import { renderWithFFmpeg, type RenderProgress, type RenderConfig } from "../renderer";
import type { RevideoJob } from "./types";
import { defaultRenderDir, type RevideoSettings } from "../settings";
import type { CommentRenderStyle, SizeName, LineHeightName, LongCommentBehavior } from "../renderers/ffmpeg-comments";

const COMMENT_STYLE = "classic-dark";
const COMMENT_SPEED = "standard";

export interface JobRenderResult {
  outputPath: string;
  coverPath?: string;
  durationSec: number;
}

function pickSubtitle(subtitlePaths: string[], bilingual?: boolean): string[] {
  if (bilingual) {
    const bi = subtitlePaths.find((file) => path.basename(file).includes(".bilingual."));
    if (bi) return [bi];
  }
  const zh = subtitlePaths.find((file) => /zh|cn|chinese/i.test(path.basename(file)));
  return zh ? [zh] : subtitlePaths.slice(0, 1);
}

export function buildJobDirInfo(job: RevideoJob): DirInfo {
  const normalized = job.source.metadata?.normalizedAssets as
    | {
        mediaPath?: string;
        normalizedCommentsPath?: string;
        subtitlePaths?: string[];
      }
    | undefined;
  const translation = job.source.metadata?.translation as
    | {
        comments?: { outputPath?: string };
        subtitles?: { outputPaths?: string[] };
      }
    | undefined;

  const mediaPath = normalized?.mediaPath;
  if (!mediaPath || !fs.existsSync(mediaPath)) {
    throw new Error("Job does not have a normalized mediaPath");
  }

  const settings = (job.settingsSnapshot || {}) as Partial<RevideoSettings>;
  const bilingual = job.options.bilingualSubtitles ?? settings.task?.translation?.bilingualSubtitles ?? false;

  return {
    name: job.id,
    path: job.artifacts.rootDir,
    videoFile: mediaPath,
    audioFiles: [],
    commentFile:
      translation?.comments?.outputPath && fs.existsSync(translation.comments.outputPath)
        ? translation.comments.outputPath
        : normalized?.normalizedCommentsPath && fs.existsSync(normalized.normalizedCommentsPath)
          ? normalized.normalizedCommentsPath
          : undefined,
    subtitleFiles: pickSubtitle(
      translation?.subtitles?.outputPaths?.length
        ? translation.subtitles.outputPaths
        : normalized?.subtitlePaths || [],
      bilingual,
    ),
    repeatTimes: job.options.repeatTimes,
  };
}

function buildRenderConfig(job: RevideoJob): RenderConfig {
  const settings = (job.settingsSnapshot || {}) as Partial<RevideoSettings>;
  const r = settings.task?.render;
  const p = settings.task?.prepare;
  const outputAspect = job.options.outputAspect || p?.outputAspect || "portrait";
  const outputResolution = job.options.outputResolution || p?.outputResolution || "auto";
  const resolution = parseResolution(outputResolution, outputAspect);
  const dimensions = resolution || aspectDimensions(outputAspect);
  const style: CommentRenderStyle = {
    width: dimensions.width,
    height: dimensions.height,
    style: COMMENT_STYLE,
    fontSize: (r?.commentFontSize as SizeName | undefined) || "medium",
    lineHeight: (r?.commentLineHeight as LineHeightName | undefined) || "standard",
    speed: COMMENT_SPEED,
    longCommentBehavior: (r?.longCommentBehavior as LongCommentBehavior | undefined) || "wrap",
    subtitleFontSize: (r?.subtitleFontSize as SizeName | undefined) || "medium",
    subtitleLineHeight: (r?.subtitleLineHeight as LineHeightName | undefined) || "standard",
  };
  return {
    style,
    outputFormat: (r?.outputFormat as "mp4" | "mov" | undefined) || "mp4",
    outputAspect,
    outputResolution,
    fitMode: p?.fitMode || "smart-crop",
    subtitleFontSize: style.subtitleFontSize,
    subtitleLineHeight: style.subtitleLineHeight,
  };
}

function resolutionTier(value: string | undefined): number | undefined {
  if (!value || value === "auto" || value === "best") return undefined;
  const named: Record<string, number> = {
    "8k": 4320,
    "4k": 2160,
    "2k": 1440,
  };
  const tier = named[value.toLowerCase()] ?? Number(value.match(/^(\d+)p$/i)?.[1]);
  return Number.isFinite(tier) && tier > 0 ? tier : undefined;
}

function parseResolution(value: string | undefined, aspect: string | undefined): { width: number; height: number } | undefined {
  if (!value || value === "auto") return undefined;
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (match) return { width: Number(match[1]), height: Number(match[2]) };
  const tier = resolutionTier(value);
  if (!tier) return undefined;
  if (aspect === "landscape") return { width: Math.round((tier * 16) / 9), height: tier };
  if (aspect === "source" || aspect === "auto") return undefined;
  return { width: tier, height: Math.round((tier * 16) / 9) };
}

function aspectDimensions(value: string | undefined): { width: number; height: number } {
  if (value === "landscape") return { width: 1920, height: 1080 };
  return { width: 1080, height: 1920 };
}

export async function renderJob(
  job: RevideoJob,
  onProgress?: (progress: RenderProgress) => void,
  signal?: AbortSignal
): Promise<JobRenderResult> {
  const dirInfo = buildJobDirInfo(job);
  const settings = (job.settingsSnapshot || {}) as Partial<RevideoSettings>;
  const useComments = job.options.renderComments !== undefined
    ? job.options.renderComments
    : settings.task?.render?.renderComments !== false;
  const outputDir = settings.task?.render?.outputDir || defaultRenderDir();
  const renderConfig = buildRenderConfig(job);
  const result = await renderWithFFmpeg(
    useComments ? dirInfo : { ...dirInfo, commentFile: undefined },
    onProgress,
    signal,
    outputDir,
    renderConfig,
  );
  // result.output is now an absolute path (set by renderWithFFmpeg)
  const outputPath = result.output;
  const coverPath = path.join(outputDir, `${job.id}-cover.jpg`);

  return {
    outputPath,
    coverPath: fs.existsSync(coverPath) ? coverPath : undefined,
    durationSec: result.durationSec,
  };
}
