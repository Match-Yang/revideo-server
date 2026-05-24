import fs from "fs";
import path from "path";
import type { RevideoJob } from "./types";
import { findLocalSensitiveReason, translateBatchWithSafetyReview, type SafetyReviewInput } from "./moderation";

interface CommentLike {
  text?: string;
  replies?: CommentLike[];
  [key: string]: unknown;
}

export interface JobTranslationResult {
  comments: {
    status: "translated" | "skipped";
    inputCount: number;
    droppedCount: number;
    outputPath?: string;
    reportPath?: string;
  };
  subtitles: {
    status: "translated" | "skipped";
    inputCount: number;
    droppedCount: number;
    outputPaths: string[];
    reportPath?: string;
  };
}

interface DroppedItemReport {
  id: string;
  kind: "comment" | "subtitle";
  reason: string;
  text: string;
  author?: string;
  authorId?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function commentId(comment: CommentLike, index: number): string {
  const raw = comment.id || comment.comment_id || `comment-${index}`;
  return String(raw);
}

function commentAuthorId(comment: CommentLike): string {
  const raw = comment.author_id || comment.author || comment.user_id || comment.id || comment.comment_id || "";
  return String(raw);
}

function hasChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function translatedCommentText(original: string, translation: string): string {
  const cleanOriginal = original.trim();
  let cleanTranslation = translation.trim();
  if (hasChinese(cleanOriginal)) return cleanOriginal;
  if (!cleanTranslation || cleanTranslation === cleanOriginal) return cleanOriginal;
  if (cleanTranslation.startsWith(cleanOriginal)) {
    cleanTranslation = cleanTranslation.slice(cleanOriginal.length).trim();
  }
  const lines = cleanTranslation.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1 && lines[0] === cleanOriginal) {
    cleanTranslation = lines.slice(1).join("\n").trim();
  }
  return cleanTranslation ? `${cleanOriginal}\n${cleanTranslation}` : cleanOriginal;
}

function sourceContext(job: RevideoJob, title?: unknown): string {
  const parts = [
    typeof title === "string" ? `Video title: ${title}` : undefined,
    typeof job.source.author === "string" ? `Source author: ${job.source.author}` : undefined,
    `Source platform: ${job.source.platform}`,
  ].filter(Boolean);
  return parts.join("\n");
}

