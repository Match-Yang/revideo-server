import fs from "fs";
import type { RevideoJob, TargetPlatform } from "./types";
import { resolvePublisher } from "../platforms/publishers/registry";
import { loadSettings, type RevideoSettings } from "../settings";

const PUBLISH_PREFLIGHT_CHECKS = {
  adapter: true,
  files: true,
  copy: true,
  login: true,
};

function getJobConfig(job: RevideoJob): RevideoSettings {
  const snapshot = job.settingsSnapshot as RevideoSettings | undefined;
  if (snapshot?.task?.publish) return snapshot;
  return loadSettings();
}

function getPublishRetryCount(job: RevideoJob, platform: TargetPlatform): number {
  const config = getJobConfig(job);
  const platformConfigs = config.task.publish.platformConfigs as Record<string, { retryCount?: number }>;
  const platformRetry = platformConfigs[platform]?.retryCount;
  return Math.max(0, platformRetry ?? 1);
}

export async function preflightJobTarget(job: RevideoJob, platform: TargetPlatform) {
  const publisher = resolvePublisher(platform);
  const checks = PUBLISH_PREFLIGHT_CHECKS;

  if (!publisher) {
    if (!checks.adapter) {
      return { ok: true, message: `${platform} publisher not found but adapter check is disabled`, skipped: true };
    }
    return { ok: false, message: `${platform} publisher not found` };
  }

  // If adapter check is disabled and publisher is not implemented, skip gracefully
  if (!checks.adapter && !publisher.implemented) {
    return { ok: true, message: `${platform} publisher not implemented but adapter check is disabled`, skipped: true };
  }
  if (!publisher.implemented) {
    return { ok: false, message: `${platform} publisher is planned but not implemented` };
  }

  // If all checks are disabled, skip preflight entirely
  if (!checks.login && !checks.files && !checks.copy && !checks.adapter) {
    return { ok: true, message: "All preflight checks disabled by settings", skipped: true };
  }

  if (checks.files && (!job.artifacts.outputVideo || !fs.existsSync(job.artifacts.outputVideo))) {
    return { ok: false, message: "Rendered output video is missing" };
  }

  if (checks.copy) {
    const draft = job.targets.find((target) => target.platform === platform)?.draft;
    if (!draft) return { ok: false, message: `${platform} draft copy is missing` };
    if (!String(draft.title || "").trim()) return { ok: false, message: `${platform} draft title is missing` };
    if (!String(draft.description || "").trim()) return { ok: false, message: `${platform} draft description is missing` };
  }

  return publisher.preflight(job, { login: checks.login });
}

export async function publishJobTarget(job: RevideoJob, platform: TargetPlatform, force?: boolean) {
  const publisher = resolvePublisher(platform);
  if (!publisher) {
    throw new Error(`${platform} publisher not found`);
  }
  if (!publisher.implemented) {
    throw new Error(`${platform} publisher is planned but not implemented`);
  }

  const maxAttempts = getPublishRetryCount(job, platform) + 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await publisher.publish(job, force);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        console.warn(`[Publish] ${platform} attempt ${attempt}/${maxAttempts} failed: ${err instanceof Error ? err.message : String(err)}. Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  throw lastError;
}
