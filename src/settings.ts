import fs from "fs";
import { DATA_DIR, SETTINGS_FILE } from "./config";
import type { TargetPlatform } from "./jobs/types";

export interface RevideoSettings {
  download: {
    landscapeResolution: string;
    portraitResolution: string;
    commentSeconds: number;
    maxComments: number;
  };
  production: {
    subtitleTargetLanguage: string;
    subtitleRetranslateTargetLanguage: boolean;
    subtitlePositivePrompt: string;
    subtitleNegativePrompt: string;
    commentTargetLanguage: string;
    commentRetranslateTargetLanguage: boolean;
    commentPositivePrompt: string;
    commentNegativePrompt: string;
  };
  publishing: {
    defaultPlatforms: TargetPlatform[];
    scheduleMode: "immediate" | "scheduled";
    retryCount: number;
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
    };
  };
}

export const defaultSettings: RevideoSettings = {
  download: {
    landscapeResolution: "1080p",
    portraitResolution: "1080p",
    commentSeconds: 2,
    maxComments: 800,
  },
  production: {
    subtitleTargetLanguage: "zh-CN",
    subtitleRetranslateTargetLanguage: false,
    subtitlePositivePrompt: "保持字幕简洁自然，符合中文视频口语表达，保留必要专有名词。",
    subtitleNegativePrompt: "删除或改写政治煽动、违法、色情、暴力、仇恨、诈骗、辱骂、平台高风险内容；宁可误杀，不要放过。",
    commentTargetLanguage: "zh-CN",
    commentRetranslateTargetLanguage: false,
    commentPositivePrompt: "将非中文评论翻译为自然中文；中文评论保持原文；保留用户语气但不要美化危险内容。",
    commentNegativePrompt: "过滤政治敏感、违法交易、色情低俗、仇恨辱骂、诈骗引流、极端主义、平台容易下架的内容；对模糊风险内容按不通过处理。",
  },
  publishing: {
    defaultPlatforms: ["bilibili"],
    scheduleMode: "immediate",
    retryCount: 1,
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
    },
  },
};

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function mergeSettings(value: Partial<RevideoSettings> = {}): RevideoSettings {
  return {
    ...defaultSettings,
    ...value,
    download: { ...defaultSettings.download, ...(value.download || {}) },
    production: { ...defaultSettings.production, ...(value.production || {}) },
    publishing: {
      ...defaultSettings.publishing,
      ...(value.publishing || {}),
      platformConfigs: {
        bilibili: {
          ...defaultSettings.publishing.platformConfigs.bilibili,
          ...(value.publishing?.platformConfigs?.bilibili || {}),
        },
        douyin: {
          ...defaultSettings.publishing.platformConfigs.douyin,
          ...(value.publishing?.platformConfigs?.douyin || {}),
        },
      },
    },
  };
}

export function loadSettings(): RevideoSettings {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    saveSettings(defaultSettings);
    return defaultSettings;
  }
  return mergeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as Partial<RevideoSettings>);
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
  const seconds = Math.max(0.1, Number(settings.download.commentSeconds || 2));
  const target = Math.floor((duration * repeats) / seconds);
  return Math.min(settings.download.maxComments, Math.max(0, target));
}
