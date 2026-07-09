import { resolveCommand } from "../../dependencies";
import { execFileText, jsRuntimeArgs, youtubeSourceAdapter } from "./youtube";
import type { ChannelVideoEntry, ProbeBatchOptions } from "../../discovery/types";
import type { SourceProbeResult } from "../types";

/**
 * 用 yt-dlp flat-playlist 模式列出频道所有视频。
 * 注意：flat-playlist 不一定返回 view_count / comment_count / upload_date，
 * 需要后续 probeBatch() 逐个 probe 才能拿到准确的评论数等。
 */
export async function listChannelVideos(
  channelUrl: string,
  signal?: AbortSignal,
): Promise<ChannelVideoEntry[]> {
  const stdout = await execFileText(
    resolveCommand("yt-dlp"),
    ["--flat-playlist", "-J", "--skip-download", ...jsRuntimeArgs(), channelUrl],
    undefined,
    signal,
  );
  const raw = JSON.parse(stdout) as { entries?: Array<Record<string, unknown>> };
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const result: ChannelVideoEntry[] = [];
  for (const e of entries) {
    const id = typeof e.id === "string" ? e.id : undefined;
    if (!id) continue;
    const url = typeof e.url === "string" ? e.url : `https://www.youtube.com/watch?v=${id}`;
    result.push({
      videoId: id,
      url,
      title: typeof e.title === "string" ? e.title : "",
      durationSec: typeof e.duration === "number" ? e.duration : undefined,
      viewCount: typeof e.view_count === "number" ? e.view_count : undefined,
    });
  }
  return result;
}

/** 受控并发批量 probe，拿准确的 view_count / comment_count / upload_date。 */
export async function probeBatch(
  urls: string[],
  options?: ProbeBatchOptions,
): Promise<SourceProbeResult[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 3);
  const delayMs = Math.max(0, options?.delayMs ?? 500);
  const signal = options?.signal;
  const shouldStop = options?.shouldStop;
  const results: SourceProbeResult[] = [];
  let index = 0;
  let done = 0;
  const total = urls.length;
  const t0 = Date.now();
  let stopped = false;

  async function worker() {
    while (index < urls.length && !stopped) {
      if (signal?.aborted) return;
      const current = index++;
      const url = urls[current];
      try {
        const probed = await youtubeSourceAdapter.probe(url);
        results.push(probed);
        // 每完成一个，询问调用方是否可以提前停止
        if (shouldStop?.(probed, done, total)) {
          stopped = true;
          console.log(`[probeBatch] 调用方要求提前停止（已完成 ${done}/${total}）`);
          return;
        }
      } catch (err) {
        console.error(`[probeBatch] probe failed: ${url}`, err);
      }
      done++;
      // 每 10 个打印一次进度
      if (done % 10 === 0 || done === total) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        const rate = elapsed > 0 ? (done / elapsed).toFixed(1) : "?";
        console.log(`[probeBatch] 进度 ${done}/${total}（${elapsed}s，${rate}/s）`);
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
