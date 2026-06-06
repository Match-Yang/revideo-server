import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import https from "https";
import http from "http";
import type { DirInfo, Comment } from "./types";
import { scanMoviesDir } from "./scan-dir";
import { renderFfmpegComments } from "./renderers/ffmpeg-comments";

const PROXY = "http://127.0.0.1:7897";

function downloadWithProxy(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proxyUrl = new URL(PROXY);
    const targetUrl = new URL(url);

    const connectReq = http.request({
      host: proxyUrl.hostname,
      port: +proxyUrl.port,
      method: "CONNECT",
      path: `${targetUrl.hostname}:443`,
    });

    connectReq.on("connect", (_res, socket) => {
      const req = https.get(
        ({
          hostname: targetUrl.hostname,
          path: targetUrl.pathname + targetUrl.search,
          socket,
          agent: false,
          headers: { Host: targetUrl.hostname },
        } as any),
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const location = res.headers.location!;
            downloadWithProxy(location).then(resolve).catch(reject);
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        }
      );
      req.on("error", reject);
    });

    connectReq.on("error", reject);
    connectReq.end();
  });
}

const PUBLIC_DIR = path.join(process.cwd(), "public");

export interface RenderOptions {
  dirName: string;
}

export interface RenderProgress {
  stage: string;
  percent: number;
  message: string;
}

/** Normalize comments.json to { comments: Comment[], duration: number } format */
function normalizeComments(commentFilePath: string, videoDuration: number) {
  const raw = JSON.parse(fs.readFileSync(commentFilePath, "utf-8"));

  // Already in correct format (yt-dlp info JSON)
  if (raw && !Array.isArray(raw) && Array.isArray(raw.comments)) {
    raw.duration = videoDuration;
    fs.writeFileSync(commentFilePath, JSON.stringify(raw));
    return;
  }

  // Flat array of comments -> wrap in object
  if (Array.isArray(raw)) {
    const normalized = { comments: raw, duration: videoDuration };
    fs.writeFileSync(commentFilePath, JSON.stringify(normalized));
    return;
  }
}

/** Get video duration in seconds using ffprobe */
function getVideoDuration(videoPath: string): number {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_format "${videoPath}"`,
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const info = JSON.parse(out.toString());
    return parseFloat(info.format?.duration) || 60;
  } catch {
    return 60;
  }
}

function getVideoDimensions(videoPath: string): { width: number; height: number } {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${videoPath}"`,
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const info = JSON.parse(out.toString());
    const video = (info.streams || []).find((s: any) => s.codec_type === "video");
    return { width: video?.width || 1920, height: video?.height || 1080 };
  } catch {
    return { width: 1920, height: 1080 };
  }
}

export function preparePublicDir(dir: DirInfo) {
  if (fs.existsSync(PUBLIC_DIR)) {
    fs.rmSync(PUBLIC_DIR, { recursive: true });
  }
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  // Copy video
  const videoExt = path.extname(dir.videoFile!);
  const localVideo = path.join(PUBLIC_DIR, `video${videoExt}`);
  fs.copyFileSync(dir.videoFile!, localVideo);

  // Get actual video duration. Job rendering can repeat the same short source
  // video so the final output has room for more comments.
  const videoDuration = getVideoDuration(localVideo);
  const repeatTimes = Math.min(10, Math.max(1, Number(dir.repeatTimes || 1)));
  const outputDuration = videoDuration * repeatTimes;

  // Copy and normalize comment file
  if (dir.commentFile) {
    const localComments = path.join(PUBLIC_DIR, "comments.json");
    fs.copyFileSync(dir.commentFile, localComments);
    normalizeComments(localComments, outputDuration);
  }

  // Copy subtitle file (keep original name)
  if (dir.subtitleFiles.length > 0) {
    fs.copyFileSync(dir.subtitleFiles[0], path.join(PUBLIC_DIR, path.basename(dir.subtitleFiles[0])));
  }

  // Copy audio files
  for (const audioFile of dir.audioFiles) {
    const basename = path.basename(audioFile);
    fs.copyFileSync(audioFile, path.join(PUBLIC_DIR, basename));
  }
}