async function translateComments(job: RevideoJob, targetLanguage: string) {
  const normalized = job.source.metadata?.normalizedAssets as
    | { normalizedCommentsPath?: string }
    | undefined;
  const commentsPath = normalized?.normalizedCommentsPath;
  if (!commentsPath || !fs.existsSync(commentsPath)) {
    return { status: "skipped" as const, inputCount: 0, droppedCount: 0 };
  }

  const data = JSON.parse(fs.readFileSync(commentsPath, "utf-8")) as {
    title?: unknown;
    comments?: CommentLike[];
    [key: string]: unknown;
  };
  const context = sourceContext(job, data.title || job.source.metadata?.title);
  const comments = data.comments || [];
  for (const comment of comments) {
    if (Array.isArray(comment.replies)) delete comment.replies;
  }

  const topLevel = comments.filter((comment) => {
    const parent = comment.parent;
    return parent === undefined || parent === null || parent === "" || parent === "root";
  });
  const candidates = topLevel.filter((comment) => comment.text?.trim());
  if (candidates.length === 0) {
    return { status: "skipped" as const, inputCount: 0, droppedCount: 0 };
  }

  const configuredLimit = Number(process.env.TRANSLATE_COMMENT_LIMIT || 800);
  const targetCount = Number(job.options.targetCommentCount || configuredLimit);
  const limit = Math.max(1, Math.min(configuredLimit, targetCount));
  const batchSize = Number(process.env.TRANSLATE_COMMENT_BATCH_SIZE || 100);
  const selected = candidates.slice(0, limit);
  let droppedCount = 0;

  const byId = new Map<string, CommentLike>();
  const sensitiveAuthors = new Set<string>();
  const sensitiveCommentIds = new Set<string>();
  const dropped: DroppedItemReport[] = [];
  const inputs: SafetyReviewInput[] = selected.map((comment, index) => {
    const id = commentId(comment, index);
    byId.set(id, comment);
    return { id, text: comment.text || "" };
  });

  for (const batch of chunk(inputs, batchSize)) {
    const results = await translateBatchWithSafetyReview(batch, targetLanguage, "comment", context);
    for (const result of results) {
      const comment = byId.get(result.id);
      if (!comment) throw new Error(`Translated comment id not found: ${result.id}`);
      if (result.action === "drop") {
        const originalText = String(comment.text || "");
        const authorId = commentAuthorId(comment);
        comment.text = "__SENSITIVE__";
        sensitiveCommentIds.add(commentId(comment, -1));
        if (authorId) sensitiveAuthors.add(authorId);
        dropped.push({
          id: result.id,
          kind: "comment",
          reason: result.reason || "model",
          text: originalText,
          author: typeof comment.author === "string" ? comment.author : undefined,
          authorId: authorId || undefined,
        });
        droppedCount++;
      } else {
        const originalText = String(comment.text || "");
        const translatedText = translatedCommentText(originalText, result.translation || "");
        const postScanReason = findLocalSensitiveReason(
          [translatedText, typeof comment.author === "string" ? comment.author : "", commentAuthorId(comment)].join("\n")
        );
        if (postScanReason) {
          comment.text = "__SENSITIVE__";
          sensitiveCommentIds.add(commentId(comment, -1));
          const authorId = commentAuthorId(comment);
          if (authorId) sensitiveAuthors.add(authorId);
          dropped.push({
            id: result.id,
            kind: "comment",
            reason: `postscan-${postScanReason}`,
            text: originalText,
            author: typeof comment.author === "string" ? comment.author : undefined,
            authorId: authorId || undefined,
          });
          droppedCount++;
        } else {
          comment.text = translatedText;
        }
      }
    }
  }

  data.comments = topLevel.filter((comment) => {
    const authorId = commentAuthorId(comment);
    return (
      comment.text !== "__SENSITIVE__" &&
      !sensitiveCommentIds.has(commentId(comment, -1)) &&
      !(authorId && sensitiveAuthors.has(authorId))
    );
  });

  const outputPath = path.join(job.artifacts.sourceDir, "comments", `translated.${targetLanguage}.json`);
  const reportPath = path.join(job.artifacts.sourceDir, "comments", `moderation-report.${targetLanguage}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify({ dropped }, null, 2));
  return { status: "translated" as const, inputCount: selected.length, droppedCount, outputPath, reportPath };
}

interface SubtitleCue {
  id: string;
  blockIndex: number;
  textStart: number;
  textEnd: number;
  text: string;
}

function parseSubtitleBlocks(content: string): { blocks: string[][]; cues: SubtitleCue[] } {
  const blocks = content
    .split(/\n\s*\n/g)
    .map((block) => block.split(/\r?\n/));
  const cues: SubtitleCue[] = [];

  blocks.forEach((block, blockIndex) => {
    const timingIndex = block.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) return;
    let textStart = timingIndex + 1;
    while (textStart < block.length && !block[textStart].trim()) textStart++;
    const textEnd = block.length;
    const text = block.slice(textStart, textEnd).join("\n").trim();
    if (!text) return;
    cues.push({
      id: `cue-${blockIndex}`,
      blockIndex,
      textStart,
      textEnd,
      text,
    });
  });

  return { blocks, cues };
}

async function translateSubtitleFile(
  sourcePath: string,
  targetPath: string,
  targetLanguage: string,
  context: string
): Promise<{ inputCount: number; droppedCount: number; dropped: DroppedItemReport[] }> {
  const content = fs.readFileSync(sourcePath, "utf-8").replace(/\r\n/g, "\n");
  const { blocks, cues } = parseSubtitleBlocks(content);
  const batchSize = Number(process.env.TRANSLATE_SUBTITLE_BATCH_SIZE || 100);
  let droppedCount = 0;
  const dropped: DroppedItemReport[] = [];

  const inputs: SafetyReviewInput[] = cues.map((cue) => ({ id: cue.id, text: cue.text }));
  const cueById = new Map(cues.map((cue) => [cue.id, cue]));

  for (const batch of chunk(inputs, batchSize)) {
    const results = await translateBatchWithSafetyReview(batch, targetLanguage, "subtitle", context);
    for (const result of results) {
      const cue = cueById.get(result.id);
      if (!cue) throw new Error(`Translated subtitle cue id not found: ${result.id}`);
      const block = blocks[cue.blockIndex];
      const replacement = result.action === "drop" ? "" : hasChinese(cue.text) ? cue.text : result.translation || "";
      if (result.action === "drop") {
        droppedCount++;
        dropped.push({
          id: result.id,
          kind: "subtitle",
          reason: result.reason || "model",
          text: cue.text,
        });
      }
      block.splice(cue.textStart, cue.textEnd - cue.textStart, replacement);
    }
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, blocks.map((block) => block.join("\n")).join("\n\n"));
  return { inputCount: cues.length, droppedCount, dropped };
}

async function translateSubtitles(job: RevideoJob, targetLanguage: string) {
  const normalized = job.source.metadata?.normalizedAssets as
    | { subtitlePaths?: string[] }
    | undefined;
  const subtitlePaths = normalized?.subtitlePaths || [];
  if (subtitlePaths.length === 0) {
    return { status: "skipped" as const, inputCount: 0, droppedCount: 0, outputPaths: [] };
  }

  const outputPaths: string[] = [];
  let inputCount = 0;
  let droppedCount = 0;
  const dropped: DroppedItemReport[] = [];
  const context = sourceContext(job, job.source.metadata?.title);
  for (const subtitlePath of subtitlePaths.slice(0, 1)) {
    const ext = path.extname(subtitlePath) || ".vtt";
    const targetPath = path.join(job.artifacts.sourceDir, "subtitles", `translated.${targetLanguage}${ext}`);
    const result = await translateSubtitleFile(subtitlePath, targetPath, targetLanguage, context);
    inputCount += result.inputCount;
    droppedCount += result.droppedCount;
    dropped.push(...result.dropped);
    outputPaths.push(targetPath);
  }

  const reportPath =
    inputCount > 0 ? path.join(job.artifacts.sourceDir, "subtitles", `moderation-report.${targetLanguage}.json`) : undefined;
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({ dropped }, null, 2));
  }

  return {
    status: inputCount > 0 ? ("translated" as const) : ("skipped" as const),
    inputCount,
    droppedCount,
    outputPaths,
    ...(reportPath ? { reportPath } : {}),
  };
}

export async function translateJobAssets(job: RevideoJob): Promise<JobTranslationResult> {
  const targetLanguage = job.options.targetLanguage || "zh-CN";
  const comments = await translateComments(job, targetLanguage);
  const subtitles = await translateSubtitles(job, targetLanguage);

  return {
    comments,
    subtitles,
  };
}
