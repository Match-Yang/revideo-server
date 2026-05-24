import fs from "fs";
import path from "path";
import { translateText } from "../translate/openai-compatible";
import type { JobTarget, RevideoJob, TargetPlatform } from "./types";

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

function hasChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function cleanTitle(value: string): string {
  return value
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function localizedTitle(job: RevideoJob): Promise<string> {
  const title = sourceTitle(job);
  const targetLanguage = job.options.targetLanguage || "zh-CN";
  if (/^zh/i.test(targetLanguage) && hasChinese(title)) return title;
  if (!/^zh/i.test(targetLanguage)) return title;

  const translated = await translateText({
    text: title,
    targetLanguage,
    systemPrompt: [
      "你是视频平台投稿标题本地化助手。",
      "把用户给出的视频标题翻译成自然、适合中文视频平台的简体中文标题。",
      "只输出标题本身，不要解释，不要加引号，不要输出多种版本。",
      "保留必要品牌名、车型名、专有名词；英文情绪词可转为自然中文表达。",
      "如果原文已经是中文，原样返回，不要繁简转换，不要润色。",
      "标题不得包含违法、色情、仇恨、政治煽动、诈骗引流内容；如原文含高风险内容，改为中性安全表达。",
    ].join("\n"),
  });

  return cleanTitle(translated) || title;
}

export async function generateDraftForPlatform(job: RevideoJob, platform: TargetPlatform): Promise<Record<string, unknown>> {
  const title = await localizedTitle(job);
  const description = sourceDescription(job);

  if (platform === "bilibili") {
    return {
      title: title.slice(0, 80),
      description,
      tags: ["转载", "海外视频", "评论"],
      category: "汽车",
    };
  }

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
      JSON.stringify(draft, null, 2)
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
