import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { startBrowser } from "../../browser/manager";
import { resolveCommand } from "../../dependencies";
import type {
  DownloadRequest,
  SourceAdapter,
  SourceAssetManifest,
  SourceFormat,
  SourceProbeResult,
} from "../types";

// ── helpers ──────────────────────────────────────────────────

function execFileText(
  command: string,
  args: string[],
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, signal },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} failed: ${stderr || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
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
    filesize:
      typeof format.filesize === "number"
        ? format.filesize
        : typeof format.filesize_approx === "number"
          ? format.filesize_approx
          : undefined,
    note: typeof format.format_note === "string" ? format.format_note : undefined,
  };
}

// ── TikTok-specific ──────────────────────────────────────────

const TIKTOK_ID_RE = /video\/(\d+)/;

function extractTikTokId(url: string): string | undefined {
  return url.match(TIKTOK_ID_RE)?.[1];
}

/**
 * Pick recommended format for TikTok.
 *
 * TikTok formats include a watermarked "download" format (lowest preference)
 * and multiple clean formats at different resolutions (540p / 720p / 1080p).
 * Each resolution may appear twice (-0 / -1 suffix) for CDN redundancy.
 *
 * Strategy: prefer the highest-resolution clean (non-watermarked) format.
 */
function pickRecommended(formats: SourceFormat[]): SourceProbeResult["recommended"] {
  const cleanFormats = formats
    .filter((f) => f.formatId && f.height && f.vcodec !== "none" && f.note !== "watermarked")
    .sort((a, b) => {
      const aHeight = a.height || 0;
      const bHeight = b.height || 0;
      if (aHeight !== bHeight) return bHeight - aHeight;
      return (b.filesize || 0) - (a.filesize || 0);
    });

  const best = cleanFormats[0];
  if (!best) {
    return {
      quality: "auto",
      reason: "未找到可用格式，下载时交给 yt-dlp 自动选择",
    };
  }

  return {
    formatId: best.formatId,
    quality: `${best.height}p`,
    reason: "TikTok 默认选择最高画质无水印格式",
  };
}

// ── Comment fetching ─────────────────────────────────────────
//
// yt-dlp does NOT support TikTok comment extraction (see
// https://github.com/yt-dlp/yt-dlp/issues/5037).
//
// TikTok's comment API (/api/comment/list) is protected by
// JavaScript-generated security tokens (msToken, X-Bogus, X-Gnarly).
// Direct HTTP calls fail with status_code 5 (access denied).
//
// Strategy: use Puppeteer to navigate to the video page and click
// the comment button. TikTok's own JavaScript will make the first
// API call with all security tokens. We capture that full URL via
// request interception, then reuse the captured parameters (stripping
// only count/cursor) to make paginated fetch() calls from within
// the browser context. This gives us fast, reliable pagination
// without needing to scroll the page.
//
// Reference: https://scrapfly.io/blog/posts/how-to-scrape-tiktok-python-json

interface RawTikTokComment {
  cid: string;
  text: string;
  create_time: number;
  digg_count: number;
  author_pin?: boolean;
  user?: {
    uid?: string;
    nickname?: string;
    avatar_thumb?: { url_list?: string[] };
    is_verified?: boolean;
  };
  reply_comment_total?: number;
}

function mapTikTokComment(
  raw: RawTikTokComment,
  uploaderId?: string,
): Record<string, unknown> {
  const avatarUrl = raw.user?.avatar_thumb?.url_list?.[0] || "";
  const timestamp = raw.create_time || 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = Math.max(0, nowSec - timestamp);
  let timeText = "";
  if (diffSec < 60) timeText = "just now";
  else if (diffSec < 3600) timeText = `${Math.floor(diffSec / 60)}m`;
  else if (diffSec < 86400) timeText = `${Math.floor(diffSec / 3600)}h`;
  else timeText = `${Math.floor(diffSec / 86400)}d`;

  return {
    id: raw.cid || "",
    parent: "",
    text: raw.text || "",
    like_count: raw.digg_count || 0,
    author_id: raw.user?.uid || "",
    author: raw.user?.nickname || "",
    author_thumbnail: avatarUrl,
    author_is_uploader: Boolean(raw.user?.uid && raw.user.uid === uploaderId),
    author_is_verified: Boolean(raw.user?.is_verified),
    is_favorited: false,
    _time_text: timeText,
    timestamp,
    is_pinned: Boolean(raw.author_pin),
  };
}

