import type { TargetPlatform } from "../../jobs/types";
import { bilibiliPublisher, douyinPublisher } from "./legacy";
import type { PublisherAdapter } from "./types";

const publishers: PublisherAdapter[] = [
  bilibiliPublisher,
  douyinPublisher,
  {
    platform: "youtube",
    implemented: false,
    requiresBrowser: true,
    preflight: async () => ({ ok: false, message: "YouTube publisher is planned" }),
    publish: async () => ({ success: false, error: "YouTube publisher is planned" }),
  },
  {
    platform: "tiktok",
    implemented: false,
    requiresBrowser: true,
    preflight: async () => ({ ok: false, message: "TikTok publisher is planned" }),
    publish: async () => ({ success: false, error: "TikTok publisher is planned" }),
  },
  {
    platform: "xiaohongshu",
    implemented: false,
    requiresBrowser: true,
    preflight: async () => ({ ok: false, message: "Xiaohongshu publisher is planned" }),
    publish: async () => ({ success: false, error: "Xiaohongshu publisher is planned" }),
  },
];

export function resolvePublisher(platform: TargetPlatform): PublisherAdapter | undefined {
  return publishers.find((publisher) => publisher.platform === platform);
}

export function listPublisherAdapters() {
  return publishers.map((publisher) => ({
    platform: publisher.platform,
    implemented: publisher.implemented,
    requiresBrowser: publisher.requiresBrowser,
  }));
}
