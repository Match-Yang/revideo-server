import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { resolveCommand } from "../../dependencies";
import type {
  DownloadConfig,
  DownloadRequest,
  SourceAdapter,
  SourceAssetManifest,
  SourceFormat,
  SourceProbeResult,
} from "../types";

const DEFAULT_DOWNLOAD_CONFIG: DownloadConfig = {
  videoQuality: "auto",
  retryCount: 2,
  timeoutSec: 600,
};

function resolveDownloadConfig(request: DownloadRequest): DownloadConfig {
  return { ...DEFAULT_DOWNLOAD_CONFIG, ...(request.download || {}) };
}

const YOUTUBE_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([^&?\s/]+)/;
const CHINESE_SUBTITLE_FALLBACKS = ["zh-Hans", "zh-Hant", "zh.*"];
const ENGLISH_SUBTITLE_FALLBACKS = ["en.*", "en"];

// yt-dlp needs a JS runtime (deno/node) to execute YouTube's player code.
// Without one, extraction degrades ("some formats may be missing") and, under
// rate-limiting, can stall the network layer — which is what hung downloads.
// deno is the default but rarely installed; node is always present here.
let cachedJsRuntimeArgs: string[] | null = null;
export function jsRuntimeArgs(): string[] {
  if (cachedJsRuntimeArgs) return cachedJsRuntimeArgs;
  const override = process.env.YT_DLP_JS_RUNTIME;
  if (override) {
    cachedJsRuntimeArgs = ["--js-runtimes", override];
    return cachedJsRuntimeArgs;
  }
  try {
    // process.execPath is the node binary running this server.
    cachedJsRuntimeArgs = ["--js-runtimes", `node:${process.execPath}`];
  } catch {
    cachedJsRuntimeArgs = [];
  }
  return cachedJsRuntimeArgs;
}

