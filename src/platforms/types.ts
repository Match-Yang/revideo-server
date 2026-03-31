import type { JobOptions, SourcePlatform, TargetPlatform } from "../jobs/types";

export interface SourceFormat {
  formatId: string;
  ext?: string;
  height?: number;
  width?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  note?: string;
}

export interface SourceProbeResult {
  platform: Exclude<SourcePlatform, "auto">;
  url: string;
  contentId?: string;
  title?: string;
  author?: string;
  durationSec?: number;
  language?: string;
  formats: SourceFormat[];
  recommended?: {
    formatId?: string;
    quality: string;
    reason: string;
  };
  raw?: Record<string, unknown>;
}

export interface DownloadConfig {
  videoQuality: "auto" | "best" | "8k" | "4k" | "2k" | "1080p" | "720p" | "480p";
  retryCount: number;
  timeoutSec: number;
}

export interface DownloadRequest {
  url: string;
  outputDir: string;
  options: JobOptions;
  formatId?: string;
  signal?: AbortSignal;
  download?: DownloadConfig;
}

export interface SourceAssetManifest {
  mediaPath?: string;
  infoPath?: string;
  subtitlePaths: string[];
  commentPath?: string;
}

export interface SourceAdapter {
  platform: Exclude<SourcePlatform, "auto">;
  implemented: boolean;
  matchUrl(url: string): boolean;
  probe(url: string): Promise<SourceProbeResult>;
  download?(request: DownloadRequest): Promise<SourceAssetManifest>;
}

export interface PublisherAdapterInfo {
  platform: TargetPlatform;
  implemented: boolean;
  requiresBrowser: boolean;
}
