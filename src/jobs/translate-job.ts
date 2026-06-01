import fs from "fs";
import path from "path";
import type { RevideoJob } from "./types";
import type { RevideoSettings } from "../settings";
import { loadSettings } from "../settings";
import {
  findLocalSensitiveReason,
  translateBatchWithSafetyReview,
  translateSubtitleBatchWithContext,
  subtitleContextAwarePrompt,
  SENSITIVE_PLACEHOLDER,
  type SafetyReviewInput,
} from "./moderation";
import {
  cleanSubtitleText,
  normalizeYouTubeRollingWebVtt,
  parseSubtitleTimestamp,
} from "../subtitles/normalize";

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
    translatedCount: number;
    failedCount: number;
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

interface SubtitleFailedItemReport {
  id: string;
  start: number;
  end: number;
  timestampRange: string;
  originalText: string;
  reason: string;
  detail: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    })
  );

  return results;
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

function expectsChinese(targetLanguage: string): boolean {
  return /^(zh|cmn|yue)|chinese|中文/i.test(targetLanguage);
}

function isNonSemanticText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/^https?:\/\/\S+$/i.test(normalized)) return true;
  if (/^#?[\p{Letter}\p{Number}_-]{1,8}$/u.test(normalized) && !/\s/.test(normalized)) return true;
  if (/[A-Za-z\u3400-\u9fff]/.test(normalized)) return false;
  return /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Number}\p{Punctuation}\p{Symbol}\p{Separator}\s]+$/u.test(normalized);
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
  const batchSize = Number(process.env.TRANSLATE_COMMENT_BATCH_SIZE || 50);
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

  const batches = chunk(inputs, batchSize);
  const concurrency = Math.min(10, Math.max(1, Number(process.env.TRANSLATE_COMMENT_CONCURRENCY || 10)));
  const batchResults = await mapConcurrent(batches, concurrency, (batch) =>
    translateBatchWithSafetyReview(batch, targetLanguage, "comment", context)
  );

  for (const results of batchResults) {
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
        if (expectsChinese(targetLanguage) && !hasChinese(originalText) && !hasChinese(translatedText)) {
          if (isNonSemanticText(originalText)) {
            comment.text = originalText.trim();
            continue;
          }
          comment.text = "__SENSITIVE__";
          sensitiveCommentIds.add(commentId(comment, -1));
          dropped.push({
            id: result.id,
            kind: "comment",
            reason: "missing-target-language",
            text: originalText,
            author: typeof comment.author === "string" ? comment.author : undefined,
            authorId: commentAuthorId(comment) || undefined,
          });
          droppedCount++;
          continue;
        }
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
  start: number;
  end: number;
  text: string;
}

function formatSubtitleTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function parseSubtitleCues(content: string): SubtitleCue[] {
  const normalizedRollingCues = normalizeYouTubeRollingWebVtt(content);
  if (normalizedRollingCues) return normalizedRollingCues;

  const blocks = content
    .split(/\n\s*\n/g)
    .map((block) => block.split(/\r?\n/));
  const cues: SubtitleCue[] = [];

  blocks.forEach((block, blockIndex) => {
    const timingIndex = block.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) return;
    const timing = block[timingIndex].match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
    );
    if (!timing) return;
    let textStart = timingIndex + 1;
    while (textStart < block.length && !block[textStart].trim()) textStart++;
    const textLines = block.slice(textStart);
    const text = cleanSubtitleText(textLines.join("\n"));
    if (!text) return;
    cues.push({
      id: `cue-${blockIndex}`,
      start: parseSubtitleTimestamp(timing[1]),
      end: parseSubtitleTimestamp(timing[2]),
      text,
    });
  });

  return cues;
}