export function execFileText(
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

function listSubtitleFiles(outputDir: string): string[] {
  return walkFiles(path.join(outputDir, "subtitles")).filter((file) => /\.(vtt|srt)$/i.test(file));
}

function isChineseSubtitleLanguage(language: string): boolean {
  return /^zh(?:[-_]|$)|chinese|中文/i.test(language);
}

function sortSubtitleLanguages(languages: string[]): string[] {
  return Array.from(new Set(languages.filter(Boolean))).sort((a, b) => {
    const rank = (language: string) => {
      if (/^zh-Hans$/i.test(language)) return 0;
      if (/^zh-Hant$/i.test(language)) return 1;
      if (/^zh/i.test(language)) return 2;
      if (/^en(?:[-_]|$)/i.test(language)) return 3;
      return 4;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

function subtitleLanguagesFromInfo(outputDir: string): string[] {
  const infoPath = walkFiles(outputDir).find((file) => /\.info\.json$/i.test(file));
  if (!infoPath) return [];
  try {
    const info = JSON.parse(fs.readFileSync(infoPath, "utf-8")) as {
      subtitles?: Record<string, unknown>;
      automatic_captions?: Record<string, unknown>;
    };
    return sortSubtitleLanguages([
      ...Object.keys(info.subtitles || {}),
      ...Object.keys(info.automatic_captions || {}),
    ]);
  } catch {
    return [];
  }
}

async function downloadSubtitleLanguages(
  request: DownloadRequest,
  languages: string[],
  label: string
): Promise<boolean> {
  const before = new Set(listSubtitleFiles(request.outputDir));
  const subtitleTemplate = path.join(request.outputDir, "subtitles", "%(id)s.%(ext)s");
  const args = [
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    languages.join(","),
    "--sub-format",
    "vtt/srt/best",
    "--convert-subs",
    "vtt",
    "--sleep-subtitles",
    "2",
    "--no-playlist",
    ...jsRuntimeArgs(),
    "-o",
    subtitleTemplate,
    request.url,
  ];

  await execFileText(resolveCommand("yt-dlp"), args, 30 * 60 * 1000, request.signal);
  // yt-dlp can "succeed" (exit 0) yet write a Google rate-limit/error HTML page
  // to the .vtt destination instead of real subtitles. Validate the new files
  // are actual subtitle tracks before treating the download as successful.
  const after = listSubtitleFiles(request.outputDir);
  const newValidFiles = after.filter((file) => {
    if (before.has(file)) return false;
    try {
      const head = fs.readFileSync(file, "utf8").trimStart().slice(0, 512).toLowerCase();
      const looksLikeSubtitle = head.startsWith("webvtt") || /^\d{2}:\d{2}/.test(head) || /^1\b/.test(head);
      if (!looksLikeSubtitle) {
        console.warn(`[youtube] discarding invalid subtitle file (not WEBVTT/SRT): ${path.basename(file)}`);
        fs.unlinkSync(file);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  });
  if (newValidFiles.length === 0) {
    console.warn(`[youtube] subtitle download produced no valid files for ${label}: ${languages.join(",")}`);
  }
  return newValidFiles.length > 0;
}

async function tryDownloadSubtitles(request: DownloadRequest): Promise<void> {
  const availableLanguages = subtitleLanguagesFromInfo(request.outputDir);
  const chineseLanguages = availableLanguages.filter(isChineseSubtitleLanguage);
  const nonChineseLanguages = availableLanguages.filter((language) => !isChineseSubtitleLanguage(language) && language !== "live_chat");
  const englishLanguages = nonChineseLanguages.filter((language) => /^en(?:[-_]|$)|^en\./i.test(language));
  const primaryLanguages = chineseLanguages.length ? chineseLanguages : CHINESE_SUBTITLE_FALLBACKS;
  const fallbackLanguages = englishLanguages.length
    ? englishLanguages
    : nonChineseLanguages.length
      ? nonChineseLanguages.slice(0, 3)
      : ENGLISH_SUBTITLE_FALLBACKS;

  // Build an ordered list of language groups to try. We attempt Chinese first
  // (the target language), then fall back to English, then any other language.
  // Each group is tried at most once — YouTube aggressively rate-limits
  // (HTTP 429) auto-caption fetches, and retrying the SAME language group just
  // deepens the throttle. On 429 we immediately move on to the next group so we
  // still get subtitles in some language instead of giving up entirely.
  const groups: Array<{ label: string; languages: string[] }> = [
    { label: "Chinese", languages: primaryLanguages },
    { label: "fallback", languages: fallbackLanguages },
  ];

  for (const group of groups) {
    try {
      if (await downloadSubtitleLanguages(request, group.languages, group.label)) {
        console.log(`[youtube] subtitles downloaded via ${group.label}: ${group.languages.join(",")}`);
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[youtube] ${group.label} subtitle attempt failed: ${message}`);
      const rateLimited = /HTTP Error 429|Too Many Requests/i.test(message);
      // On 429, don't retry this group — but DO try the next language group
      // (English/other), which hits a different caption track and is far less
      // likely to be throttled. Only abort when there's no group left to try.
      if (rateLimited) {
        console.warn(`[youtube] ${group.label} rate-limited (429), trying next language group`);
        continue;
      }
    }
  }
  console.warn("[youtube] all subtitle language groups exhausted, no subtitles downloaded");
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

function qualityFormatSelector(height: string): string {
  return `bv*[height<=${height}]+ba/b[height<=${height}]/best`;
}

function qualityHeight(value: string | undefined): number | undefined {
  if (!value || value === "auto" || value === "best") return undefined;
  const named: Record<string, number> = {
    "8k": 4320,
    "4k": 2160,
    "2k": 1440,
  };
  const height = named[value.toLowerCase()] ?? Number(value.match(/^(\d+)p$/i)?.[1]);
  return Number.isFinite(height) && height > 0 ? height : undefined;
}

function defaultFormatSelector(): string[] {
  return ["-f", "bv*[height<=720]+ba/b[height<=720]/best", "-S", "res:720"];
}

export const youtubeSourceAdapter: SourceAdapter = {
  platform: "youtube",
  implemented: true,

  matchUrl(url: string): boolean {
    return /(?:youtube\.com|youtu\.be)/i.test(url);
  },

  async probe(url: string): Promise<SourceProbeResult> {
    const stdout = await execFileText(resolveCommand("yt-dlp"), ["-J", "--skip-download", ...jsRuntimeArgs(), url]);
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
    const config = resolveDownloadConfig(request);
    const outputTemplate = path.join(request.outputDir, "media", "%(id)s.%(ext)s");
    const renderComments = request.options.renderComments !== false;
    const commentLimit = Math.max(1, request.options.targetCommentCount || 200);
    const args = [
      "--write-info-json",
      "--no-playlist",
      "--no-abort-on-error",
      ...jsRuntimeArgs(),
      "-o",
      outputTemplate,
    ];

    if (renderComments) {
      args.push("--write-comments");
      args.push(
        "--extractor-args",
        `youtube:max_comments=${commentLimit},${commentLimit},0,0;comment_sort=top`
      );
    }

    const quality =
      request.options.downloadQuality && request.options.downloadQuality !== "auto"
        ? request.options.downloadQuality
        : config.videoQuality !== "auto" && config.videoQuality !== "best"
          ? config.videoQuality
          : undefined;

    if (request.formatId) {
      args.push("-f", request.formatId);
    } else if (quality) {
      const height = qualityHeight(quality);
      if (!height) {
        args.push(...defaultFormatSelector());
      } else {
        args.push("-f", qualityFormatSelector(String(height)));
        args.push("-S", `res:${height}`);
      }
    } else {
      args.push(...defaultFormatSelector());
    }

    args.push(request.url);
    const timeoutMs = Math.max(1, config.timeoutSec) * 1000;
    const maxAttempts = Math.max(1, config.retryCount + 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await execFileText(resolveCommand("yt-dlp"), args, timeoutMs, request.signal);
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        // 429 rate-limited: retrying immediately makes the throttle worse and
        // tends to stall yt-dlp's networking layer. Bail out rather than loop.
        if (/HTTP Error 429|Too Many Requests/i.test(message)) break;
        // Aborted by caller (pause/cancel): stop immediately, do not retry.
        if (request.signal?.aborted) break;
        if (attempt >= maxAttempts) break;
        console.warn(
          `[youtube] download attempt ${attempt}/${maxAttempts} failed, retrying: ${message}`
        );
      }
    }
    // yt-dlp uses --no-abort-on-error, so it may exit non-zero (e.g. comment
    // fetch hit 429) while still having written the media file. Only treat the
    // run as failed if no media file landed on disk.
    const mediaFileBeforeSubtitles = walkFiles(request.outputDir).find((file) => /\.(mp4|mkv|webm|mov)$/i.test(file));
    if (lastError && !mediaFileBeforeSubtitles && !request.signal?.aborted) {
      throw lastError;
    }
    if (lastError) {
      console.warn(
        `[youtube] yt-dlp reported errors but media file present, continuing: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      );
    }
    await tryDownloadSubtitles(request);

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
