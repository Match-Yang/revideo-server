import { loadSettings } from "../settings";
import { createJobId, loadJob } from "../jobs/store";
import { listChannelVideos, probeBatch } from "../platforms/sources/youtube-list";
import { llmFilterVideos } from "./llm-filter";
import { emptyStats } from "./store";
import type {
  DiscoveredVideo,
  DiscoveryOptions,
  DiscoveryResult,
  ChannelVideoEntry,
} from "./types";

/** 规范化频道 URL：补 /videos 后缀，确保 flat-playlist 能拿到视频列表而非 tab。 */
function normalizeChannelUrl(url: string): string {
  const trimmed = url.trim();
  // 去掉尾部斜杠
  const base = trimmed.replace(/\/+$/, "");
  // 已有 /videos /shorts /streams 等路径，保持原样
  if (/\/(videos|shorts|streams|playlists)(\/|$|\?)/.test(base)) return base;
  // handle/@xxx 形式或其他频道根 URL，补 /videos
  return `${base}/videos`;
}

function daysSince(dateStr: string): number | undefined {
  // dateStr 可能是 yt-dlp 的 YYYYMMDD 或 ISO
  const normalized =
    dateStr.length === 8
      ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
      : dateStr;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return undefined;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

export async function runDiscovery(options?: DiscoveryOptions): Promise<DiscoveryResult> {
  const settings = loadSettings();
  const cfg = settings.task.discovery;
  const stats = emptyStats();
  const errors: string[] = [];

  if (!cfg.channels.length || !cfg.targets.length) {
    return { stats, videos: [], errors };
  }

  // 1. 扫描所有频道
  const allEntries: ChannelVideoEntry[] = [];
  for (const channelUrl of cfg.channels) {
    try {
      const normalized = normalizeChannelUrl(channelUrl);
      const entries = await listChannelVideos(normalized, options?.signal);
      allEntries.push(...entries);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`频道抓取失败 ${channelUrl}: ${msg}`);
    }
  }
  // 按 videoId 去重
  const seen = new Set<string>();
  const unique: ChannelVideoEntry[] = [];
  for (const e of allEntries) {
    if (!seen.has(e.videoId)) {
      seen.add(e.videoId);
      unique.push(e);
    }
  }
  stats.scanned = unique.length;

  // 3. 硬过滤粗筛（只能用 flat-playlist 提供的 viewCount）
  const afterCoarse = unique.filter((e) => {
    if (e.viewCount !== undefined && e.viewCount < cfg.filters.minViews) return false;
    return true;
  });

  // 4. 去重（job 已存在即跳过）
  const newEntries = afterCoarse.filter((e) => {
    const jobId = createJobId("youtube", e.videoId);
    return !loadJob(jobId);
  });
  stats.hardFiltered = afterCoarse.length;
  stats.deduped = newEntries.length;

  // 5. 批量 probe 拿准确元数据
  const probes = await probeBatch(
    newEntries.map((e) => e.url),
    { concurrency: 3, delayMs: 500, signal: options?.signal },
  );

  // 6. 精确硬过滤
  const cfgMinViews = cfg.filters.minViews;
  const cfgMinComments = cfg.filters.minComments;
  const cfgMaxAgeDays = cfg.filters.maxAgeDays;
  const passed: DiscoveredVideo[] = [];
  for (const p of probes) {
    const raw = (p.raw ?? {}) as Record<string, unknown>;
    const viewCount = typeof raw.view_count === "number" ? raw.view_count : undefined;
    const commentCount = typeof raw.comment_count === "number" ? raw.comment_count : undefined;
    const uploadDate = typeof raw.upload_date === "string" ? raw.upload_date : undefined;
    const ageDays = uploadDate ? daysSince(uploadDate) : undefined;

    if (viewCount !== undefined && viewCount < cfgMinViews) continue;
    if (commentCount !== undefined && commentCount < cfgMinComments) continue;
    if (ageDays !== undefined && ageDays > cfgMaxAgeDays) continue;

    const duration = p.durationSec ?? 0;
    const repeatTimes =
      cfg.shortVideo.maxDurationSec > 0 && duration < cfg.shortVideo.maxDurationSec
        ? cfg.shortVideo.repeatTimes
        : 1;

    passed.push({
      videoId: p.contentId ?? "",
      url: p.url,
      title: p.title ?? "",
      durationSec: p.durationSec,
      viewCount,
      commentCount,
      publishedAt: uploadDate,
      repeatTimes,
    });
  }

  // 7. LLM 语义过滤
  let finalVideos = passed;
  if (cfg.llmPrompt.trim() && passed.length > 0) {
    const { kept, error } = await llmFilterVideos(passed, cfg.llmPrompt, options?.signal);
    if (error) errors.push(error);
    const keepSet = new Set(kept);
    finalVideos = passed.filter((v) => keepSet.has(v.videoId));
  }
  stats.llmFiltered = finalVideos.length;

  return { stats, videos: finalVideos, errors };
}
