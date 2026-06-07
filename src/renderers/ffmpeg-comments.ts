import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import sharp from "sharp";
import type { Comment } from "../types";

export type CommentStyleName = "classic-dark" | "light" | "bilibili" | "douyin" | "xiaohongshu";
export type SizeName = "small" | "medium" | "large";
export type LineHeightName = "compact" | "standard" | "loose";
export type SpeedName = "slow" | "standard" | "fast";
export type LongCommentBehavior = "wrap" | "truncate" | "shrink";

interface CommentTheme {
  panelBg: string;
  cardBg: string;
  authorColor: string;
  textColor: string;
  metaColor: string;
  avatarBg: string;
  avatarText: string;
}

const THEMES: Record<CommentStyleName, CommentTheme> = {
  "classic-dark": { panelBg: "#000000", cardBg: "#1a1a1a", authorColor: "#e5e7eb", textColor: "#f9fafb", metaColor: "#888888", avatarBg: "#3f3f46", avatarText: "#d4d4d8" },
  light: { panelBg: "#f3f4f6", cardBg: "#ffffff", authorColor: "#1f2937", textColor: "#111827", metaColor: "#9ca3af", avatarBg: "#d4d4d8", avatarText: "#52525b" },
  bilibili: { panelBg: "#0f1419", cardBg: "#18222b", authorColor: "#00a1d6", textColor: "#e3e5e7", metaColor: "#9499a0", avatarBg: "#00a1d6", avatarText: "#ffffff" },
  douyin: { panelBg: "#000000", cardBg: "#161616", authorColor: "#fe2c55", textColor: "#ffffff", metaColor: "#999999", avatarBg: "#fe2c55", avatarText: "#ffffff" },
  xiaohongshu: { panelBg: "#ffffff", cardBg: "#fff6f7", authorColor: "#ff2442", textColor: "#333333", metaColor: "#999999", avatarBg: "#ff2442", avatarText: "#ffffff" },
};

export interface CommentRenderStyle {
  width: number;
  height: number;
  style: CommentStyleName;
  fontSize: SizeName;
  lineHeight: LineHeightName;
  speed: SpeedName;
  longCommentBehavior: LongCommentBehavior;
  subtitleFontSize: SizeName;
  subtitleLineHeight: LineHeightName;
}

const DEFAULT_STYLE: CommentRenderStyle = {
  width: 1080,
  height: 1920,
  style: "classic-dark",
  fontSize: "medium",
  lineHeight: "standard",
  speed: "standard",
  longCommentBehavior: "wrap",
  subtitleFontSize: "medium",
  subtitleLineHeight: "standard",
};

interface Layout {
  width: number;
  height: number;
  videoHeight: number;
  commentsTop: number;
  commentGap: number;
  cardX: number;
  cardWidth: number;
  cardPaddingTop: number;
  cardPaddingBottom: number;
  authorBlock: number;
  textLineHeight: number;
  paragraphGap: number;
  metaLineHeight: number;
  metaMarginTop: number;
  minCommentHeight: number;
  scrollSpeed: number;
  leftText: number;
  textStart: number;
  authorBaseline: number;
  avatarCx: number;
  avatarCy: number;
  avatarR: number;
  initialsBaseline: number;
  authorFont: number;
  textFont: number;
  metaFont: number;
  initialsFont: number;
  charsPerLine: number;
  maxLines: number;
  ellipsis: boolean;
  theme: CommentTheme;
}

