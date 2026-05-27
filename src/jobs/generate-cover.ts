import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import sharp from "sharp";
import { getTranslateConfig } from "../translate/openai-compatible";
import type { RevideoJob } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverSelection {
  index: number; // 1-5
  text1: string; // ≤3 chars, emotion word
  text2: string; // 3-7 chars
  text3: string; // ≤10 chars
}

export interface CoverResult {
  coverLandscape: string;
  coverPortrait: string;
  selection: CoverSelection;
}

// ---------------------------------------------------------------------------
// 1. Extract evenly-spaced frames from video
// ---------------------------------------------------------------------------

function getVideoDuration(videoPath: string): number {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_format "${videoPath}"`,
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const info = JSON.parse(out.toString());
    return parseFloat(info.format?.duration) || 60;
  } catch {
    return 60;
  }
}

function extractVideoFrames(
  videoPath: string,
  outputDir: string,
  count = 5,
): string[] {
  fs.mkdirSync(outputDir, { recursive: true });
  const duration = getVideoDuration(videoPath);
  const frames: string[] = [];

  for (let i = 0; i < count; i++) {
    const t = duration * ((2 * i + 1) / (2 * count));
    const outPath = path.join(outputDir, `frame_${i + 1}.jpg`);
    try {
      execSync(
        `ffmpeg -y -ss ${t.toFixed(3)} -i "${videoPath}" -frames:v 1 -q:v 2 "${outPath}"`,
        { stdio: "pipe" },
      );
      frames.push(outPath);
    } catch (err) {
      console.warn(
        `[Cover] Failed to extract frame at ${t.toFixed(1)}s: ${err}`,
      );
    }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// 2. Select best cover + generate text via vision LLM
// ---------------------------------------------------------------------------

const COVER_VISION_PROMPT = [
  "你是一个专业的短视频封面文案专家，擅长根据视频标题为主，视频描述为辅提炼出让人忍不住点击的封面标题。",
  "我会给你5张从视频中均匀抽取的截图（编号1到5），以及视频的标题和描述。",
  "",
  "请完成两个任务：",
  "1. 从5张截图中选出最适合做封面的一张（与标题和描述最契合、画面丰富、视觉冲击力强）",
  "2. 根据视频标题和描述的实际内容，生成三句封面文案，要求：",
  "   - 文案必须紧扣视频的实际主题，让人一看就知道视频讲什么",
  "   - 整体要有吸引力、悬念感或信息量，激发点击欲望",
  "   - 第一句：不超过4个字，是点睛的语气/情绪词（如：海外评论、太牛了、哇塞、666、夸张、离谱、绝了、快看、必看、炸裂等等）",
  "   - 第二句：3到8个字，概括视频核心信息的前半段",
  "   - 第三句：不超过10个字，补全核心信息的后半段",
  "   - 第二句+第三句连读要通顺、有完整含义",
  "",
  "示例（标题：2026年加拿大能购买的10款最豪华SUV）：",
  '{"index":3,"text1":"2026","text2":"加拿大能买到的","text3":"10款最豪华中国SUV"}',
  "示例（标题：美国能买到的首批中国车！老外直呼：这配置比本土车还香？）：",
  '{"index":2,"text1":"快看","text2":"美国能买的中国车","text3":"老外直呼这配置真香！"}',
  "",
  "请严格按以上JSON格式返回，不要输出任何其他内容。index 是选中截图的编号（1到5）。",
].join("\n");

function encodeImageToBase64(imagePath: string): string {
  return fs.readFileSync(imagePath).toString("base64");
}

async function selectCoverWithVision(
  frames: string[],
  title: string,
  description: string,
): Promise<CoverSelection> {
  const config = getTranslateConfig();
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing API key env: ${config.apiKeyEnv}`);
  }

  const userText = `视频标题：${title}\n视频描述：${description}`;

  const content: unknown[] = [
    { type: "text", text: userText },
    ...frames.map((f) => ({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${encodeImageToBase64(f)}` },
    })),
  ];

  const timeoutMs = Math.max(
    1000,
    Number(process.env.TRANSLATE_TIMEOUT_MS || 120000),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(
      `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: COVER_VISION_PROMPT },
            { role: "user", content },
          ],
          temperature: 0.3,
        }),
        signal: controller.signal,
      },
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Cover vision request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(
      `Cover vision request failed: ${resp.status} ${await resp.text()}`,
    );
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Cover vision response did not include content");
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Cover vision response is not valid JSON: ${text}`);
  }

  const selection = JSON.parse(jsonMatch[0]) as CoverSelection;
  if (
    typeof selection.index !== "number" ||
    selection.index < 1 ||
    selection.index > frames.length ||
    typeof selection.text1 !== "string" ||
    typeof selection.text2 !== "string" ||
    typeof selection.text3 !== "string"
  ) {
    throw new Error(`Invalid cover selection: ${JSON.stringify(selection)}`);
  }

  return selection;
}

// ---------------------------------------------------------------------------
// 3. Compose cover image with text overlay
// ---------------------------------------------------------------------------

const LANDSCAPE_W = 1440;
const LANDSCAPE_H = 1080;
const PORTRAIT_W = 1080;
const PORTRAIT_H = 1920;

const TEXT_STYLES: { color: string; stroke: string; strokeWidth: number }[] = [
  { color: "#FF2D2D", stroke: "#000000", strokeWidth: 10 }, // text1: red + black stroke
  { color: "#FF8C00", stroke: "#FFFFFF", strokeWidth: 12 }, // text2: orange + white border
  { color: "#FFD700", stroke: "#000000", strokeWidth: 6 }, // text3: gold + black stroke
];
const FONT_STACK =
  "Heiti SC, PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function landscapeTextSvg(texts: string[]): Buffer {
  const fontSizes = [240, 130, 100];
  const lineGap = 20;
  const x = LANDSCAPE_W * 0.06;
  const totalHeight = fontSizes[0] + fontSizes[1] + fontSizes[2] + lineGap * 2;
  const startY = (LANDSCAPE_H - totalHeight) / 2;
  const yPositions = [
    startY + fontSizes[0] / 2,
    startY + fontSizes[0] + lineGap + fontSizes[1] / 2,
    startY + fontSizes[0] + lineGap + fontSizes[1] + lineGap + fontSizes[2] / 2,
  ];

  const els = texts
    .map((t, i) => {
      const s = TEXT_STYLES[i];
      return `<text x="${x}" y="${yPositions[i]}" dominant-baseline="central" font-size="${fontSizes[i]}" font-weight="900" fill="${s.color}" font-family="${FONT_STACK}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" paint-order="stroke" stroke-linejoin="round">${escapeXml(t)}</text>`;
    })
    .join("");

  return Buffer.from(
    `<svg width="${LANDSCAPE_W}" height="${LANDSCAPE_H}" xmlns="http://www.w3.org/2000/svg">${els}</svg>`,
  );
}

function portraitTextSvg(texts: string[]): Buffer {
  const fontSizes = [187, 100, 80];
  const lineGap = 20;
  const totalHeight = fontSizes[0] + fontSizes[1] + fontSizes[2] + lineGap * 2;
  const startY = (PORTRAIT_H - totalHeight) / 2;
  const xPositions = [PORTRAIT_W * 0.18, PORTRAIT_W * 0.48, PORTRAIT_W * 0.75];
  const yPositions = [
    startY + fontSizes[0] / 2,
    startY + fontSizes[0] + lineGap + fontSizes[1] / 2,
    startY + fontSizes[0] + lineGap + fontSizes[1] + lineGap + fontSizes[2] / 2,
  ];

  const els = texts
    .map((t, i) => {
      const s = TEXT_STYLES[i];
      return `<text x="${xPositions[i]}" y="${yPositions[i]}" dominant-baseline="hanging" font-size="${fontSizes[i]}" font-weight="900" fill="${s.color}" font-family="${FONT_STACK}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" paint-order="stroke" stroke-linejoin="round" writing-mode="tb">${escapeXml(t)}</text>`;
    })
    .join("");

  return Buffer.from(
    `<svg width="${PORTRAIT_W}" height="${PORTRAIT_H}" xmlns="http://www.w3.org/2000/svg">${els}</svg>`,
  );
}

async function composeCover(
  framePath: string,
  texts: string[],
  orientation: "landscape" | "portrait",
): Promise<Buffer> {
  const w = orientation === "landscape" ? LANDSCAPE_W : PORTRAIT_W;
  const h = orientation === "landscape" ? LANDSCAPE_H : PORTRAIT_H;

  const baseImage = sharp(framePath)
    .resize(w, h, { fit: "cover", position: "center" })
    .modulate({ brightness: 0.55 });

  const overlaySvg = `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="rgba(0,0,0,0.35)"/></svg>`;
  const overlayBuf = Buffer.from(overlaySvg);

  const textBuf =
    orientation === "landscape"
      ? landscapeTextSvg(texts)
      : portraitTextSvg(texts);

  return baseImage
    .composite([
      { input: overlayBuf, blend: "over" },
      { input: textBuf, blend: "over" },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// 4. Orchestrate
// ---------------------------------------------------------------------------

export async function generateCover(job: RevideoJob): Promise<CoverResult> {
  const normalized = job.source.metadata?.normalizedAssets as
    | { mediaPath?: string }
    | undefined;
  const mediaPath = normalized?.mediaPath;
  if (!mediaPath || !fs.existsSync(mediaPath)) {
    throw new Error("Job does not have a source video for cover generation");
  }

  const title =
    (typeof job.source.metadata?.title === "string"
      ? job.source.metadata.title
      : job.source.contentId) || job.id;
  const raw = job.source.metadata?.raw as Record<string, unknown> | undefined;
  const description =
    (typeof raw?.description === "string" ? raw.description : "") || title;

  const framesDir = path.join(job.artifacts.derivedDir, "cover-frames");
  const frames = extractVideoFrames(mediaPath, framesDir, 5);
  if (frames.length < 2) {
    throw new Error("Failed to extract enough frames for cover generation");
  }
  console.log(`[Cover] Extracted ${frames.length} frames`);

  const selection = await selectCoverWithVision(frames, title, description);
  console.log(
    `[Cover] Selected frame ${selection.index}: "${selection.text1}" / "${selection.text2}" / "${selection.text3}"`,
  );

  const selectedFrame = frames[selection.index - 1];
  const texts = [selection.text1, selection.text2, selection.text3];

  const outDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });

  const landscapePath = path.join(outDir, `${job.id}-cover.jpg`);
  const portraitPath = path.join(outDir, `${job.id}-cover-portrait.jpg`);

  const [landscapeBuf, portraitBuf] = await Promise.all([
    composeCover(selectedFrame, texts, "landscape"),
    composeCover(selectedFrame, texts, "portrait"),
  ]);

  fs.writeFileSync(landscapePath, landscapeBuf);
  fs.writeFileSync(portraitPath, portraitBuf);

  console.log(`[Cover] Landscape: ${landscapePath}`);
  console.log(`[Cover] Portrait: ${portraitPath}`);

  return {
    coverLandscape: landscapePath,
    coverPortrait: portraitPath,
    selection,
  };
}
