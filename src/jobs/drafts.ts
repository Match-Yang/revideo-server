import fs from "fs";
import path from "path";
import { translateJSON } from "../translate/openai-compatible";
import { loadSettings, type RevideoSettings } from "../settings";
import type { JobTarget, RevideoJob, TargetPlatform } from "./types";

function getJobConfig(job: RevideoJob): RevideoSettings {
  const snapshot = job.settingsSnapshot as RevideoSettings | undefined;
  if (snapshot?.task?.publish && snapshot?.task?.translation) return snapshot;
  return loadSettings();
}

function sourceTitle(job: RevideoJob): string {
  const title = job.source.metadata?.title;
  return typeof title === "string" ? title : job.source.contentId || job.id;
}

function sourceDescription(job: RevideoJob): string {
  const raw = job.source.metadata?.raw as Record<string, unknown> | undefined;
  const parts = [
    `原视频链接：${job.source.url}`,
    raw?.uploader_id ? `原作者频道ID：${raw.uploader_id}` : undefined,
    raw?.upload_date ? `原视频发布时间：${raw.upload_date}` : undefined,
    raw?.view_count ? `观看数：${raw.view_count}` : undefined,
    raw?.like_count ? `点赞数：${raw.like_count}` : undefined,
    raw?.comment_count ? `评论数：${raw.comment_count}` : undefined,
  ].filter(Boolean);
  return parts.join("\n");
}

function cleanTitle(value: string): string {
  return value
    .replace(/^["'""''\s]+|["'""''\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface BilibiliDraft {
  title: string;
  description: string;
  tags: string[];
  category: string;
}

const BILIBILI_PROMPT = [
  "你是 B 站视频投稿文案生成助手。",
  "根据用户提供的原始视频标题，生成以下内容，以 JSON 格式返回：",
  `{`,
  `  "title": "极具吸引力的 B 站风格中文标题，不超过80字",`,
  `  "description": "简短有吸引力的视频简介，1-3句话，抛出有对立性的问题引导观众讨论",`,
  `  "tags": ["标签1", "标签2", "标签3", "标签4", "标签5", "标签6", "标签7", "标签8", "标签9"],`,
  `  "category": "最匹配的 B 站视频分区名称"`,
  `}`,
  "",
  "要求：",
  "- 标题要接地气、有网感，能引起好奇心（如：外国网友：喂！你的购置税在你前面跑啊！）",
  "- 简介要抛出有争议或对立性的问题，激发评论区讨论",
  "- tags 共 9 个，与标题和简介内容高度相关",
  "- category 必须是以下分区之一：影视、娱乐、音乐、舞蹈、动画、绘画、鬼畜、游戏、资讯、知识、人工智能、科技数码、汽车、时尚美妆、家装房产、户外潮流、健身、体育运动、手工、美食、小剧场、旅游出行、三农、动物、亲子、健康、情感、vlog、生活兴趣、生活经验",
  "- 只输出 JSON，不要输出其他内容",
].join("\n");

function buildBilibiliPrompt(settings: RevideoSettings): string {
  const biliPrompts = settings.task.publish.platformConfigs.bilibili.prompts;

  const titleExtra = biliPrompts.title || "";
  const descExtra = biliPrompts.description || "";
  const tagsExtra = biliPrompts.tags || "";

  const extras: string[] = [];
  if (titleExtra) extras.push(`- 标题额外要求：${titleExtra}`);
  if (descExtra) extras.push(`- 简介额外要求：${descExtra}`);
  if (tagsExtra) extras.push(`- 标签额外要求：${tagsExtra}`);

  return extras.length > 0
    ? `${BILIBILI_PROMPT}\n\n用户补充要求：\n${extras.join("\n")}`
    : BILIBILI_PROMPT;
}

async function generateBilibiliDraft(
  job: RevideoJob,
): Promise<Record<string, unknown>> {
  const title = sourceTitle(job);
  const sourceDesc = sourceDescription(job);
  const targetLanguage = job.options.targetLanguage || "zh-CN";
  const settings = getJobConfig(job);
  const biliConfig = settings.task.publish.platformConfigs.bilibili;
  const settingsCategory = biliConfig.category;
  const declaration = biliConfig.declaration || "";

  // Default tags from settings (comma-separated string → array)
  const defaultTags = biliConfig.tags
    ? biliConfig.tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean)
    : [];

  if (!/^zh/i.test(targetLanguage)) {
    const fallbackTags = defaultTags.length > 0 ? defaultTags : ["外网评论", "海外视频"];
    return {
      title,
      description: sourceDesc,
      tags: fallbackTags,
      category: settingsCategory || "生活兴趣",
      declaration,
    };
  }

  const systemPrompt = buildBilibiliPrompt(settings);

  let draft: BilibiliDraft;
  try {
    draft = await translateJSON<BilibiliDraft>({
      text: title,
      systemPrompt,
    });
  } catch {
    draft = {
      title,
      description: "",
      tags: defaultTags.length > 0 ? defaultTags : ["转载", "海外视频"],
      category: settingsCategory || "生活兴趣",
    };
  }

  const cleanDraftTitle = cleanTitle(draft.title) || title;
  const description = draft.description
    ? `${draft.description}\n\n${sourceDesc}`
    : sourceDesc;

  // Merge AI-generated tags with user-configured default tags (defaultTags first)
  const aiTags = Array.isArray(draft.tags) ? draft.tags.map(String) : [];
  const mergedTags = [...defaultTags, ...aiTags.filter((t) => !defaultTags.includes(t))].slice(0, 9);

  return {
    title: cleanDraftTitle.slice(0, 80),
    description,
    tags: mergedTags.length > 0 ? mergedTags : ["转载", "海外视频"],
    category: settingsCategory || draft.category || "生活兴趣",
    declaration,
  };
}

export async function generateDraftForPlatform(
  job: RevideoJob,
  platform: TargetPlatform,
): Promise<Record<string, unknown>> {
  if (platform === "bilibili") {
    return generateBilibiliDraft(job);
  }

  const title = sourceTitle(job);
  const description = sourceDescription(job);

  if (platform === "douyin") {
    return {
      title: title.slice(0, 30),
      description: `${title}\n\n${description}\n#海外视频 #评论区`,
    };
  }

  return {
    title,
    description,
  };
}

export async function generateDrafts(job: RevideoJob): Promise<JobTarget[]> {
  const copyDir = path.join(job.artifacts.derivedDir, "copy");
  fs.mkdirSync(copyDir, { recursive: true });

  const targets: JobTarget[] = [];
  for (const target of job.targets) {
    const draft = await generateDraftForPlatform(job, target.platform);
    fs.writeFileSync(
      path.join(copyDir, `${target.platform}.json`),
      JSON.stringify(draft, null, 2),
    );
    const next: JobTarget = {
      ...target,
      draft,
      status: target.status === "published" ? target.status : "drafted",
    };
    targets.push(next);
  }
  return targets;
}