function buildLayout(style: CommentRenderStyle): Layout {
  const width = Math.max(320, Math.round(style.width) || 1080);
  const height = Math.max(320, Math.round(style.height) || 1920);
  const s = width / 1080;
  const fontMul = style.fontSize === "small" ? 0.88 : style.fontSize === "large" ? 1.18 : 1;
  const lhMul = style.lineHeight === "compact" ? 0.86 : style.lineHeight === "loose" ? 1.2 : 1;
  const speedMul = style.speed === "slow" ? 0.6 : style.speed === "fast" ? 1.6 : 1;
  const px = (value: number) => Math.round(value * s);

  const cardX = px(48);
  const cardWidth = width - cardX * 2;
  const leftText = px(132);
  const rightPad = px(48);
  const textFont = Math.round(27 * s * fontMul);
  const charsPerLine = Math.max(8, Math.floor((cardWidth - leftText - rightPad) / textFont));
  const behavior = style.longCommentBehavior;
  const maxLines = behavior === "truncate" ? 8 : behavior === "shrink" ? 14 : 20;
  const ellipsis = behavior === "truncate";

  return {
    width,
    height,
    videoHeight: Math.round(height / 2),
    commentsTop: Math.round(height / 2),
    commentGap: px(16),
    cardX,
    cardWidth,
    cardPaddingTop: px(26),
    cardPaddingBottom: px(24),
    authorBlock: px(52),
    textLineHeight: Math.round(34 * s * lhMul),
    paragraphGap: px(8),
    metaLineHeight: px(30),
    metaMarginTop: px(10),
    minCommentHeight: px(136),
    scrollSpeed: 88 * s * speedMul,
    leftText,
    textStart: px(86),
    authorBaseline: px(46),
    avatarCx: px(66),
    avatarCy: px(62),
    avatarR: px(40),
    initialsBaseline: px(75),
    authorFont: Math.round(26 * s * fontMul),
    textFont,
    metaFont: Math.round(24 * s * fontMul),
    initialsFont: Math.round(34 * s * fontMul),
    charsPerLine,
    maxLines,
    ellipsis,
    theme: THEMES[style.style] || THEMES["classic-dark"],
  };
}

const SUBTITLE_FONT_SIZE: Record<SizeName, number> = { small: 12, medium: 14, large: 18 };
const SUBTITLE_LINE_SPACING: Record<LineHeightName, number> = { compact: -2, standard: 0, loose: 8 };

export interface FfmpegCommentRenderProgress {
  stage: string;
  percent: number;
  message: string;
}

export interface FfmpegCommentRenderOptions {
  videoPath: string;
  commentPath?: string;
  subtitlePath?: string;
  avatarDir?: string;
  outputPath: string;
  durationSec: number;
  fps?: number;
  signal?: AbortSignal;
  onProgress?: (progress: FfmpegCommentRenderProgress) => void;
  style?: CommentRenderStyle;
}

interface LaidOutComment {
  comment: Comment;
  height: number;
  textLines: TextLine[];
  avatarDataUri?: string;
}

interface TextLine {
  text: string;
  paragraphStart: boolean;
}

function emit(
  options: FfmpegCommentRenderOptions,
  stage: string,
  percent: number,
  message: string,
) {
  options.onProgress?.({ stage, percent, message });
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function plainText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/[\uFE00-\uFE0F]/g, "")
    .replace(/[\u200D]/g, "")
    .trim();
}

function initials(author: string): string {
  const clean = plainText(author).replace(/^@/, "").trim();
  return escapeXml((clean[0] || "?").toUpperCase());
}

function charWidth(char: string): number {
  if (/[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF]/u.test(char)) return 1;
  if (/[A-Z]/.test(char)) return 0.64;
  if (/[a-z0-9]/.test(char)) return 0.55;
  if (/\s/.test(char)) return 0.32;
  return 0.72;
}

function textWidth(text: string): number {
  return [...text].reduce((sum, char) => sum + charWidth(char), 0);
}

function tokenizeParagraph(paragraph: string): string[] {
  const tokens = paragraph.match(/[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF]|[^\s\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF]+|\s+/gu);
  return tokens || [];
}

function trimLineEnd(value: string): string {
  return value.replace(/\s+$/g, "");
}

