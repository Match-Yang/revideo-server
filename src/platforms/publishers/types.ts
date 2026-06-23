import type { RevideoJob, TargetPlatform } from "../../jobs/types";

export interface PublishAdapterResult {
  [key: string]: unknown;
  success: boolean;
  error?: string;
  raw?: Record<string, unknown>;
}

export interface PublisherAdapter {
  platform: TargetPlatform;
  implemented: boolean;
  requiresBrowser: boolean;
  preflight(job: RevideoJob, options?: { login?: boolean }): Promise<{ ok: boolean; message: string; data?: unknown }>;
  publish(job: RevideoJob, force?: boolean, signal?: AbortSignal): Promise<PublishAdapterResult>;
}
