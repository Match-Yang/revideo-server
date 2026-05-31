import fs from "fs";
import path from "path";
import type { DirInfo } from "../types";
import { render, renderWithFFmpeg, type RenderProgress } from "../renderer";
import type { RevideoJob } from "./types";
import type { RevideoSettings } from "../settings";

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
  const bilingual = settings.production?.bilingualSubtitles ?? false;

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

export async function renderJob(
  job: RevideoJob,
  onProgress?: (progress: RenderProgress) => void,
  signal?: AbortSignal
): Promise<JobRenderResult> {
  const dirInfo = buildJobDirInfo(job);
  const settings = (job.settingsSnapshot || {}) as Partial<RevideoSettings>;
  const useComments = job.options.renderComments !== undefined
    ? job.options.renderComments
    : settings.production?.renderComments !== false;
  const result = useComments
    ? await render(dirInfo, onProgress, signal)
    : await renderWithFFmpeg(dirInfo, onProgress, signal);
  const outputPath = path.resolve(process.cwd(), result.output);
  const coverPath = path.resolve(process.cwd(), "out", `${job.id}-cover.jpg`);

  return {
    outputPath,
    coverPath: fs.existsSync(coverPath) ? coverPath : undefined,
    durationSec: result.durationSec,
  };
}