async function fetchTikTokComments(
  videoUrl: string,
  uploaderId: string | undefined,
  maxComments: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const status = await startBrowser();
  if (!status.webSocketDebuggerUrl) {
    console.warn("[tiktok] browser not available, skipping comment fetch");
    return [];
  }

  const browser = await puppeteer.connect({
    browserWSEndpoint: status.webSocketDebuggerUrl,
    protocolTimeout: 300_000,
  });

  try {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 900 });

      // Step 1: Capture the first successful comment API request URL.
      // TikTok's JS generates security tokens (msToken, X-Bogus, etc.)
      // that are included in the URL query params.
      let capturedBaseUrl: string | null = null;

      page.on("request", (request) => {
        if (capturedBaseUrl) return;
        const url = request.url();
        if (!url.includes("/api/comment/list")) return;
        const u = new URL(url);
        // Strip pagination params — we'll add our own count/cursor later
        u.searchParams.delete("count");
        u.searchParams.delete("cursor");
        capturedBaseUrl = u.toString();
      });

      // Step 2: Navigate and click comment button to trigger the first API call
      await page.goto(videoUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
        signal,
      });
      await new Promise((r) => setTimeout(r, 3_000));

      const clicked = await page.evaluate(() => {
        const els = document.querySelectorAll("[data-e2e]");
        for (const el of els) {
          if ((el.getAttribute("data-e2e") || "").includes("comment")) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      });

      if (!clicked) {
        console.warn("[tiktok] comment button not found on page");
        return [];
      }

      // Wait for the first API call to fire
      for (let i = 0; i < 15 && !capturedBaseUrl; i++) {
        if (signal?.aborted) break;
        await new Promise((r) => setTimeout(r, 1_000));
      }

      if (!capturedBaseUrl) {
        console.warn("[tiktok] failed to capture comment API URL");
        return [];
      }

      // Step 3: Paginated fetch using the captured URL with security params
      const allComments: Record<string, unknown>[] = [];
      let cursor = 0;
      let hasMore = true;

      while (hasMore && allComments.length < maxComments) {
        if (signal?.aborted) break;

        const count = Math.min(20, maxComments - allComments.length);
        const fetchUrl = `${capturedBaseUrl}&count=${count}&cursor=${cursor}`;

        const result = await page.evaluate(async (url: string) => {
          try {
            const resp = await fetch(url, { credentials: "include" });
            if (!resp.ok) return { error: `HTTP ${resp.status}` };
            const json = await resp.json();
            return {
              comments: json.comments || [],
              hasMore: json.has_more === 1 || json.has_more === true,
              cursor: json.cursor,
            };
          } catch (e) {
            return { error: String(e) };
          }
        }, fetchUrl);

        if ("error" in result || !Array.isArray(result.comments) || result.comments.length === 0) {
          break;
        }

        for (const raw of result.comments) {
          allComments.push(mapTikTokComment(raw as RawTikTokComment, uploaderId));
        }

        cursor =
          typeof result.cursor === "number"
            ? result.cursor
            : cursor + result.comments.length;
        hasMore = result.hasMore;
      }

      console.log(`[tiktok] fetched ${allComments.length} comments`);
      return allComments;
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (err) {
    console.warn(
      `[tiktok] comment fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  } finally {
    browser.disconnect();
  }
}

// ── adapter ──────────────────────────────────────────────────

export const tiktokSourceAdapter: SourceAdapter = {
  platform: "tiktok",
  implemented: true,

  matchUrl(url: string): boolean {
    return /tiktok\.com/i.test(url);
  },

  async probe(url: string): Promise<SourceProbeResult> {
    const stdout = await execFileText(
      resolveCommand("yt-dlp"),
      ["-J", "--skip-download", url],
    );
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    const rawFormats = Array.isArray(raw.formats) ? raw.formats : [];
    const formats = rawFormats.map((f) =>
      normalizeFormat(f as Record<string, unknown>),
    );

    return {
      platform: "tiktok",
      url,
      contentId:
        typeof raw.id === "string" ? raw.id : extractTikTokId(url),
      title: typeof raw.title === "string" ? raw.title : undefined,
      author:
        typeof raw.uploader === "string"
          ? raw.uploader
          : typeof raw.channel === "string"
            ? (raw.channel as string)
            : undefined,
      durationSec:
        typeof raw.duration === "number" ? raw.duration : undefined,
      language:
        typeof raw.language === "string" ? raw.language : undefined,
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
        track: raw.track,
        artists: raw.artists,
      },
    };
  },

  async download(request: DownloadRequest): Promise<SourceAssetManifest> {
    const outputTemplate = path.join(
      request.outputDir,
      "media",
      "%(id)s.%(ext)s",
    );
    const renderComments = request.options.renderComments !== false;

    const args = [
      "--write-info-json",
      "--no-playlist",
      "--no-abort-on-error",
      "-o",
      outputTemplate,
    ];

    if (request.formatId) {
      args.push("-f", request.formatId);
    } else {
      args.push("-f", "best");
    }

    args.push(request.url);

    const timeoutMs = 600 * 1000;
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await execFileText(
          resolveCommand("yt-dlp"),
          args,
          timeoutMs,
          request.signal,
        );
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        if (request.signal?.aborted || attempt >= maxAttempts) break;
        console.warn(
          `[tiktok] download attempt ${attempt}/${maxAttempts} failed, retrying: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (lastError) throw lastError;

    const files = walkFiles(request.outputDir);
    const mediaPath = files.find((file) =>
      /\.(mp4|mkv|webm|mov)$/i.test(file),
    );
    const infoPath = files.find((file) => /\.info\.json$/i.test(file));

    // ── Fetch comments via browser ───────────────────────────
    // yt-dlp does not support TikTok comment extraction.
    // We navigate to the video page, capture the security-signed
    // comment API URL, and make paginated fetch calls from within
    // the browser context. Results are injected into info.json so
    // the rest of the pipeline (normalize → translate → render)
    // works unchanged.
    if (renderComments && infoPath) {
      try {
        const info = JSON.parse(
          fs.readFileSync(infoPath, "utf-8"),
        ) as Record<string, unknown>;
        const uploaderId = String(info.uploader_id || "");
        const targetCount = Math.max(
          1,
          request.options.targetCommentCount || 200,
        );

        const comments = await fetchTikTokComments(
          request.url,
          uploaderId,
          targetCount,
          request.signal,
        );

        if (comments.length > 0) {
          info.comments = comments;
          fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
          console.log(
            `[tiktok] injected ${comments.length} comments into info.json`,
          );
        }
      } catch (err) {
        console.warn(
          `[tiktok] comment injection skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      mediaPath,
      infoPath,
      subtitlePaths: [],
    };
  },
};
