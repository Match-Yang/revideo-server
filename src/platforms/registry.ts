import type { SourceAdapter } from "./types";
import { youtubeSourceAdapter } from "./sources/youtube";
import { listPublisherAdapters } from "./publishers/registry";

const sourceAdapters: SourceAdapter[] = [
  youtubeSourceAdapter,
  {
    platform: "tiktok",
    implemented: false,
    matchUrl: (url) => /tiktok\.com/i.test(url),
    probe: async () => {
      throw new Error("TikTok source adapter is planned but not implemented yet");
    },
  },
  {
    platform: "bilibili",
    implemented: false,
    matchUrl: (url) => /bilibili\.com/i.test(url),
    probe: async () => {
      throw new Error("Bilibili source adapter is planned but not implemented yet");
    },
  },
  {
    platform: "douyin",
    implemented: false,
    matchUrl: (url) => /douyin\.com/i.test(url),
    probe: async () => {
      throw new Error("Douyin source adapter is planned but not implemented yet");
    },
  },
];

export function listSourceAdapters(): SourceAdapter[] {
  return sourceAdapters;
}

export function resolveSourceAdapter(url: string, requestedPlatform = "auto"): SourceAdapter | null {
  if (requestedPlatform !== "auto") {
    return sourceAdapters.find((adapter) => adapter.platform === requestedPlatform) || null;
  }
  return sourceAdapters.find((adapter) => adapter.matchUrl(url)) || null;
}

export function listPlatformCapabilities() {
  return {
    sources: sourceAdapters.map((adapter) => ({
      platform: adapter.platform,
      implemented: adapter.implemented,
    })),
    publishers: listPublisherAdapters(),
  };
}