function sanitizeTranslatedSubtitleText(value: string): string {
  return cleanSubtitleText(value)
    .replace(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/g, "")
    .replace(/\bWEBVTT\b/gi, "")
    .replace(/^[（(]?\s*(注|说明|备注)[:：].*$/g, "")
    .replace(/原句未完整.*$/g, "")
    .replace(/^[，。、；：！？,.!?;:\s]+/, "")
    .trim();
}

function buildFullSubtitleContext(cues: SubtitleCue[]): string {
  return cues.map((c, i) => `${i + 1} ${c.text}`).join("\n");
}

async function translateSubtitleFile(
  sourcePath: string,
  targetDir: string,
  targetLanguage: string,
  context: string,
  userPrompt: string,
): Promise<{
  inputCount: number;
  translatedCount: number;
  failedCount: number;
  failedItems: SubtitleFailedItemReport[];
  outputPaths: string[];
}> {
  const content = fs.readFileSync(sourcePath, "utf-8").replace(/\r\n/g, "\n");
  const cues = parseSubtitleCues(content);
  const batchSize = Number(process.env.TRANSLATE_SUBTITLE_BATCH_SIZE || 100);

  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  const fullSubtitleText = buildFullSubtitleContext(cues);
  const systemPrompt = subtitleContextAwarePrompt(targetLanguage, context, fullSubtitleText, userPrompt);

  const inputs: SafetyReviewInput[] = cues.map((cue) => ({ id: cue.id, text: cue.text }));
  const translatedById = new Map<string, string>();
  const failedItems: SubtitleFailedItemReport[] = [];
  let translatedCount = 0;
  let failedCount = 0;

  const batches = chunk(inputs, batchSize);
  const concurrency = Math.min(10, Math.max(1, Number(process.env.TRANSLATE_SUBTITLE_CONCURRENCY || 10)));

  // Cache warmup: first batch completes, wait 3s for cache persistence, then remaining batches concurrent
  const batchResults: Awaited<ReturnType<typeof translateSubtitleBatchWithContext>>[] = [];

  if (batches.length > 0) {
    batchResults.push(await translateSubtitleBatchWithContext(batches[0], targetLanguage, systemPrompt));

    if (batches.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const remainingResults = await mapConcurrent(batches.slice(1), concurrency, (batch) =>
        translateSubtitleBatchWithContext(batch, targetLanguage, systemPrompt),
      );
      batchResults.push(...remainingResults);
    }
  }

  for (const results of batchResults) {
    for (const result of results) {
      const cue = cueById.get(result.id);
      if (!cue) throw new Error(`Translated cue id not found: ${result.id}`);

      if (result.action === "sensitive" || result.translation === SENSITIVE_PLACEHOLDER) {
        failedCount += 1;
        failedItems.push({
          id: cue.id,
          start: cue.start,
          end: cue.end,
          timestampRange: `${formatSubtitleTimestamp(cue.start)} --> ${formatSubtitleTimestamp(cue.end)}`,
          originalText: cue.text,
          reason: result.reason?.startsWith("translated-") ? "sensitive-local" : "sensitive",
          detail: result.reason || "model",
        });
        continue;
      }

      const translation = sanitizeTranslatedSubtitleText(result.translation || "");
      const postScanReason = findLocalSensitiveReason(translation);
      if (postScanReason) {
        failedCount += 1;
        failedItems.push({
          id: cue.id,
          start: cue.start,
          end: cue.end,
          timestampRange: `${formatSubtitleTimestamp(cue.start)} --> ${formatSubtitleTimestamp(cue.end)}`,
          originalText: cue.text,
          reason: "sensitive-local",
          detail: `translated-${postScanReason}`,
        });
        continue;
      }

      translatedById.set(cue.id, translation || cue.text);
      translatedCount += 1;
    }
  }

  fs.mkdirSync(targetDir, { recursive: true });

  // Pure translation VTT
  const ext = path.extname(sourcePath) || ".vtt";
  const purePath = path.join(targetDir, `translated.${targetLanguage}${ext}`);
  const pureBlocks = cues
    .map((cue) => {
      const text = translatedById.get(cue.id) || cue.text;
      return `${formatSubtitleTimestamp(cue.start)} --> ${formatSubtitleTimestamp(cue.end)}\n${text}`;
    });
  fs.writeFileSync(purePath, `WEBVTT\nKind: captions\nLanguage: ${targetLanguage}\n\n${pureBlocks.join("\n\n")}\n`);

  // Bilingual VTT
  const bilingualPath = path.join(targetDir, `translated.${targetLanguage}.bilingual${ext}`);
  const bilingualBlocks = cues
    .map((cue) => {
      const text = translatedById.get(cue.id) || cue.text;
      return `${formatSubtitleTimestamp(cue.start)} --> ${formatSubtitleTimestamp(cue.end)}\n${text}\n${cue.text}`;
    });
  fs.writeFileSync(bilingualPath, `WEBVTT\nKind: captions\nLanguage: ${targetLanguage}\n\n${bilingualBlocks.join("\n\n")}\n`);

  return {
    inputCount: cues.length,
    translatedCount,
    failedCount,
    failedItems,
    outputPaths: [purePath, bilingualPath],
  };
}

export async function translateSubtitles(job: RevideoJob, targetLanguage: string) {
  const normalized = job.source.metadata?.normalizedAssets as
    | { subtitlePaths?: string[] }
    | undefined;
  const subtitlePaths = normalized?.subtitlePaths || [];
  if (subtitlePaths.length === 0) {
    return { status: "skipped" as const, inputCount: 0, translatedCount: 0, failedCount: 0, outputPaths: [] };
  }

  const settings = (job.settingsSnapshot || {}) as Partial<RevideoSettings>;
  const userPrompt =
    (settings.production?.subtitlePrompt as string) || "保持字幕简洁自然，符合目标语言视频口语表达，保留必要专有名词。";
  const context = sourceContext(job, job.source.metadata?.title);
  const targetDir = path.join(job.artifacts.sourceDir, "subtitles");

  let inputCount = 0;
  let translatedCount = 0;
  let failedCount = 0;
  const allFailedItems: SubtitleFailedItemReport[] = [];
  const outputPaths: string[] = [];

  for (const subtitlePath of subtitlePaths.slice(0, 1)) {
    const result = await translateSubtitleFile(subtitlePath, targetDir, targetLanguage, context, userPrompt);
    inputCount += result.inputCount;
    translatedCount += result.translatedCount;
    failedCount += result.failedCount;
    allFailedItems.push(...result.failedItems);
    outputPaths.push(...result.outputPaths);
  }

  const reportPath =
    inputCount > 0
      ? path.join(targetDir, `subtitle-report.${targetLanguage}.json`)
      : undefined;
  if (reportPath) {
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          inputCount,
          translatedCount,
          failedCount,
          items: allFailedItems,
        },
        null,
        2,
      ),
    );
  }

  return {
    status: inputCount > 0 ? ("translated" as const) : ("skipped" as const),
    inputCount,
    translatedCount,
    failedCount,
    outputPaths,
    ...(reportPath ? { reportPath } : {}),
  };
}

export async function translateJobAssets(job: RevideoJob): Promise<JobTranslationResult> {
  const targetLanguage = job.options.targetLanguage || "zh-CN";
  const renderComments = job.options.renderComments ?? loadSettings().production.renderComments;
  const comments = renderComments === false
    ? { status: "skipped" as const, inputCount: 0, droppedCount: 0 }
    : await translateComments(job, targetLanguage);
  const subtitles = await translateSubtitles(job, targetLanguage);

  return {
    comments,
    subtitles,
  };
}
