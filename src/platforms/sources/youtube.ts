import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { resolveCommand } from "../../dependencies";
import type {
  DownloadRequest,
  SourceAdapter,
  SourceAssetManifest,
  SourceFormat,
  SourceProbeResult,
} from "../types";

const YOUTUBE_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([^&?\s/]+)/;

function execFileText(
  command: string,
  args: string[],
  timeoutMs = 120000,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function extractYoutubeId(url: string): string | undefined {
  return url.match(YOUTUBE_ID_RE)?.[1];
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function normalizeFormat(format: Record<string, unknown>): SourceFormat {
  return {
    formatId: String(format.format_id || ""),
    ext: typeof format.ext === "string" ? format.ext : undefined,
    height: typeof format.height === "number" ? format.height : undefined,
    width: typeof format.width === "number" ? format.width : undefined,
    fps: typeof format.fps === "number" ? format.fps : undefined,
    vcodec: typeof format.vcodec === "string" ? format.vcodec : undefined,
    acodec: typeof format.acodec === "string" ? format.acodec : undefined,
    filesize: typeof format.filesize === "number" ? format.filesize : undefined,
    note: typeof format.format_note === "string" ? format.format_note : undefined,
  };
}

function pickRecommended(formats: SourceFormat[]): SourceProbeResult["recommended"] {
  const videoFormats = formats
    .filter((format) => format.formatId && format.height && format.vcodec !== "none")
    .sort((a, b) => {
      const aHeight = a.height || 0;
      const bHeight = b.height || 0;
      if (aHeight !== bHeight) return bHeight - aHeight;
      return (b.fps || 0) - (a.fps || 0);
    });

  const preferred = videoFormats.find((format) => (format.height || 0) <= 720) || videoFormats[0];
  if (!preferred) {
    return {
      quality: "auto",
      reason: "未拿到可用视频格式，下载时交给 yt-dlp 自动选择",
    };
  }

  return {
    formatId: preferred.formatId,
    quality: `${preferred.height || "auto"}p`,
    reason: "默认优先 720p 或以下，兼顾渲染速度和清晰度；Agent 可以显式指定更高画质",
  };
}

export const youtubeSourceAdapter: SourceAdapter = {
  platform: "youtube",
  implemented: true,

  matchUrl(url: string): boolean {
    return /(?:youtube\.com|youtu\.be)/i.test(url);
  },

  async probe(url: string): Promise<SourceProbeResult> {
    const stdout = await execFileText(resolveCommand("yt-dlp"), ["-J", "--skip-download", url]);
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    const rawFormats = Array.isArray(raw.formats) ? raw.formats : [];
    const formats = rawFormats.map((format) => normalizeFormat(format as Record<string, unknown>));

    return {
      platform: "youtube",
      url,
      contentId: typeof raw.id === "string" ? raw.id : extractYoutubeId(url),
      title: typeof raw.title === "string" ? raw.title : undefined,
      author: typeof raw.uploader === "string" ? raw.uploader : undefined,
      durationSec: typeof raw.duration === "number" ? raw.duration : undefined,
      language: typeof raw.language === "string" ? raw.language : undefined,
      formats,
      recommended: pickRecommended(formats),
      raw: {
        id: raw.id,
        webpage_url: raw.webpage_url,
        extractor: raw.extractor,
        uploader_id: raw.uploader_id,
        upload_date: raw.upload_date,
        view_count: raw.view_count,
        like_count: raw.like_count,
        comment_count: raw.comment_count,
      },
    };
  },

  async download(request: DownloadRequest): Promise<SourceAssetManifest> {
    const outputTemplate = path.join(request.outputDir, "media", "%(id)s.%(ext)s");
    const commentLimit = Math.max(1, request.options.targetCommentCount || 200);
    const args = [
      "--write-info-json",
      "--write-comments",
      "--extractor-args",
      `youtube:max_comments=${commentLimit},${commentLimit},0,0;comment_sort=top`,
      "--no-playlist",
      "--no-abort-on-error",
      "-o",
      outputTemplate,
    ];

    if (request.formatId) {
      args.push("-f", request.formatId);
    } else if (request.options.downloadQuality && request.options.downloadQuality !== "auto") {
      args.push("-S", `res:${request.options.downloadQuality.replace("p", "")}`);
    } else {
      args.push("-f", "bv*[height<=720]+ba/b[height<=720]/best", "-S", "res:720");
    }

    args.push(request.url);
    await execFileText(resolveCommand("yt-dlp"), args, 3 * 60 * 60 * 1000, request.signal);

    const files = walkFiles(request.outputDir);
    const mediaPath = files.find((file) => /\.(mp4|mkv|webm|mov)$/i.test(file));
    const infoPath = files.find((file) => /\.info\.json$/i.test(file));
    const subtitlePaths = files.filter((file) => /\.(vtt|srt)$/i.test(file));

    return {
      mediaPath,
      infoPath,
      subtitlePaths,
    };
  },
};