function wrapParagraph(paragraph: string, maxWidth: number): string[] {
  const tokens = tokenizeParagraph(paragraph.replace(/\s+/g, " ").trim());
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;

  for (const token of tokens) {
    const normalizedToken = /^\s+$/.test(token) ? " " : token;
    const tokenWidth = textWidth(normalizedToken);

    if (line && lineWidth + tokenWidth > maxWidth) {
      lines.push(trimLineEnd(line));
      line = normalizedToken.trimStart();
      lineWidth = textWidth(line);
    } else {
      const appended = line ? normalizedToken : normalizedToken.trimStart();
      line += appended;
      lineWidth += textWidth(appended);
    }

    while (lineWidth > maxWidth && [...line].length > 1) {
      let take = "";
      let width = 0;
      for (const char of [...line]) {
        const nextWidth = width + charWidth(char);
        if (take && nextWidth > maxWidth) break;
        take += char;
        width = nextWidth;
      }
      lines.push(trimLineEnd(take));
      line = line.slice(take.length).trimStart();
      lineWidth = textWidth(line);
    }
  }

  if (line.trim()) lines.push(trimLineEnd(line));
  return lines;
}

function wrapText(text: string, maxWidth: number, maxLines: number, ellipsis = true): TextLine[] {
  const paragraphs = plainText(text)
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const lines: TextLine[] = [];

  for (const paragraph of paragraphs.length ? paragraphs : [" "]) {
    const wrapped = wrapParagraph(paragraph, maxWidth);
    wrapped.forEach((line, index) => {
      if (lines.length < maxLines) {
        lines.push({ text: line, paragraphStart: index === 0 && lines.length > 0 });
      }
    });
    if (lines.length >= maxLines) break;
  }

  if (ellipsis && lines.length === maxLines) {
    const originalWidth = paragraphs.reduce((sum, paragraph) => sum + textWidth(paragraph), 0);
    const visibleWidth = lines.reduce((sum, line) => sum + textWidth(line.text), 0);
    if (originalWidth > visibleWidth) {
      lines[maxLines - 1] = {
        ...lines[maxLines - 1],
        text: `${lines[maxLines - 1].text.replace(/.{1,3}$/u, "")}...`,
      };
    }
  }

  return lines.length ? lines : [{ text: " ", paragraphStart: false }];
}

function mimeTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function findAvatarDataUri(comment: Comment, avatarDir?: string): string | undefined {
  if (!avatarDir) return undefined;
  const candidates = [".jpg", ".jpeg", ".png", ".webp"].map((ext) =>
    path.join(avatarDir, `${comment.id}${ext}`),
  );
  const localPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!localPath) return undefined;
  const data = fs.readFileSync(localPath).toString("base64");
  return `data:${mimeTypeFor(localPath)};base64,${data}`;
}

function readComments(commentPath?: string): Comment[] {
  if (!commentPath || !fs.existsSync(commentPath)) return [];
  const data = JSON.parse(fs.readFileSync(commentPath, "utf-8"));
  const comments = Array.isArray(data) ? data : data.comments;
  if (!Array.isArray(comments)) return [];
  return comments;
}

function layoutComments(comments: Comment[], layout: Layout, avatarDir?: string): LaidOutComment[] {
  return comments.map((comment) => {
    const textLines = wrapText(comment.text || "", layout.charsPerLine, layout.maxLines, layout.ellipsis);
    const textBlockHeight = textLines.reduce(
      (sum, line) => sum + layout.textLineHeight + (line.paragraphStart ? layout.paragraphGap : 0),
      0,
    );
    const height = Math.max(
      layout.minCommentHeight,
      layout.cardPaddingTop + layout.authorBlock + textBlockHeight + layout.metaMarginTop + layout.metaLineHeight + layout.cardPaddingBottom,
    );
    return {
      comment,
      height,
      textLines,
      avatarDataUri: findAvatarDataUri(comment, avatarDir),
    };
  });
}

function formatLikes(count: number): string {
  if (!count) return "👍";
  return `👍 ${count}`;
}

