import { translateText } from "../translate/openai-compatible";

export interface SafetyReviewedTranslation {
  action: "keep" | "drop";
  translation?: string;
  reason?: string;
}

export interface SafetyReviewInput {
  id: string;
  text: string;
}

export interface SafetyReviewOutput extends SafetyReviewedTranslation {
  id: string;
}

class BatchRetryableTranslationError extends Error {
  reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "BatchRetryableTranslationError";
    this.reason = reason;
  }
}

const CN_KEYWORDS = [
  "独裁",
  "专政",
  "共产",
  "中共",
  "天安门",
  "六四",
  "文革",
  "专制",
  "暴政",
  "侵略",
  "殖民",
  "种族灭绝",
  "台湾独立",
  "台独",
  "港独",
  "藏独",
  "疆独",
  "翻墙",
  "活摘",
  "集中营",
  "法轮功",
  "邪教",
  "维尼",
  "小熊维尼",
  "反华",
  "辱华",
  "南京大屠杀",
  "文化大革命",
  "分裂国家",
  "统独",
  "两岸关系",
  "政治犯",
  "民主运动",
  "军演",
  "武力统一",
  "宗教自由",
  "迫害",
  "信仰",
  "政体",
  "政权",
  "色情",
  "淫秽",
  "涉黄",
  "卖淫",
  "嫖娼",
  "招嫖",
  "约炮",
  "一夜情",
  "援交",
  "包养",
  "强奸",
  "性侵",
  "猥亵",
  "裸聊",
  "裸照",
  "偷拍",
  "成人网站",
  "成人视频",
  "外围",
  "外圍",
  "外维",
  "外維",
  "大圈",
  "名模",
  "女優",
  "女优",
  "经纪人",
  "經紀人",
  "高端商务",
  "高端商務",
  "上门",
  "上門",
  "入口在主页",
  "入口在主頁",
  "全球可用",
  "稳定加速",
  "穩定加速",
  "8964",
  "修昔底德陷阱",
  "毒品",
  "吸毒",
  "贩毒",
  "冰毒",
  "海洛因",
  "赌博",
  "赌场",
  "黑社会",
  "黑帮",
  "催收",
  "裸贷",
  "校园贷",
  "假证",
  "假文凭",
  "假发票",
  "假身份证",
  "代孕",
  "拐卖",
  "人口贩卖",
  "传销",
  "杀猪盘",
  "洗钱",
  "非法集资",
  "网贷",
  "高利贷",
  "套路贷",
  "诈骗",
  "庞氏骗局",
  "雇凶",
  "凶杀",
  "杀人",
  "砍人",
  "捅人",
  "灭口",
];

const EN_WORD_BOUNDARY = [
  "ccp",
  "porn",
  "nude",
  "nsfw",
  "xxx",
  "bdsm",
  "dick",
  "cock",
  "pussy",
  "pedo",
  "scam",
  "gang",
  "meth",
];

const EN_SUBSTRING = [
  "dictator",
  "regime",
  "genocide",
  "concentration camp",
  "communist",
  "tiananmen",
  "cultural revolution",
  "xi jinping",
  "authoritarian",
  "totalitarian",
  "propaganda",
  "political prisoner",
  "mainland china",
  "taiwan independence",
  "free taiwan",
  "hong kong independence",
  "tibet independence",
  "xinjiang independence",
  "one china",
  "two chinas",
  "cross strait",
  "south china sea",
  "falun gong",
  "erotic",
  "pervert",
  "pedophil",
  "incest",
  "onlyfans",
  "prostitut",
  "hooker",
  "whore",
  "slut",
  "orgasm",
  "rape",
  "gangbang",
  "threesome",
  "bondage",
  "fetish",
  "blowjob",
  "handjob",
  "strip club",
  "adult content",
  "adult video",
  "sugar daddy",
  "sugar baby",
  "sex tape",
  "child traffick",
  "human traffick",
  "sex traffick",
  "underage",
  "jailbait",
  "pyramid scheme",
  "ponzi",
  "crypto scam",
  "loan shark",
  "predatory lending",
  "fake id",
  "fake diploma",
  "fake passport",
  "counterfeit",
  "hire killer",
  "hitman",
  "assassination",
  "murder for hire",
  "mafia",
  "cartel",
  "cocaine",
  "heroin",
  "fentanyl",
  "drug dealer",
  "casino",
  "fraud",
];

const EN_EXCLUDE_PATTERNS = [
  /\bsomething\b/,
  /\bsucked?\s+in\b/,
  /\bcooking\s+\w+\s+up\b/,
  /\bbetting\s+that\b/,
  /\bgang\s+of\b/,
  /\brecycling\s+cartel\b/,
  /around\s+xxx\b/,
  /\bxxx\s+(in|for|to|or|per)\b/,
  /\bemissions?\s+cheat\b/,
];

