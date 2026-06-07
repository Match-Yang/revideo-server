import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import sharp from "sharp";
import { getTranslateConfig } from "../translate/openai-compatible";
import { buildCoverSvg, coverTemplateFields, isNoTemplate } from "../../dashboard/src/lib/cover-templates";
import type { RevideoJob } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverSelection {
  index: number; // 1-5
  text1: string; // ≤3 chars, emotion word
  text2: string; // 3-7 chars
  text3: string; // ≤10 chars
  text4?: string; // optional extra label for 4-line templates
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

// Extract a single frame by its zero-based frame index (0 = first frame).
function extractFixedFrame(
  videoPath: string,
  outputDir: string,
  index: number,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, "frame_fixed.jpg");
  const idx = Math.max(0, Math.floor(index || 0));
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -vf "select=eq(n\\,${idx})" -frames:v 1 -fps_mode passthrough -q:v 2 "${outPath}"`,
      { stdio: "pipe" },
    );
  } catch (err) {
    console.warn(
      `[Cover] Failed to extract fixed frame ${idx}, falling back to first frame: ${err}`,
    );
  }
  if (!fs.existsSync(outPath)) {
    execSync(`ffmpeg -y -i "${videoPath}" -frames:v 1 -q:v 2 "${outPath}"`, {
      stdio: "pipe",
    });
  }
  if (!fs.existsSync(outPath)) {
    throw new Error("Failed to extract fixed frame for cover generation");
  }
  return outPath;
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
  "2. 根据视频标题和描述的实际内容，生成最多四句封面文案，要求：",
  "   - 文案必须紧扣视频的实际主题，让人一看就知道视频讲什么",
  "   - 整体要有吸引力、悬念感或信息量，激发点击欲望",
  "   - 第一句：不超过4个字，是点睛的语气/情绪词（如：海外评论、海外网友等等）",
  "   - 第二句：3到8个字，概括视频核心信息的前半段",
  "   - 第三句：不超过10个字，补全核心信息的后半段",
  "   - 第四句：可选，不超过6个字，只在模板需要更多标签时填写；否则返回空字符串",
  "   - 第二句+第三句连读要通顺、有完整含义",
  "",
  "示例（标题：2026年加拿大能购买的10款最豪华SUV）：",
  '{"index":3,"text1":"2026","text2":"加拿大能买到的","text3":"10款最豪华中国SUV","text4":""}',
  "示例（标题：美国能买到的首批中国车！老外直呼：这配置比本土车还香？）：",
  '{"index":2,"text1":"快看","text2":"美国能买的中国车","text3":"老外直呼这配置真香！","text4":""}',
  "",
  "请严格按以上JSON格式返回，不要输出任何其他内容。index 是选中截图的编号（1到5）。",
].join("\n");

// Text-only variant (no images): used when the cover frame is fixed but copy is AI-generated.
const COVER_TEXT_PROMPT = [
  "你是一个专业的短视频封面文案专家，擅长以视频标题为主、视频描述为辅，提炼出让人忍不住点击的封面文案。",
  "我会给你视频的标题和描述。请根据它们的实际内容，生成最多四句封面文案，要求：",
  "   - 文案必须紧扣视频的实际主题，让人一看就知道视频讲什么",
  "   - 整体要有吸引力、悬念感或信息量，激发点击欲望",
  "   - 第一句：不超过4个字，是点睛的语气/情绪词（如：海外评论、海外网友等等）",
  "   - 第二句：3到8个字，概括视频核心信息的前半段",
  "   - 第三句：不超过10个字，补全核心信息的后半段",
  "   - 第四句：可选，不超过6个字，只在模板需要更多标签时填写；否则返回空字符串",
  "   - 第二句+第三句连读要通顺、有完整含义",
  "",
  "请严格按以下JSON格式返回，不要输出任何其他内容（index 固定填 1）：",
  '{"index":1,"text1":"快看","text2":"美国能买的中国车","text3":"老外直呼这配置真香！","text4":""}',
].join("\n");

function encodeImageToBase64(imagePath: string): string {
  return fs.readFileSync(imagePath).toString("base64");
}

// Shared chat-completion call against the OpenAI-compatible endpoint.
async function callCoverCompletion(messages: unknown[]): Promise<string> {
  const config = getTranslateConfig();
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing API key env: ${config.apiKeyEnv}`);
  }
  const timeoutMs = Math.max(
    1000,
    Number(process.env.TRANSLATE_TIMEOUT_MS || 120000),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Cover request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    throw new Error(`Cover request failed: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Cover response did not include content");
  }
  return text;
}

function parseCoverSelection(text: string, frameCount: number): CoverSelection {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Cover response is not valid JSON: ${text}`);
  }
  const selection = JSON.parse(jsonMatch[0]) as CoverSelection;
  if (
    typeof selection.text1 !== "string" ||
    typeof selection.text2 !== "string" ||
    typeof selection.text3 !== "string"
  ) {
    throw new Error(`Invalid cover selection: ${JSON.stringify(selection)}`);
  }
  if (
    typeof selection.index !== "number" ||
    selection.index < 1 ||
    selection.index > frameCount
  ) {
    selection.index = 1;
  }
  return selection;
}