function formatRelativeTime(ts: number): string {
  if (!ts || ts <= 0) return "";
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - ts);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}个月前`;
  return `${Math.floor(diff / 31536000)}年前`;
}

function metaItems(comment: Comment): string[] {
  const items = [formatLikes(Number(comment.like_count || 0))];
  const replyCount = comment.replies?.length || 0;
  if (replyCount > 0) items.push(`💬 ${replyCount}条回复`);
  const time = formatRelativeTime(Number(comment.timestamp || 0));
  if (time) items.push(time);
  return items;
}

function renderCommentCard(item: LaidOutComment, x: number, y: number, layout: Layout): string {
  const { comment, textLines, height, avatarDataUri } = item;
  const { theme } = layout;
  const author = escapeXml(plainText(comment.author || "匿名用户"));
  const clipId = `avatar-${escapeXml(comment.id)}-${Math.round(y)}`;
  const cx = x + layout.avatarCx;
  const cy = y + layout.avatarCy;
  const r = layout.avatarR;
  let cursorY = y + layout.textStart;
  const textSvg = textLines.map((line) => {
    if (line.paragraphStart) cursorY += layout.paragraphGap;
    const tspan = `<tspan x="${x + layout.leftText}" y="${cursorY}">${escapeXml(line.text)}</tspan>`;
    cursorY += layout.textLineHeight;
    return tspan;
  }).join("");
  const metaText = escapeXml(metaItems(comment).join("    "));
  const metaY = cursorY + layout.metaMarginTop;

  return `
    <g>
      <rect x="${x}" y="${y}" width="${layout.cardWidth}" height="${height}" rx="14" fill="${theme.cardBg}"/>
      <clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${theme.avatarBg}"/>
      ${
        avatarDataUri
          ? `<image href="${avatarDataUri}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
          : `<text x="${cx}" y="${y + layout.initialsBaseline}" text-anchor="middle" font-size="${layout.initialsFont}" font-weight="800" fill="${theme.avatarText}">${initials(comment.author || "")}</text>`
      }
      <text x="${x + layout.leftText}" y="${y + layout.authorBaseline}" font-size="${layout.authorFont}" font-weight="700" fill="${theme.authorColor}">${author}</text>
      <text x="${x + layout.leftText}" y="${y + layout.textStart}" font-size="${layout.textFont}" font-weight="500" fill="${theme.textColor}">${textSvg}</text>
      <text x="${x + layout.leftText}" y="${metaY}" font-size="${layout.metaFont}" font-weight="500" fill="${theme.metaColor}">${metaText}</text>
    </g>
  `;
}

function overlaySvg(comments: LaidOutComment[], frame: number, fps: number, layout: Layout): string {
  const panelHeight = layout.height - layout.commentsTop;
  const cycleHeight = comments.reduce((sum, comment) => sum + comment.height + layout.commentGap, 0);
  const offset = cycleHeight > 0
    ? ((frame / fps) * layout.scrollSpeed) % cycleHeight
    : 0;
  const repeats = cycleHeight > 0 ? Math.ceil((panelHeight + cycleHeight) / cycleHeight) + 1 : 0;
  const cards: string[] = [];

  for (let repeat = 0; repeat < repeats; repeat++) {
    let cursorY = layout.commentsTop + repeat * cycleHeight - offset;
    for (const item of comments) {
      const y = cursorY;
      if (y <= layout.height && y + item.height >= layout.commentsTop) {
        cards.push(renderCommentCard(item, layout.cardX, y, layout));
      }
      cursorY += item.height + layout.commentGap;
    }
  }

  return `
    <svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
      </style>
      <rect x="0" y="${layout.commentsTop}" width="${layout.width}" height="${panelHeight}" fill="${layout.theme.panelBg}"/>
      <clipPath id="comments-panel"><rect x="0" y="${layout.commentsTop}" width="${layout.width}" height="${panelHeight}"/></clipPath>
      <g clip-path="url(#comments-panel)">${cards.join("")}</g>
    </svg>
  `;
}

function writeFrame(stdin: NodeJS.WritableStream, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      stdin.off("error", onError);
      reject(err);
    };
    stdin.once("error", onError);
    stdin.write(buffer, () => {
      stdin.off("error", onError);
      resolve();
    });
  });
}