async function downloadAvatars(): Promise<void> {
  const commentsPath = path.join(PUBLIC_DIR, "comments.json");
  if (!fs.existsSync(commentsPath)) {
    console.log("[Avatar] No comments.json found, skipping");
    return;
  }

  const data = JSON.parse(fs.readFileSync(commentsPath, "utf-8"));
  const allComments: Comment[] = data.comments || [];

  // Download avatars for ALL comments (headless browser can't access remote URLs)
  const flat = allComments.flatMap((c) => [c, ...(c.replies || [])]);
  const needDownload = flat.filter((c) => {
    const url = c.author_thumbnail;
    return url && url.startsWith("http");
  });
  console.log(`[Avatar] ${flat.length} total, ${needDownload.length} need download`);

  const avatarsDir = path.join(PUBLIC_DIR, "avatars");
  fs.mkdirSync(avatarsDir, { recursive: true });

  const BATCH = 30;
  let downloaded = 0;
  let failed = 0;
  let firstError = "";

  for (let i = 0; i < needDownload.length; i += BATCH) {
    const batch = needDownload.slice(i, i + BATCH);
    await Promise.all(
      batch.map((comment) => {
        const url = comment.author_thumbnail;
        if (!url || !url.startsWith("http")) return Promise.resolve();

        const filename = `${comment.id}.jpg`;
        const localPath = path.join(avatarsDir, filename);

        return downloadWithProxy(url)
          .then((buf) => {
            const size = buf.length;
            if (size > 100) {
              fs.writeFileSync(localPath, buf);
              comment.author_thumbnail = `avatars/${filename}`;
              downloaded++;
            } else {
              failed++;
            }
          })
          .catch((err) => {
            failed++;
            if (!firstError) {
              firstError = `${err.message} url=${url.substring(0, 60)}`;
            }
          });
      })
    );
    console.log(`[Avatar] ${Math.min(i + BATCH, needDownload.length)}/${needDownload.length} (${downloaded} ok, ${failed} fail)`);
  }

  fs.writeFileSync(commentsPath, JSON.stringify(data));
  console.log(`[Avatar] Result: ${downloaded} ok, ${failed} fail`);
  if (firstError) console.log(`[Avatar] First error: ${firstError}`);
}

export function getDirs(): DirInfo[] {
  return scanMoviesDir();
}

export function getDirByName(name: string): DirInfo | undefined {
  return getDirs().find((d) => d.name === name);
}

