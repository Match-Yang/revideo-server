import fs from "fs";
import path from "path";
import { checkPlatformLogin, startBrowser } from "../../browser/manager";
import type { RevideoJob, TargetPlatform } from "../../jobs/types";
import { publish, type PublishRequest } from "../../publish";
import type { PublisherAdapter } from "./types";

function getTarget(job: RevideoJob, platform: TargetPlatform) {
  return job.targets.find((target) => target.platform === platform);
}

function requireVideo(job: RevideoJob): string {
  if (!job.artifacts.outputVideo || !fs.existsSync(job.artifacts.outputVideo)) {
    throw new Error("Job has no rendered output video");
  }
  return job.artifacts.outputVideo;
}

function writeResult(job: RevideoJob, platform: TargetPlatform, result: unknown): void {
  fs.mkdirSync(job.artifacts.publishDir, { recursive: true });
  fs.writeFileSync(
    path.join(job.artifacts.publishDir, `${platform}-result.json`),
    JSON.stringify(result, null, 2)
  );
}

function buildPublishRequest(job: RevideoJob, platform: TargetPlatform): PublishRequest {
  const target = getTarget(job, platform);
  const draft = target?.draft || {};
  const videoPath = requireVideo(job);

  if (platform === "bilibili") {
    return {
      videoPath,
      bilibili: {
        title: String(draft.title || ""),
        description: String(draft.description || ""),
        tags: Array.isArray(draft.tags) ? draft.tags.map(String) : [],
        category: typeof draft.category === "string" ? draft.category : undefined,
      },
    };
  }

  if (platform === "douyin") {
    return {
      videoPath,
      douyin: {
        title: String(draft.title || ""),
        description: String(draft.description || ""),
      },
    };
  }

  throw new Error(`${platform} publisher is not implemented`);
}

function createLegacyPublisher(platform: "bilibili" | "douyin", implemented: boolean): PublisherAdapter {
  return {
    platform,
    implemented,
    requiresBrowser: true,

    async preflight() {
      const browser = await startBrowser();
      if (!browser.running) {
        return { ok: false, message: browser.error || "Browser is not running", data: browser };
      }
      const login = await checkPlatformLogin(platform);
      return {
        ok: login.loggedIn,
        message: login.message,
        data: { login },
      };
    },

    async publish(job, force) {
      const target = getTarget(job, platform);
      if (target?.status === "published" && !force) {
        throw new Error(`${platform} is already published. Pass force=true to publish again.`);
      }

      const req = buildPublishRequest(job, platform);
      const results = await publish(req, () => undefined);
      const result = results[platform] || { success: false, error: "No platform result returned" };
      writeResult(job, platform, result);
      return result;
    },
  };
}

export const bilibiliPublisher = createLegacyPublisher("bilibili", true);
export const douyinPublisher = createLegacyPublisher("douyin", false);
