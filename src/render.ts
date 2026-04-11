import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const MOVIES_DIR = path.join(os.homedir(), "Movies");
const PUBLIC_DIR = path.join(process.cwd(), "public");
const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".mov"];
const AUDIO_EXTS = [".mp3", ".m4a", ".wav", ".aac"];
const SUBTITLE_EXTS = [".srt", ".vtt"];

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

interface DirOption {
  name: string;
  path: string;
  videoFile: string;
  commentFile?: string;
  subtitleFiles: string[];
  audioFiles: string[];
}

function scanDirs(): DirOption[] {
  const results: DirOption[] = [];
  const entries = fs.readdirSync(MOVIES_DIR);

  for (const entry of entries) {
    const fullPath = path.join(MOVIES_DIR, entry);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    const files = fs.readdirSync(fullPath);
    const videoFile = files.find((f) =>
      VIDEO_EXTS.includes(path.extname(f).toLowerCase())
    );
    if (!videoFile) continue;

    results.push({
      name: entry,
      path: fullPath,
      videoFile: path.join(fullPath, videoFile),
      commentFile: files
        .filter((f) => path.extname(f).toLowerCase() === ".json")
        .map((f) => path.join(fullPath, f))[0],
      subtitleFiles: files
        .filter((f) => SUBTITLE_EXTS.includes(path.extname(f).toLowerCase()))
        .map((f) => path.join(fullPath, f)),
      audioFiles: files
        .filter((f) => AUDIO_EXTS.includes(path.extname(f).toLowerCase()))
        .map((f) => path.join(fullPath, f)),
    });
  }
  return results;
}

async function promptSelect(options: DirOption[]): Promise<DirOption> {
  const { createInterface } = await import("readline");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n选择一个视频目录来渲染:\n");
  options.forEach((opt, i) => {
    const hasComments = opt.commentFile ? "✓评论" : "";
    const hasSubs = opt.subtitleFiles.length > 0 ? "✓字幕" : "";
    const extras = [hasComments, hasSubs].filter(Boolean).join(" ");
    console.log(`  ${i + 1}. ${opt.name}  ${extras}`);
  });
  console.log();

  return new Promise((resolve) => {
    rl.question("输入序号: ", (answer) => {
      rl.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx]);
      } else {
        console.error("无效选择");
        process.exit(1);
      }
    });
  });
}

function preparePublicDir(option: DirOption) {
  // Clean public dir
  if (fs.existsSync(PUBLIC_DIR)) {
    fs.rmSync(PUBLIC_DIR, { recursive: true });
  }
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  // Copy video
  const videoExt = path.extname(option.videoFile);
  fs.copyFileSync(option.videoFile, path.join(PUBLIC_DIR, `video${videoExt}`));

  // Copy comment file
  if (option.commentFile) {
    fs.copyFileSync(option.commentFile, path.join(PUBLIC_DIR, "comments.json"));
  }

  // Copy subtitle files
  option.subtitleFiles.forEach((subFile) => {
    fs.copyFileSync(subFile, path.join(PUBLIC_DIR, "subtitles.vtt"));
  });

  // Copy audio files
  option.audioFiles.forEach((audioFile) => {
    const basename = path.basename(audioFile);
    fs.copyFileSync(audioFile, path.join(PUBLIC_DIR, basename));
  });
}

async function main() {
  const dirs = scanDirs();
  if (dirs.length === 0) {
    console.error("在 ~/Movies 下没有找到包含视频的目录");
    process.exit(1);
  }

  const selected =
    process.argv.length > 2
      ? dirs.find((d) => d.name === process.argv[2]) || dirs[0]
      : await promptSelect(dirs);

  console.log(`\n选中: ${selected.name}`);
  console.log("准备文件...");
  preparePublicDir(selected);

  // Determine duration: comments.json duration > ffprobe > fallback 60s
  const localVideo = path.join(PUBLIC_DIR, `video${path.extname(selected.videoFile)}`);
  let durationSec = getVideoDuration(localVideo);
  if (selected.commentFile) {
    try {
      const data = JSON.parse(fs.readFileSync(selected.commentFile, "utf-8"));
      if (data.duration) durationSec = data.duration;
    } catch {}
  }

  const fps = 30;
  const totalFrames = Math.ceil(durationSec * fps);

  console.log(`视频时长: ${durationSec.toFixed(1)}秒, 总帧数: ${totalFrames}`);
  console.log("开始渲染...\n");

  // Build props JSON
  const props = {
    dirPath: selected.path,
    videoFile: `video${path.extname(selected.videoFile)}`,
    commentFile: selected.commentFile ? "comments.json" : "",
    subtitleFiles: selected.subtitleFiles.length > 0 ? ["subtitles.vtt"] : [],
    durationInFrames: totalFrames,
  };

  // Write props to file to avoid shell escaping issues
  const propsFile = path.join(PUBLIC_DIR, "render-props.json");
  fs.writeFileSync(propsFile, JSON.stringify(props));

  execSync(
    `npx remotion render VideoComments out/${selected.name}.mp4 ` +
      `--props "${propsFile}" ` +
      `--fps ${fps} ` +
      `--frames 0-${totalFrames}`,
    {
      stdio: "inherit",
      cwd: process.cwd(),
    }
  );

  console.log(`\n✅ 渲染完成: out/${selected.name}.mp4`);
}

main().catch(console.error);