export function findLocalSensitiveReason(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const keyword of CN_KEYWORDS) {
    if (text.includes(keyword)) return `keyword:${keyword}`;
  }

  if (EN_EXCLUDE_PATTERNS.some((pattern) => pattern.test(lower))) {
    return undefined;
  }

  for (const keyword of EN_WORD_BOUNDARY) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(text)) return `keyword:${keyword}`;
  }

  for (const keyword of EN_SUBSTRING) {
    if (lower.includes(keyword)) return `keyword:${keyword}`;
  }

  return undefined;
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonPayload(raw: string): string {
  const stripped = stripJsonFence(raw);
  if (stripped.startsWith("[") || stripped.startsWith("{")) return stripped;

  const arrayStart = stripped.indexOf("[");
  const arrayEnd = stripped.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return stripped.slice(arrayStart, arrayEnd + 1);
  }

  const objectStart = stripped.indexOf("{");
  const objectEnd = stripped.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return stripped.slice(objectStart, objectEnd + 1);
  }

  return stripped;
}

function isModelRefusal(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  return (
    text.includes("无法回答") ||
    text.includes("不能回答") ||
    text.includes("无法协助") ||
    text.includes("没有找到相关的结果") ||
    text.includes("抱歉") ||
    text.includes("cannot answer") ||
    text.includes("can't answer") ||
    text.includes("cannot assist") ||
    text.includes("can't assist") ||
    text.includes("not able to help")
  );
}

function splitBatch<T>(items: T[]): [T[], T[]] {
  const middle = Math.ceil(items.length / 2);
  return [items.slice(0, middle), items.slice(middle)];
}

function dropBatch(inputs: SafetyReviewInput[], reason: string): SafetyReviewOutput[] {
  return inputs.map((source) => ({
    id: source.id,
    action: "drop",
    reason,
  }));
}

function parseSafetyReviewedTranslation(raw: string): SafetyReviewedTranslation {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as Partial<SafetyReviewedTranslation>;
    if (parsed.action === "drop") {
      return { action: "drop", reason: parsed.reason || "model" };
    }
    if (parsed.action === "keep" && typeof parsed.translation === "string" && parsed.translation.trim()) {
      return { action: "keep", translation: parsed.translation.trim() };
    }
    return { action: "drop", reason: "invalid-model-json" };
  } catch {
    return { action: "drop", reason: "invalid-model-json" };
  }
}

export function safetyReviewTranslationPrompt(kind: "comment" | "subtitle", targetLanguage: string): string {
  return `You are a strict safety reviewer and translator for a video reposting pipeline.

Task:
In the same pass, review the input ${kind} for publication safety. If it is safe and not Chinese, translate it into ${targetLanguage}. If it is safe Chinese, return the original text unchanged.

Publication safety policy, intentionally over-strict:
- Drop any political statement, slogan, meme, joke, sarcasm, criticism, accusation, praise, debate, or historical reference involving China, Taiwan, Hong Kong, Macau, Tibet, Xinjiang, governments, parties, leaders, elections, protests, sanctions, war, military, ideology, religion, or separatism.
- Drop any mention that could become sensitive after translation, including pro/anti-China arguments, China-related geopolitics, sovereignty disputes, regime or party commentary, revolution, dictatorship, propaganda, protests, genocide, concentration camps, censorship, VPN/firewall, cults, or banned organizations.
- Drop illegal or platform-risk content: pornography, sexual solicitation, minors, gambling, drugs, fraud, fake documents, loan sharks, trafficking, doxxing, weapons, organized crime, violent crime, self-harm, hate, discrimination, scams, private data trading, or instructions for wrongdoing.
- Drop borderline cases. False positives are acceptable; false negatives are not.
- Do not sanitize unsafe content. Do not summarize unsafe content. Do not translate unsafe content. Just drop it.
- For safe non-Chinese comments, use lively natural Chinese while preserving meaning.
- For safe non-Chinese subtitles, use concise natural Chinese while preserving meaning and timing readability.
- If source text is already Chinese, including Traditional Chinese, do not convert, rewrite, polish, or translate it. Return the exact original text unchanged.
- For translated non-Chinese text, output only the Chinese translation. Never include the original source text, bilingual pairs, labels, explanations, or extra lines.

Output strict JSON only:
{"action":"keep","translation":"..."}
or
{"action":"drop","reason":"short reason"}`;
}