export async function renderWithFFmpeg(
  dir: DirInfo,
  onProgress?: (progress: RenderProgress) => void,
  signal?: AbortSignal,
  outputDir?: string
): Promise<{ output: string; durationSec: number }> {
  const emit = (stage: string, percent: number, message: string) => {
    onProgress?.({ stage, percent, message });
  };

  emit("preparing", 0, "准备文件 (ffmpeg)...");

  preparePublicDir(dir);
  if (dir.commentFile) {
    emit("downloading-avatars", 3, "下载头像...");
    await downloadAvatars();
  }

  const videoExt = path.extname(dir.videoFile!);
  const sourceVideoPath = path.join(PUBLIC_DIR, `video${videoExt}`);
  const sourceVideoDurationSec = getVideoDuration(sourceVideoPath);
  const repeatTimes = Math.min(10, Math.max(1, Number(dir.repeatTimes || 1)));
  let durationSec = sourceVideoDurationSec * repeatTimes;
  const commentsPath = path.join(PUBLIC_DIR, "comments.json");
  if (fs.existsSync(commentsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(commentsPath, "utf-8"));
      if (data.duration) durationSec = Math.max(durationSec, Number(data.duration) || 0);
    } catch (err) {
      console.warn(`[ffmpeg Render] Failed to read comments duration: ${err}`);
    }
  }

  const resolvedOutDir = outputDir || path.join(process.cwd(), "out");
  if (!fs.existsSync(resolvedOutDir)) {
    fs.mkdirSync(resolvedOutDir, { recursive: true });
  }

  const absOutputPath = path.join(resolvedOutDir, `${dir.name}.mp4`);
  const subtitlePath = dir.subtitleFiles.length > 0
    ? path.join(PUBLIC_DIR, path.basename(dir.subtitleFiles[0]))
    : undefined;
  const hasComments = fs.existsSync(commentsPath);

  if (hasComments) {
    emit("rendering", 8, "开始 ffmpeg 评论渲染...");
    await renderFfmpegComments({
      videoPath: sourceVideoPath,
      commentPath: commentsPath,
      subtitlePath,
      avatarDir: path.join(PUBLIC_DIR, "avatars"),
      outputPath: absOutputPath,
      durationSec,
      fps: 30,
      signal,
      onProgress,
    });
  } else {
    const vfParts: string[] = [];

    if (subtitlePath) {
      const tmpSub = `/tmp/revideo-${dir.name}.vtt`;
      fs.copyFileSync(subtitlePath, tmpSub);
      const dims = getVideoDimensions(sourceVideoPath);
      const isPortrait = dims.height > dims.width;
      const fontSize = 14;
      const outlineWidth = Math.max(1, Math.round(fontSize / 8));
      if (isPortrait) {
        const marginV = Math.round(288 / 3);
        const escapedStyle = `FontSize=${fontSize}\\,PrimaryColour=&Hffffff\\,OutlineColour=&H40000000\\,BackColour=&H80000000\\,Outline=${outlineWidth}\\,Shadow=0\\,Alignment=8\\,MarginV=${marginV}`;
        vfParts.push(`subtitles=${tmpSub}:force_style=${escapedStyle}`);
      } else {
        const escapedStyle = `FontSize=${fontSize}\\,PrimaryColour=&Hffffff\\,OutlineColour=&H40000000\\,BackColour=&H80000000\\,Outline=${outlineWidth}\\,Shadow=0`;
        vfParts.push(`subtitles=${tmpSub}:force_style=${escapedStyle}`);
      }
    }

    const vf = vfParts.length > 0 ? vfParts.join(",") : undefined;

    const ffmpegArgs: string[] = [
      "-y",
      "-stream_loop", "-1",
      "-i", sourceVideoPath,
      "-t", String(durationSec),
    ];
    if (vf) ffmpegArgs.push("-vf", vf);
    ffmpegArgs.push(
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-shortest",
      "-movflags", "+faststart",
      absOutputPath,
    );

    emit("rendering", 10, "开始 ffmpeg 渲染...");
    console.log(`[ffmpeg Render] Duration: ${durationSec}s, no filters (original aspect ratio)`);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ffmpegArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.cwd(),
      });

      if (signal) {
        signal.addEventListener("abort", () => {
          proc.kill("SIGKILL");
          reject(new Error("ffmpeg render aborted"));
        });
      }

      let stderr = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        const timeMatch = stderr.match(/time=(\d+):(\d+):(\d+)\.(\d+)/g);
        if (timeMatch) {
          const last = timeMatch[timeMatch.length - 1];
          const parts = last.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
          if (parts) {
            const currentTime = +parts[1] * 3600 + +parts[2] * 60 + +parts[3] + +parts[4] / 100;
            const progress = Math.min(95, Math.round((currentTime / durationSec) * 85));
            emit("rendering", 10 + progress, `ffmpeg 渲染 ${Math.round((currentTime / durationSec) * 100)}%`);
          }
        }
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });
      proc.on("error", reject);
    });
  }

  // Extract cover
  emit("extracting-cover", 96, "提取封面...");
  const absCoverPath = path.join(resolvedOutDir, `${dir.name}-cover.jpg`);
  if (!fs.existsSync(absCoverPath)) {
    try {
      execSync(
        `ffmpeg -y -i "${sourceVideoPath}" -frames:v 1 -q:v 2 "${absCoverPath}"`,
        { stdio: "pipe", cwd: process.cwd() }
      );
    } catch (err) {
      console.warn(`[ffmpeg Render] Failed to extract cover: ${err}`);
    }
  }

  emit("done", 100, "ffmpeg 渲染完成");
  return { output: absOutputPath, durationSec };
}
