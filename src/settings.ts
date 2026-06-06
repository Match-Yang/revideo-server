import fs from "fs";
import os from "os";
import path from "path";
import { DATA_DIR, SETTINGS_FILE } from "./config";
import type { SourcePlatform, TargetPlatform } from "./jobs/types";

export type PublishAction = "draft" | "publish";
export type LlmServiceMode = "managed" | "custom";
export type AgentType = "openclaw" | "hermes" | "workbuddy" | "custom";
export type AgentConnectionMode = "local-app" | "browser-extension" | "cloud" | "webhook";
export type AgentHandoffMode = "notify-only" | "ask-before-action" | "auto";
export type AgentImChannelType = "wechat" | "wecom" | "lark" | "dingtalk" | "qq" | "telegram" | "discord";

export interface RevideoSettings {
  version: 2;
  task: {
    source: {
      defaultPlatform: SourcePlatform;
      duplicateStrategy: "block" | "overwrite" | "reuse-assets";
      loginMode: "platform-session" | "no-login";
      sourceLanguage: "auto" | string;
    };
    download: {
      cacheDir: string;
      videoQuality: "auto" | "best" | "1080p" | "720p" | "480p";
      qualityFallback: "down" | "up" | "exact";
      audioMode: "follow-video" | "best-audio" | "none";
      subtitleMode: "platform-preferred" | "all" | "none";
      subtitleFallback: "skip" | "speech-to-text";
      commentSampling: "duration" | "fixed" | "hot" | "latest";
      commentSeconds: number;
      maxComments: number;
      retryCount: number;
      timeoutSec: number;
    };
    prepare: {
      outputAspect: "auto" | "portrait" | "landscape" | "source";
      outputResolution: "auto" | "1080x1920" | "720x1280" | "1920x1080" | string;
      fitMode: "smart-crop" | "blur-background" | "keep-bars" | "center-crop";
      audioNormalize: "auto" | "off";
      subtitleCleanup: "merge-short" | "keep";
      commentCleanup: Array<"dedupe" | "drop-empty" | "keep-order" | "hot-order">;
    };
    translation: {
      targetLanguage: string;
      subtitleMode: "auto" | "always" | "off";
      commentMode: "auto" | "always" | "off";
      bilingualSubtitles: boolean;
      glossary: string;
      sensitiveContent: "preserve" | "soften" | "mark" | "delete";
      styleConstraints: string[];
      prompts: {
        subtitle: string;
        comment: string;
        title: string;
        description: string;
        tags: string;
      };
    };
    coverAndCopy: {
      coverMode: "none" | "ai-frame-ai-copy" | "template-fixed-copy" | "template-ai-copy";
      template: string;
      fixedCoverCopy: string;
      aiCoverPrompt: string;
      framePreference: "auto" | "people" | "product" | "action" | "information";
      frameSampleCount: number;
      titleMode: "template" | "ai" | "source";
      descriptionMode: "template" | "ai" | "source";
      tagsMode: "template" | "ai" | "manual";
      titleMaxLength: number;
      descriptionTemplate: string;
      tagsTemplate: string;
      blockedWords: string;
      replacementWords: string;
    };
    render: {
      outputDir: string;
      renderComments: boolean;
      commentStyle: "classic-dark" | "light" | "bilibili" | "douyin" | "xiaohongshu";
      commentFontSize: "small" | "medium" | "large";
      commentLineHeight: "compact" | "standard" | "loose";
      subtitleFontSize: "small" | "medium" | "large";
      subtitleLineHeight: "compact" | "standard" | "loose";
      commentContent: "original-translated" | "translated-only" | "auto";
      longCommentBehavior: "wrap" | "truncate" | "shrink";
      commentSpeed: "slow" | "standard" | "fast";
      repeatTimes: number;
      outputFormat: "mp4" | "mov";
    };
    publish: {
      defaultPlatforms: TargetPlatform[];
      defaultAction: PublishAction;
      retryCount: number;
      preflightChecks: {
        login: boolean;
        files: boolean;
        copy: boolean;
        adapter: boolean;
      };
      platformConfigs: {
        bilibili: {
          category: string;
          declaration: string;
          tags: string;
          descriptionTemplate: string;
        };
        douyin: {
          declarationType: string;
          visibility: string;
          topics: string;
          descriptionTemplate: string;
        };
        xiaohongshu: {
          topics: string;
          visibility: string;
          bodyTemplate: string;
        };
        youtube: {
          category: string;
          tags: string;
          descriptionTemplate: string;
          visibility: string;
        };
      };
    };
  };
  llm: {
    serviceMode: LlmServiceMode;
    provider: string;
    baseUrl: string;
    apiKeyEnv: string;
    apiKey: string;
    textModel: string;
    visionModel: string;
    thinking: "off" | "auto" | "low" | "medium" | "high";
    temperatureMode: "stable" | "balanced" | "creative";
    maxOutputMode: "short" | "standard" | "long";
    timeoutSec: number;
    retryCount: number;
  };
  agent: {
    enabled: boolean;
    type: AgentType;
    connectionMode: AgentConnectionMode;
    token: string;
    handoffMode: AgentHandoffMode;
    channels: Array<{
      type: AgentImChannelType;
      enabled: boolean;
      binding: string;
      notificationLevel: "all" | "failures" | "needs-action";
      allowRemoteActions: boolean;
    }>;
  };
}