export function batchSafetyReviewTranslationPrompt(
  kind: "comment" | "subtitle",
  targetLanguage: string,
  context?: string
): string {
  return `You are a strict safety reviewer and translator for a video reposting pipeline.

Task:
Review a JSON array of ${kind}s for publication safety. Translate only non-Chinese safe items into ${targetLanguage}. For safe Chinese items, return the exact original text unchanged.

Source context:
${context?.trim() || "No source context provided."}

If the source context is political, geopolitical, military, ideological, or otherwise platform-sensitive, treat ambiguous comments as referring to that context and drop them.

Input format:
[{"id":"stable-id","text":"source text"}, ...]

Output format:
Return strict JSON only: {"items":[...]}.
The items array must have the exact same length and exact same ids, in the same order.
For each item:
{"id":"stable-id","action":"keep","translation":"Chinese translation or unchanged original Chinese text"}
or
{"id":"stable-id","action":"drop","reason":"short reason"}

Hard policy, intentionally over-strict:
- Drop any political statement, slogan, meme, joke, sarcasm, criticism, accusation, praise, debate, or historical reference involving China, Taiwan, Hong Kong, Macau, Tibet, Xinjiang, governments, parties, leaders, elections, protests, sanctions, war, military, ideology, religion, or separatism.
- Drop any mention that could become sensitive after translation, including pro/anti-China arguments, China-related geopolitics, sovereignty disputes, regime or party commentary, revolution, dictatorship, propaganda, protests, genocide, concentration camps, censorship, VPN/firewall, cults, or banned organizations.
- Drop illegal or platform-risk content: pornography, sexual solicitation, minors, gambling, drugs, fraud, fake documents, loan sharks, trafficking, doxxing, weapons, organized crime, violent crime, self-harm, hate, discrimination, scams, private data trading, or instructions for wrongdoing.
- Drop borderline cases. False positives are acceptable; false negatives are not.
- Do not sanitize unsafe content. Do not summarize unsafe content. Do not translate unsafe content. Just drop it.
- For safe non-Chinese comments, use lively natural Chinese while preserving meaning.
- For safe non-Chinese subtitles, use concise natural Chinese while preserving meaning and timing readability.
- If source text is already Chinese, including Traditional Chinese, do not convert, rewrite, polish, or translate it. Return the exact original text unchanged.
- For translated non-Chinese text, output only the Chinese translation. Never include the original source text, bilingual pairs, labels, explanations, or extra lines.

Critical integrity rules:
- Never omit an item.
- Never add an item.
- Never change ids.
- Never reorder items.
- Treat each item independently, but keep the batch structure exact.
- Output JSON only, no markdown, no explanation.`;
}

function parseSafetyReviewBatch(raw: string, inputs: SafetyReviewInput[]): SafetyReviewOutput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(raw));
  } catch {
    const reason = isModelRefusal(raw) ? "model-refusal" : "invalid-json-or-refusal";
    throw new BatchRetryableTranslationError(reason, `Translation batch returned ${reason}`);
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as { items?: unknown }).items)
  ) {
    parsed = (parsed as { items: unknown[] }).items;
  }

  if (!Array.isArray(parsed)) {
    throw new BatchRetryableTranslationError("invalid-json-shape", "Translation batch response is not an array");
  }
  if (parsed.length !== inputs.length) {
    throw new BatchRetryableTranslationError(
      "length-mismatch",
      `Translation batch length mismatch: expected ${inputs.length}, got ${parsed.length}`
    );
  }

  return parsed.map((item, index) => {
    const source = inputs[index];
    const output = item as Partial<SafetyReviewOutput>;
    if (output.id !== source.id) {
      throw new BatchRetryableTranslationError(
        "id-mismatch",
        `Translation batch id mismatch at ${index}: expected ${source.id}, got ${String(output.id)}`
      );
    }
    if (output.action === "drop") {
      return {
        id: source.id,
        action: "drop",
        reason: output.reason || "model",
      };
    }
    if (output.action === "keep" && typeof output.translation === "string" && output.translation.trim()) {
      const translatedReason = findLocalSensitiveReason(output.translation);
      if (translatedReason) {
        return {
          id: source.id,
          action: "drop",
          reason: `translated-${translatedReason}`,
        };
      }
      return {
        id: source.id,
        action: "keep",
        translation: output.translation.trim(),
      };
    }
    return {
      id: source.id,
      action: "drop",
      reason: "invalid-item",
    };
  });
}

export async function translateWithSafetyReview(
  text: string,
  targetLanguage: string,
  kind: "comment" | "subtitle"
): Promise<SafetyReviewedTranslation> {
  const raw = await translateText({
    text,
    targetLanguage,
    systemPrompt: safetyReviewTranslationPrompt(kind, targetLanguage),
  });
  const result = parseSafetyReviewedTranslation(raw);
  if (result.action === "drop") return result;

  const translatedReason = findLocalSensitiveReason(result.translation || "");
  if (translatedReason) return { action: "drop", reason: `translated-${translatedReason}` };

  return result;
}

export const moderateAndTranslateText = translateWithSafetyReview;

export async function translateBatchWithSafetyReview(
  inputs: SafetyReviewInput[],
  targetLanguage: string,
  kind: "comment" | "subtitle",
  context?: string
): Promise<SafetyReviewOutput[]> {
  if (inputs.length === 0) return [];

  try {
    const raw = await translateText({
      text: JSON.stringify(inputs),
      targetLanguage,
      systemPrompt: batchSafetyReviewTranslationPrompt(kind, targetLanguage, context),
    });

    return parseSafetyReviewBatch(raw, inputs);
  } catch (error) {
    if (!(error instanceof BatchRetryableTranslationError)) throw error;
    if (inputs.length === 1) return dropBatch(inputs, error.reason);

    const [left, right] = splitBatch(inputs);
    const leftResults = await translateBatchWithSafetyReview(left, targetLanguage, kind, context);
    const rightResults = await translateBatchWithSafetyReview(right, targetLanguage, kind, context);
    return [...leftResults, ...rightResults];
  }
}