// Vision call: selects the best frame among `frames` and generates copy.
// Throws if the model lacks multimodal capability or the request fails.
async function selectCoverWithVision(
  frames: string[],
  title: string,
  description: string,
  aiPrompt: string,
): Promise<CoverSelection> {
  const userText = `视频标题：${title}\n视频描述：${description}`;
  const content: unknown[] = [
    { type: "text", text: userText },
    ...frames.map((f) => ({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${encodeImageToBase64(f)}` },
    })),
  ];
  const system = aiPrompt
    ? `${COVER_VISION_PROMPT}\n\n补充文案要求：${aiPrompt}`
    : COVER_VISION_PROMPT;
  const text = await callCoverCompletion([
    { role: "system", content: system },
    { role: "user", content },
  ]);
  return parseCoverSelection(text, frames.length);
}

// Text-only call: generates copy from title/description (no frame selection).
async function generateCoverTextOnly(
  title: string,
  description: string,
  aiPrompt: string,
): Promise<CoverSelection> {
  const userText = `视频标题：${title}\n视频描述：${description}`;
  const system = aiPrompt
    ? `${COVER_TEXT_PROMPT}\n\n补充文案要求：${aiPrompt}`
    : COVER_TEXT_PROMPT;
  const text = await callCoverCompletion([
    { role: "system", content: system },
    { role: "user", content: userText },
  ]);
  return parseCoverSelection(text, 1);
}

// ---------------------------------------------------------------------------
// 3. Compose cover image with template overlay (shared SVG engine)
// ---------------------------------------------------------------------------

const LANDSCAPE_W = 1440;
const LANDSCAPE_H = 1080;
const PORTRAIT_W = 1080;
const PORTRAIT_H = 1920;

// Composites the shared template SVG (darkening / blocks / chips / text — all
// produced by dashboard/src/lib/cover-templates.ts) over the resized frame so
// the rendered cover is identical to the dashboard preview.
async function composeCover(
  framePath: string,
  texts: string[],
  orientation: "landscape" | "portrait",
  template: string,
): Promise<Buffer> {
  const w = orientation === "landscape" ? LANDSCAPE_W : PORTRAIT_W;
  const h = orientation === "landscape" ? LANDSCAPE_H : PORTRAIT_H;

  const baseImage = sharp(framePath).resize(w, h, {
    fit: "cover",
    position: "center",
  });

  // No text (or "无模板") = plain screenshot, no overlay.
  if (texts.length === 0 || isNoTemplate(template)) {
    return baseImage.jpeg({ quality: 92 }).toBuffer();
  }

  const svg = buildCoverSvg(template, texts, { orientation, width: w, height: h });
  return baseImage
    .composite([{ input: Buffer.from(svg), blend: "over" }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// 4. Orchestrate
// ---------------------------------------------------------------------------

export interface CoverOptions {
  template: string;
  imageMode: "fixed" | "ai";
  fixedFrameIndex: number;
  copyMode: "none" | "fixed" | "ai";
  fixedCopy: Record<string, string | undefined>;
  aiPrompt: string;
  outputDir: string;
}

const AI_FRAME_COUNT = 5;

export async function generateCover(
  job: RevideoJob,
  options: CoverOptions,
): Promise<CoverResult> {
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

  // "无模板" = plain screenshot, never overlay text.
  const noTemplate = isNoTemplate(options.template);
  const copyMode = noTemplate ? "none" : options.copyMode;
  const wantAiText = copyMode === "ai";
  const framesDir = path.join(job.artifacts.derivedDir, "cover-frames");

  let selectedFrame: string;
  let reportedIndex = 1;
  let aiTexts: string[] | null = null;

  if (options.imageMode === "fixed") {
    selectedFrame = extractFixedFrame(
      mediaPath,
      framesDir,
      options.fixedFrameIndex,
    );
    console.log(`[Cover] Using fixed frame #${options.fixedFrameIndex}`);
  } else {
    const frames = extractVideoFrames(mediaPath, framesDir, AI_FRAME_COUNT);
    if (frames.length < 1) {
      throw new Error("Failed to extract frames for cover generation");
    }
    try {
      const selection = await selectCoverWithVision(
        frames,
        title,
        description,
        options.aiPrompt,
      );
      reportedIndex = selection.index;
      selectedFrame = frames[Math.min(selection.index - 1, frames.length - 1)];
      if (wantAiText) {
        aiTexts = [selection.text1, selection.text2, selection.text3, selection.text4 || ""];
      }
      console.log(`[Cover] Vision selected frame ${selection.index}`);
    } catch (err) {
      // Model lacks multimodal capability (or request failed): random frame.
      reportedIndex = Math.floor(Math.random() * frames.length) + 1;
      selectedFrame = frames[reportedIndex - 1];
      console.warn(
        `[Cover] Vision unavailable, falling back to random frame ${reportedIndex}: ${err}`,
      );
    }
  }

  // Fixed frame + AI copy: vision wasn't used to produce text, generate it now.
  if (wantAiText && !aiTexts) {
    try {
      const sel = await generateCoverTextOnly(title, description, options.aiPrompt);
      aiTexts = [sel.text1, sel.text2, sel.text3, sel.text4 || ""];
    } catch (err) {
      console.warn(`[Cover] AI copy generation failed: ${err}`);
      aiTexts = null;
    }
  }

  // Resolve overlay text by copy mode.
  let texts: string[] = [];
  if (copyMode === "fixed") {
    texts = coverTemplateFields(options.template)
      .map((field) => options.fixedCopy[field.key])
      .map((s) => (s || "").trim())
      .filter(Boolean);
  } else if (copyMode === "ai") {
    texts = (aiTexts || [])
      .map((s) => (s || "").trim())
      .filter(Boolean);
  }

  console.log(
    `[Cover] template=${options.template} copyMode=${copyMode} lines=${texts.length}`,
  );

  const outDir = options.outputDir;
  fs.mkdirSync(outDir, { recursive: true });

  const landscapePath = path.join(outDir, `${job.id}-cover.jpg`);
  const portraitPath = path.join(outDir, `${job.id}-cover-portrait.jpg`);

  const [landscapeBuf, portraitBuf] = await Promise.all([
    composeCover(selectedFrame, texts, "landscape", options.template),
    composeCover(selectedFrame, texts, "portrait", options.template),
  ]);

  fs.writeFileSync(landscapePath, landscapeBuf);
  fs.writeFileSync(portraitPath, portraitBuf);

  console.log(`[Cover] Landscape: ${landscapePath}`);
  console.log(`[Cover] Portrait: ${portraitPath}`);

  return {
    coverLandscape: landscapePath,
    coverPortrait: portraitPath,
    selection: {
      index: reportedIndex,
      text1: texts[0] || "",
      text2: texts[1] || "",
      text3: texts[2] || "",
      text4: texts[3] || "",
    },
  };
}
