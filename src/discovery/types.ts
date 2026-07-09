// 发现功能的类型定义

export interface DiscoveryRunStats {
  scanned: number;
  hardFiltered: number;
  deduped: number;
  llmFiltered: number;
  created: number;
}

export interface DiscoveryRunRecord {
  lastRunAt: string;
  lastRunStatus: "success" | "running" | "failed";
  stats: DiscoveryRunStats;
  createdJobIds: string[];
  errors: string[];
}

export interface DiscoveredVideo {
  videoId: string;
  url: string;
  title: string;
  durationSec?: number;
  viewCount?: number;
  commentCount?: number;
  publishedAt?: string;
  repeatTimes: number;
}

export interface DiscoveryOptions {
  manual?: boolean;
  signal?: AbortSignal;
}

export interface DiscoveryResult {
  stats: DiscoveryRunStats;
  videos: DiscoveredVideo[];
  errors: string[];
}

export interface ChannelVideoEntry {
  videoId: string;
  url: string;
  title: string;
  durationSec?: number;
  viewCount?: number;
}

export interface ProbeBatchOptions {
  concurrency?: number;
  delayMs?: number;
  signal?: AbortSignal;
  /** 每完成一个 probe 后调用，返回 true 则提前终止剩余 probe（用于按时间窗口截断）。 */
  shouldStop?: (
    probe: import("../platforms/types").SourceProbeResult,
    done: number,
    total: number,
  ) => boolean;
}