function ffmpegSubtitleFilter(subtitlePath: string | undefined, fontSize: number, lineHeight: LineHeightName): string {
  if (!subtitlePath) return "";
  const escapedPath = subtitlePath.replace(/'/g, "'\\''").replace(/:/g, "\\:");
  const outline = Math.max(1, Math.round(fontSize / 7));
  const lineSpacing = SUBTITLE_LINE_SPACING[lineHeight] ?? 0;
  const style = `FontSize=${fontSize}\\,PrimaryColour=&Hffffff\\,OutlineColour=&H40000000\\,BackColour=&H80000000\\,Outline=${outline}\\,Shadow=0\\,LineSpacing=${lineSpacing}`;
  return `,subtitles='${escapedPath}':force_style='${style}'`;
}

function buildFilter(options: FfmpegCommentRenderOptions, layout: Layout, subtitleFontSize: number, subtitleLineHeight: LineHeightName): string {
  const subtitleFilter = ffmpegSubtitleFilter(options.subtitlePath, subtitleFontSize, subtitleLineHeight);
  const { width, height, videoHeight } = layout;
  const loopVideo = `[0:v]setpts=PTS-STARTPTS,scale=${width}:${videoHeight}:force_original_aspect_ratio=decrease,pad=${width}:${videoHeight}:(ow-iw)/2:(oh-ih)/2:black${subtitleFilter}[video]`;
  return [
    `color=c=black:s=${width}x${height}:d=${options.durationSec}[canvas]`,
    loopVideo,
    `[canvas][video]overlay=0:0:shortest=0[base]`,
    `[1:v]format=rgba[overlay]`,
    `[base][overlay]overlay=0:0:format=auto[outv]`,
  ].join(";");
}

export async function renderFfmpegComments(
  options: FfmpegCommentRenderOptions,
): Promise<void> {
  const fps = options.fps || 30;
  const style = { ...DEFAULT_STYLE, ...(options.style || {}) };
  const layout = buildLayout(style);
  const subtitleFontSize = SUBTITLE_FONT_SIZE[style.subtitleFontSize] || SUBTITLE_FONT_SIZE.medium;
  const subtitleLineHeight = style.subtitleLineHeight || "standard";
  const comments = layoutComments(readComments(options.commentPath), layout, options.avatarDir);
  const totalFrames = Math.ceil(options.durationSec * fps);
  const filter = buildFilter(options, layout, subtitleFontSize, subtitleLineHeight);

  emit(options, "encoding", 8, `准备 FFmpeg 评论层 (${comments.length} 条)...`);

  const ffmpegArgs = [
    "-y",
    "-stream_loop", "-1",
    "-i", options.videoPath,
    "-f", "image2pipe",
    "-framerate", String(fps),
    "-i", "pipe:0",
    "-t", String(options.durationSec),
    "-filter_complex", filter,
    "-map", "[outv]",
    "-map", "0:a?",
    "-r", String(fps),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "medium",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
  ];
  ffmpegArgs.push("-af", "loudnorm=I=-16:TP=-1.5:LRA=11");
  ffmpegArgs.push(options.outputPath);

  const proc = spawn("ffmpeg", ffmpegArgs, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      proc.kill("SIGKILL");
    });
  }

  let stderr = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  for (let frame = 0; frame < totalFrames; frame++) {
    if (options.signal?.aborted) {
      proc.kill("SIGKILL");
      throw new Error("ffmpeg comments render aborted");
    }
    const svg = overlaySvg(comments, frame, fps, layout);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    await writeFrame(proc.stdin, png);
    if (frame % Math.max(1, fps) === 0) {
      const percent = 8 + Math.round((frame / totalFrames) * 87);
      emit(options, "encoding", percent, `渲染评论层 ${frame}/${totalFrames}`);
    }
  }
  proc.stdin.end();

  await new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1200)}`));
      }
    });
    proc.on("error", reject);
  });

  emit(options, "encoding", 95, "FFmpeg 评论视频编码完成");
}
