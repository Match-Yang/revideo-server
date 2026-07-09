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
  DiscoveryRunStats,
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

export interface DiscoveryRunHooks {
  /** 阶段进度回调：stats 部分字段更新后调用，用于持久化与前端可见进度。 */
  onProgress?: (stats: Partial<DiscoveryRunStats>, stage: string) => void;
}

export async function runDiscovery(
  options?: DiscoveryOptions,
  hooks?: DiscoveryRunHooks,
): Promise<DiscoveryResult> {
  const settings = loadSettings();
  const cfg = settings.task.discovery;
  const stats = emptyStats();
  const errors: string[] = [];

  if (!cfg.channels.length || !cfg.targets.length) {
    console.log("[discovery] 未配置 channels 或 targets，跳过");
    return { stats, videos: [], errors };
  }

  // 1. 扫描所有频道
  console.log(`[discovery] 开始扫描 ${cfg.channels.length} 个频道...`);
  const allEntries: ChannelVideoEntry[] = [];
  for (const channelUrl of cfg.channels) {
    try {
      const normalized = normalizeChannelUrl(channelUrl);
      console.log(`[discovery] 抓取频道: ${normalized}`);
      const entries = await listChannelVideos(normalized, options?.signal);
      console.log(`[discovery]   频道 ${channelUrl} 返回 ${entries.length} 条`);
      allEntries.push(...entries);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[discovery]   频道抓取失败 ${channelUrl}: ${msg}`);
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
  console.log(`[discovery] 扫描完成，共 ${stats.scanned} 个去重后的视频`);
  hooks?.onProgress?.({ scanned: stats.scanned }, "scanned");

  // 2. 去重（job 已存在即跳过）
  // 注意：flat-playlist 不返回 view_count / comment_count / upload_date，
  // 所以观看数/评论数/时效过滤只能在 probe 后做。这里先用 job 去重减少 probe 量。
  const newEntries = unique.filter((e) => {
    const jobId = createJobId("youtube", e.videoId);
    return !loadJob(jobId);
  });
  stats.deduped = newEntries.length;
  console.log(
    `[discovery] 去重后剩余 ${stats.deduped}（${unique.length - newEntries.length} 个已存在 job）`,
  );
  hooks?.onProgress?.({ deduped: stats.deduped, hardFiltered: newEntries.length }, "deduped");

  if (newEntries.length === 0) {
    console.log("[discovery] 没有新视频需要处理，结束");
    stats.hardFiltered = 0;
    stats.llmFiltered = 0;
    return { stats, videos: [], errors };
  }

  // 3. 批量 probe 拿准确元数据（观看数/评论数/发布时间）
  // 关键优化：YouTube 频道 /videos 按时间倒序排列，所以用 maxAgeDays 做时间窗口截断——
  // 连续遇到 MAX_STALE_IN_A_ROW 个超龄视频就提前终止 probe，避免对 1700+ 旧视频全量 probe。
  const cfgMaxAgeDays = cfg.filters.maxAgeDays;
  const MAX_STALE_IN_A_ROW = 5;
  let consecutiveStale = 0;
  let probedCount = 0;
  console.log(
    `[discovery] 开始 probe ${newEntries.length} 个视频（并发 3，时效窗口 ${cfgMaxAgeDays} 天，连续 ${MAX_STALE_IN_A_ROW} 个超龄即停止）...`,
  );
  const t0 = Date.now();
  const probes = await probeBatch(
    newEntries.map((e) => e.url),
    {
      concurrency: 3,
      delayMs: 500,
      signal: options?.signal,
      shouldStop: (probe, done, total) => {
        probedCount = done + 1;
        const raw = (probe.raw ?? {}) as Record<string, unknown>;
        const uploadDate = typeof raw.upload_date === "string" ? raw.upload_date : undefined;
        if (uploadDate) {
          const age = daysSince(uploadDate);
          if (age !== undefined && age > cfgMaxAgeDays) {
            consecutiveStale++;
            if (consecutiveStale >= MAX_STALE_IN_A_ROW) {
              console.log(
                `[discovery] 连续 ${MAX_STALE_IN_A_ROW} 个视频超龄（最近一个 ${Math.round(age!)} 天前），提前终止 probe`,
              );
              return true;
            }
          } else {
            consecutiveStale = 0; // 遇到新视频，重置计数
          }
        }
        return false;
      },
    },
  );
  console.log(
    `[discovery] probe 完成，实际 probe ${probedCount}/${newEntries.length} 个，成功 ${probes.length}，耗时 ${Math.round((Date.now() - t0) / 1000)}s`,
  );

  // 4. 精确硬过滤（用 probe 拿到的准确数据）
  const cfgMinViews = cfg.filters.minViews;
  const cfgMinComments = cfg.filters.minComments;
  const passed: DiscoveredVideo[] = [];
  let droppedViews = 0;
  let droppedComments = 0;
  let droppedAge = 0;
  for (const p of probes) {
    const raw = (p.raw ?? {}) as Record<string, unknown>;
    const viewCount = typeof raw.view_count === "number" ? raw.view_count : undefined;
    const commentCount = typeof raw.comment_count === "number" ? raw.comment_count : undefined;
    const uploadDate = typeof raw.upload_date === "string" ? raw.upload_date : undefined;
    const ageDays = uploadDate ? daysSince(uploadDate) : undefined;

    if (viewCount !== undefined && viewCount < cfgMinViews) {
      droppedViews++;
      continue;
    }
    if (commentCount !== undefined && commentCount < cfgMinComments) {
      droppedComments++;
      continue;
    }
    if (ageDays !== undefined && ageDays > cfgMaxAgeDays) {
      droppedAge++;
      continue;
    }

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
  console.log(
    `[discovery] 精确过滤后剩余 ${passed.length}（丢弃: 观看数${droppedViews} 评论${droppedComments} 时效${droppedAge}）`,
  );
  stats.hardFiltered = passed.length;
  hooks?.onProgress?.({ hardFiltered: stats.hardFiltered }, "hardFiltered");

  // 6. LLM 语义过滤
  let finalVideos = passed;
  if (cfg.llmPrompt.trim() && passed.length > 0) {
    console.log(`[discovery] 开始 LLM 语义过滤 ${passed.length} 个视频...`);
    const { kept, error } = await llmFilterVideos(passed, cfg.llmPrompt, options?.signal);
    if (error) {
      console.warn(`[discovery] LLM 过滤降级: ${error}`);
      errors.push(error);
    }
    const keepSet = new Set(kept);
    finalVideos = passed.filter((v) => keepSet.has(v.videoId));
    console.log(`[discovery] LLM 过滤后剩余 ${finalVideos.length}`);
  } else {
    console.log("[discovery] 跳过 LLM 过滤（提示词为空）");
  }
  stats.llmFiltered = finalVideos.length;
  hooks?.onProgress?.({ llmFiltered: stats.llmFiltered }, "llmFiltered");

  console.log(`[discovery] 发现流程完成，最终候选 ${finalVideos.length} 个视频`);
  return { stats, videos: finalVideos, errors };
}