function userVideosDir(): string {
  const home = os.homedir();
  const movies = path.join(home, "Movies");
  const videos = path.join(home, "Videos");
  if (process.platform === "darwin") return fs.existsSync(movies) ? movies : videos;
  return fs.existsSync(videos) ? videos : movies;
}

export function defaultDownloadDir(): string {
  return path.join(userVideosDir(), "Revideo", "Download");
}

export function defaultRenderDir(): string {
  return path.join(userVideosDir(), "Revideo", "Render");
}

export const defaultSettings: RevideoSettings = {
  version: 2,
  task: {
    source: {
      defaultPlatform: "auto",
      duplicateStrategy: "block",
      loginMode: "platform-session",
      sourceLanguage: "auto",
    },
    download: {
      cacheDir: defaultDownloadDir(),
      videoQuality: "auto",
      qualityFallback: "down",
      audioMode: "follow-video",
      subtitleMode: "platform-preferred",
      subtitleFallback: "skip",
      commentSampling: "duration",
      commentSeconds: 2,
      maxComments: 800,
      retryCount: 2,
      timeoutSec: 600,
    },
    prepare: {
      outputAspect: "portrait",
      outputResolution: "1080x1920",
      fitMode: "smart-crop",
      audioNormalize: "auto",
      subtitleCleanup: "merge-short",
      commentCleanup: ["dedupe", "drop-empty"],
    },
    translation: {
      targetLanguage: "zh-CN",
      subtitleMode: "auto",
      commentMode: "auto",
      bilingualSubtitles: false,
      glossary: "",
      sensitiveContent: "preserve",
      styleConstraints: ["自然口语", "本土化表达"],
      prompts: {
        subtitle: "保持字幕简洁自然，符合目标语言视频口语表达，保留必要专有名词。",
        comment: "将非中文评论翻译为自然中文；中文评论保持原文；保留用户语气但不要美化危险内容。",
        title: "生成适合短视频平台的标题，清晰、有吸引力，但不要捏造事实。",
        description: "生成简洁的平台简介，说明来源内容已翻译整理。",
        tags: "生成与视频主题高度相关的平台标签或话题。",
      },
    },
    coverAndCopy: {
      coverMode: "template-ai-copy",
      template: "汽车测评",
      fixedCoverCopy: "海外网友热议",
      aiCoverPrompt: "封面文案要短、有信息量，不要夸张标题党。",
      framePreference: "auto",
      frameSampleCount: 5,
      titleMode: "ai",
      descriptionMode: "ai",
      tagsMode: "ai",
      titleMaxLength: 80,
      descriptionTemplate: "来源视频经翻译、整理与重新制作后发布。",
      tagsTemplate: "汽车,海外视频",
      blockedWords: "",
      replacementWords: "",
    },
    render: {
      outputDir: defaultRenderDir(),
      renderComments: true,
      commentStyle: "classic-dark",
      commentFontSize: "medium",
      commentLineHeight: "standard",
      subtitleFontSize: "medium",
      subtitleLineHeight: "standard",
      commentContent: "original-translated",
      longCommentBehavior: "wrap",
      commentSpeed: "standard",
      repeatTimes: 1,
      outputFormat: "mp4",
    },
    publish: {
      defaultPlatforms: ["bilibili"],
      defaultAction: "publish",
      retryCount: 1,
      preflightChecks: {
        login: true,
        files: true,
        copy: true,
        adapter: true,
      },
      platformConfigs: {
        bilibili: {
          category: "汽车",
          declaration: "转载",
          tags: "汽车,海外视频",
          descriptionTemplate: "来源视频经翻译、审核与重新制作后发布。",
        },
        douyin: {
          declarationType: "转载",
          visibility: "公开",
          topics: "汽车 海外视频",
          descriptionTemplate: "海外内容搬运，已做翻译与风险过滤。",
        },
        xiaohongshu: {
          topics: "汽车 海外视频",
          visibility: "公开",
          bodyTemplate: "海外内容搬运，已做翻译与整理。",
        },
        youtube: {
          category: "Autos & Vehicles",
          tags: "cars,china,ev",
          descriptionTemplate: "Translated and edited from the source video.",
          visibility: "private",
        },
      },
    },
  },
  llm: {
    serviceMode: "managed",
    provider: "managed",
    baseUrl: "",
    apiKeyEnv: "OPENAI_API_KEY",
    apiKey: "",
    textModel: "gpt-4.1-mini",
    visionModel: "gpt-4.1-mini",
    thinking: "auto",
    temperatureMode: "balanced",
    maxOutputMode: "standard",
    timeoutSec: 120,
    retryCount: 2,
  },
  agent: {
    enabled: false,
    type: "openclaw",
    connectionMode: "local-app",
    token: "",
    handoffMode: "notify-only",
    channels: [
      { type: "wechat", enabled: false, binding: "", notificationLevel: "failures", allowRemoteActions: false },
      { type: "wecom", enabled: false, binding: "", notificationLevel: "failures", allowRemoteActions: false },
      { type: "lark", enabled: false, binding: "", notificationLevel: "failures", allowRemoteActions: false },
      { type: "dingtalk", enabled: false, binding: "", notificationLevel: "failures", allowRemoteActions: false },
    ],
  },
};

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, value: unknown): T {
  if (Array.isArray(base)) return Array.isArray(value) ? (value as T) : base;
  if (!isRecord(base)) return value === undefined ? base : (value as T);
  const source = isRecord(value) ? value : {};
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base)) {
    merged[key] = deepMerge((base as Record<string, unknown>)[key], source[key]);
  }
  return merged as T;
}

function mergeSettings(value: unknown = {}): RevideoSettings {
  return deepMerge(defaultSettings, value);
}

export function loadSettings(): RevideoSettings {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    saveSettings(defaultSettings);
    return defaultSettings;
  }
  return mergeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")));
}

export function saveSettings(settings: Partial<RevideoSettings>): RevideoSettings {
  ensureDataDir();
  const merged = mergeSettings(settings);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

export function calculateTargetCommentCount(durationSec: number | undefined, repeatTimes = 1, settings = loadSettings()): number {
  const duration = Math.max(0, Number(durationSec || 0));
  const repeats = Math.min(10, Math.max(1, Number(repeatTimes || 1)));
  const seconds = Math.max(0.1, Number(settings.task.download.commentSeconds || 2));
  const target = Math.floor((duration * repeats) / seconds);
  return Math.min(settings.task.download.maxComments, Math.max(0, target));
}
