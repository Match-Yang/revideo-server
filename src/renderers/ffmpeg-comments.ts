import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import sharp from "sharp";
import type { Comment } from "../types";

const WIDTH = 1080;
const HEIGHT = 1920;
const VIDEO_HEIGHT = 960;
const COMMENTS_TOP = 960;
const COMMENT_GAP = 16;
const CARD_X = 48;
const CARD_WIDTH = WIDTH - CARD_X * 2;
const CARD_PADDING_TOP = 26;
const CARD_PADDING_BOTTOM = 24;
const TEXT_LINE_HEIGHT = 34;
const PARAGRAPH_GAP = 8;
const META_LINE_HEIGHT = 30;
const META_MARGIN_TOP = 10;
const MIN_COMMENT_HEIGHT = 136;
const SCROLL_PIXELS_PER_SECOND = 88;

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

function wrapText(text: string, maxWidth: number, maxLines: number): TextLine[] {
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

  if (lines.length === maxLines) {
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

function layoutComments(comments: Comment[], avatarDir?: string): LaidOutComment[] {
  return comments.map((comment) => {
    const textLines = wrapText(comment.text || "", 29, 8);
    const textBlockHeight = textLines.reduce(
      (sum, line) => sum + TEXT_LINE_HEIGHT + (line.paragraphStart ? PARAGRAPH_GAP : 0),
      0,
    );
    const height = Math.max(
      MIN_COMMENT_HEIGHT,
      CARD_PADDING_TOP + 52 + textBlockHeight + META_MARGIN_TOP + META_LINE_HEIGHT + CARD_PADDING_BOTTOM,
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

function renderCommentCard(item: LaidOutComment, x: number, y: number): string {
  const { comment, textLines, height, avatarDataUri } = item;
  const author = escapeXml(plainText(comment.author || "匿名用户"));
  const clipId = `avatar-${escapeXml(comment.id)}-${Math.round(y)}`;
  let cursorY = y + 86;
  const textSvg = textLines.map((line) => {
    if (line.paragraphStart) cursorY += PARAGRAPH_GAP;
    const tspan = `<tspan x="${x + 132}" y="${cursorY}">${escapeXml(line.text)}</tspan>`;
    cursorY += TEXT_LINE_HEIGHT;
    return tspan;
  }).join("");
  const metaText = escapeXml(metaItems(comment).join("    "));
  const metaY = cursorY + META_MARGIN_TOP;

  return `
    <g>
      <rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${height}" rx="14" fill="#1a1a1a"/>
      <clipPath id="${clipId}"><circle cx="${x + 66}" cy="${y + 62}" r="40"/></clipPath>
      <circle cx="${x + 66}" cy="${y + 62}" r="40" fill="#3f3f46"/>
      ${
        avatarDataUri
          ? `<image href="${avatarDataUri}" x="${x + 26}" y="${y + 22}" width="80" height="80" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
          : `<text x="${x + 66}" y="${y + 75}" text-anchor="middle" font-size="34" font-weight="800" fill="#d4d4d8">${initials(comment.author || "")}</text>`
      }
      <text x="${x + 132}" y="${y + 46}" font-size="26" font-weight="700" fill="#e5e7eb">${author}</text>
      <text x="${x + 132}" y="${y + 86}" font-size="27" font-weight="500" fill="#f9fafb">${textSvg}</text>
      <text x="${x + 132}" y="${metaY}" font-size="24" font-weight="500" fill="#888888">${metaText}</text>
    </g>
  `;
}

function overlaySvg(comments: LaidOutComment[], frame: number, fps: number): string {
  const panelHeight = HEIGHT - COMMENTS_TOP;
  const cycleHeight = comments.reduce((sum, comment) => sum + comment.height + COMMENT_GAP, 0);
  const offset = cycleHeight > 0
    ? ((frame / fps) * SCROLL_PIXELS_PER_SECOND) % cycleHeight
    : 0;
  const repeats = cycleHeight > 0 ? Math.ceil((panelHeight + cycleHeight) / cycleHeight) + 1 : 0;
  const cards: string[] = [];

  for (let repeat = 0; repeat < repeats; repeat++) {
    let cursorY = COMMENTS_TOP + repeat * cycleHeight - offset;
    for (const item of comments) {
      const y = cursorY;
      if (y <= HEIGHT && y + item.height >= COMMENTS_TOP) {
        cards.push(renderCommentCard(item, CARD_X, y));
      }
      cursorY += item.height + COMMENT_GAP;
    }
  }

  return `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
      </style>
      <rect x="0" y="${COMMENTS_TOP}" width="${WIDTH}" height="${panelHeight}" fill="#000000"/>
      <clipPath id="comments-panel"><rect x="0" y="${COMMENTS_TOP}" width="${WIDTH}" height="${panelHeight}"/></clipPath>
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

function ffmpegSubtitleFilter(subtitlePath?: string): string {
  if (!subtitlePath) return "";
  const escapedPath = subtitlePath.replace(/'/g, "'\\''").replace(/:/g, "\\:");
  const style = "FontSize=14\\,PrimaryColour=&Hffffff\\,OutlineColour=&H40000000\\,BackColour=&H80000000\\,Outline=2\\,Shadow=0";
  return `,subtitles='${escapedPath}':force_style='${style}'`;
}

function buildFilter(options: FfmpegCommentRenderOptions): string {
  const subtitleFilter = ffmpegSubtitleFilter(options.subtitlePath);
  const loopVideo = `[0:v]setpts=PTS-STARTPTS,scale=${WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black${subtitleFilter}[video]`;
  return [
    `color=c=black:s=${WIDTH}x${HEIGHT}:d=${options.durationSec}[canvas]`,
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
  const comments = layoutComments(readComments(options.commentPath), options.avatarDir);
  const totalFrames = Math.ceil(options.durationSec * fps);
  const filter = buildFilter(options);

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
    options.outputPath,
  ];

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
    const svg = overlaySvg(comments, frame, fps);
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
