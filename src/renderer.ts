import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import https from "https";
import http from "http";
import type { DirInfo, Comment } from "./types";
import { scanMoviesDir } from "./scan-dir";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { RenderMediaOnProgress } from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";

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

function webpackOverride(config: any): any {
  const next = enableTailwind(config);
  next.cache = false;
  next.snapshot = {
    ...next.snapshot,
    managedPaths: [],
    immutablePaths: [],
  };
  next.output = {
    ...next.output,
    hashFunction: "sha256",
  };
  return next;
}

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
  // video so the final composition has room for more comments.
  const videoDuration = getVideoDuration(localVideo);
  const repeatTimes = Math.min(10, Math.max(1, Number(dir.repeatTimes || 1)));
  const compositionDuration = videoDuration * repeatTimes;

  // Copy and normalize comment file
  if (dir.commentFile) {
    const localComments = path.join(PUBLIC_DIR, "comments.json");
    fs.copyFileSync(dir.commentFile, localComments);
    normalizeComments(localComments, compositionDuration);
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

export async function render(
  dir: DirInfo,
  onProgress?: (progress: RenderProgress) => void,
  signal?: AbortSignal
): Promise<{ output: string; durationSec: number }> {
  const emit = (stage: string, percent: number, message: string) => {
    onProgress?.({ stage, percent, message });
  };

  emit("preparing", 0, "准备文件...");
  preparePublicDir(dir);

  emit("downloading-avatars", 3, "下载头像...");
  await downloadAvatars();

  // Determine duration from source video and repeatTimes. comments.json is
  // normalized to this value, so it must not shrink repeated Shorts back down.
  const videoExt = path.extname(dir.videoFile!);
  const localVideo = path.join(PUBLIC_DIR, `video${videoExt}`);
  const sourceVideoDurationSec = getVideoDuration(localVideo);
  const repeatTimes = Math.min(10, Math.max(1, Number(dir.repeatTimes || 1)));
  let durationSec = sourceVideoDurationSec * repeatTimes;
  const commentsPath = path.join(PUBLIC_DIR, "comments.json");
  if (fs.existsSync(commentsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(commentsPath, "utf-8"));
      if (data.duration) durationSec = Math.max(durationSec, Number(data.duration) || 0);
    } catch {}
  }

  const fps = 30;
  const totalFrames = Math.ceil(durationSec * fps);

  const inputProps = {
    dirPath: dir.path,
    videoFile: `video${videoExt}`,
    commentFile: dir.commentFile ? "comments.json" : "",
    subtitleFiles: dir.subtitleFiles.length > 0 ? [path.basename(dir.subtitleFiles[0])] : [],
    durationInFrames: totalFrames,
    sourceVideoDurationInFrames: Math.max(1, Math.ceil(sourceVideoDurationSec * fps)),
  };

  // Ensure out dir exists
  const outDir = path.join(process.cwd(), "out");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`[Render] Duration: ${durationSec}s, Frames: ${totalFrames}, Comments: ${fs.existsSync(commentsPath)}`);

  // Bundle the Remotion project
  emit("bundling", 5, "打包项目...");
  const bundleLocation = await bundle({
    entryPoint: path.resolve("./src/index.ts"),
    enableCaching: false,
    webpackOverride,
    signal,
  } as any);

  // Select composition with inputProps (triggers calculateMetadata)
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "VideoComments",
    inputProps,
    signal,
  } as any);

  const totalRenderFrames = composition.durationInFrames;

  // Render with full progress tracking (frames + encoding)
  let lastOverallPercent = 8;

  const onRenderProgress: RenderMediaOnProgress = ({
    progress,
    renderedFrames,
    encodedFrames,
    stitchStage,
  }) => {
    // progress is 0-1, map to 8-95%
    const overallPercent = 8 + Math.round(progress * 87);
    if (overallPercent <= lastOverallPercent) return;
    lastOverallPercent = overallPercent;

    const pct = Math.round(progress * 100);
    if (stitchStage === "muxing") {
      emit("muxing", overallPercent, `合成音轨 ${pct}%`);
    } else if (encodedFrames === 0) {
      emit("rendering", overallPercent, `渲染帧 ${pct}% (${renderedFrames}/${totalRenderFrames})`);
    } else {
      emit("encoding", overallPercent, `编码视频 ${pct}% (${encodedFrames}/${totalRenderFrames})`);
    }
  };

  emit("rendering", 8, `开始渲染 (${totalRenderFrames} 帧, ${durationSec.toFixed(1)}s)...`);

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: `out/${dir.name}.mp4`,
    inputProps,
    imageFormat: "jpeg",
    overwrite: true,
    onProgress: onRenderProgress,
    signal,
    chromiumOptions: {
      args: [`--proxy-server=${PROXY}`],
    },
  } as any);

  emit("extracting-cover", 96, "提取封面...");

  // Only extract a cover if generate-cover step hasn't already produced one
  const coverPath = `out/${dir.name}-cover.jpg`;
  const absCoverPath = path.resolve(process.cwd(), coverPath);
  if (!fs.existsSync(absCoverPath)) {
    try {
      execSync(
        `ffmpeg -y -i "${dir.videoFile}" -frames:v 1 -q:v 2 "${coverPath}"`,
        { stdio: "pipe", cwd: process.cwd() }
      );
      console.log(`[Render] Cover saved: ${coverPath}`);
    } catch (err) {
      console.warn(`[Render] Failed to extract cover: ${err}`);
    }
  } else {
    console.log(`[Render] Cover already exists, skipping extraction`);
  }

  emit("done", 100, "渲染完成");
  return { output: `out/${dir.name}.mp4`, durationSec };
}
