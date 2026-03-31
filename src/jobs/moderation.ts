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

function hasChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function requiresChineseOutput(targetLanguage: string): boolean {
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

function targetLanguageInstruction(targetLanguage: string): string {
  if (requiresChineseOutput(targetLanguage)) {
    return "Simplified Chinese (简体中文, zh-CN). The output translation for every safe non-Chinese input MUST contain Chinese characters.";
  }
  return targetLanguage;
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
  const targetInstruction = targetLanguageInstruction(targetLanguage);
  return `You are a strict safety reviewer and translator for a video reposting pipeline.

Task:
In the same pass, review the input ${kind} for publication safety. If it is safe and not Chinese, translate it into ${targetInstruction}. If it is safe Chinese, return the original text unchanged.

Language rule:
- Treat text as Chinese only when it contains CJK Chinese characters matching /[\\u3400-\\u9fff]/.
- English, romanized Chinese, and other natural-language non-CJK text are non-Chinese and MUST be translated into ${targetInstruction}.
- Emoji-only, number-only, punctuation-only, symbol-only, URL-only, hashtag-only, model-name-only, or very short non-semantic reactions such as "😂", "123", "!!!", "#1", "H9", "👍👍" may be kept exactly unchanged because there is no meaningful language to translate.
- For every safe non-Chinese input, the "translation" field MUST be Chinese text. Returning the original English/non-Chinese text is invalid.
- For already-Chinese input, including Traditional Chinese, return the exact original text unchanged. Do not convert Traditional Chinese to Simplified Chinese.

Publication safety policy:
- Keep ordinary product, vehicle, technology, price, design, reliability, service, brand, market, ownership, or consumer-opinion comments, even when they mention China, Chinese cars, Chinese brands, Chinese products, or comparisons with Tesla, Europe, Japan, Korea, Canada, or the US.
- Keep ordinary positive or negative product opinions such as "Chinese SUVs are amazing", "they look nice but may not be reliable", "Chinese cars are cheaper", "China's SUV evolution is insane", or "I would not buy this brand", unless they also contain a separate high-risk issue below.
- Drop political, geopolitical, ideological, sovereignty, military, sanctions, war, election, protest, government, party, leader, ethnic/religious conflict, separatism, or historical atrocity content involving any country or region, including China, Taiwan, Hong Kong, Macau, Tibet, Xinjiang, Russia, the US, etc.
- Drop nationalist incitement, dehumanizing attacks, hate, or insults targeting a nationality/ethnicity/region/people group. Product or brand insults alone are not hate speech.
- Drop content about censorship, VPN/firewall, banned organizations, cults, protests, genocide, concentration camps, political prisoners, dictatorship/regime claims, or propaganda accusations.
- Drop illegal or platform-risk content: pornography, sexual solicitation, minors, gambling, drugs, fraud, fake documents, loan sharks, trafficking, doxxing, weapons, organized crime, violent crime, self-harm, hate, discrimination, scams, private data trading, or instructions for wrongdoing.
- Drop borderline political/legal/safety cases. Do not treat ordinary product praise or criticism as borderline just because it mentions China.
- Do not sanitize unsafe content. Do not summarize unsafe content. Do not translate unsafe content. Just drop it.
- For safe non-Chinese comments, use lively natural Chinese while preserving meaning.
- For safe non-Chinese subtitles, use concise natural Chinese while preserving meaning and timing readability.
- Subtitle items may be short sentence fragments. Translate only the fragment. Do not add notes, explanations, completions, labels, or text such as "original sentence incomplete".
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
  context?: string,
  extraInstructions?: string
): string {
  const targetInstruction = targetLanguageInstruction(targetLanguage);
  const preferences = extraInstructions?.trim()
    ? `\n\nUser translation preferences (follow these whenever they do not conflict with the safety policy):\n${extraInstructions.trim()}`
    : "";
  return `You are a strict safety reviewer and translator for a video reposting pipeline.

Task:
Review a JSON array of ${kind}s for publication safety. Translate only non-Chinese safe items into ${targetInstruction}. For safe Chinese items, return the exact original text unchanged.

Source context:
${context?.trim() || "No source context provided."}${preferences}

If the source context is political, geopolitical, military, ideological, or otherwise platform-sensitive, treat ambiguous comments as referring to that context and drop them.

Input format:
[{"id":"stable-id","text":"source text"}, ...]

Output format:
Return strict JSON only: {"items":[...]}.
The items array must have the exact same length and exact same ids, in the same order.
For each item:
{"id":"stable-id","action":"keep","translation":"Chinese translation for non-Chinese input, or unchanged original Chinese text"}
or
{"id":"stable-id","action":"drop","reason":"short reason"}

Language rule:
- Treat text as Chinese only when it contains CJK Chinese characters matching /[\\u3400-\\u9fff]/.
- English, romanized Chinese, and other natural-language non-CJK text are non-Chinese and MUST be translated into ${targetInstruction}.
- Emoji-only, number-only, punctuation-only, symbol-only, URL-only, hashtag-only, model-name-only, or very short non-semantic reactions such as "😂", "123", "!!!", "#1", "H9", "👍👍" may be kept exactly unchanged because there is no meaningful language to translate.
- For every safe non-Chinese input, the "translation" field MUST contain Chinese characters. Returning the original English/non-Chinese text is invalid.
- For already-Chinese input, including Traditional Chinese, return the exact original text unchanged. Do not convert Traditional Chinese to Simplified Chinese.

Hard policy:
- Keep ordinary product, vehicle, technology, price, design, reliability, service, brand, market, ownership, or consumer-opinion comments, even when they mention China, Chinese cars, Chinese brands, Chinese products, or comparisons with Tesla, Europe, Japan, Korea, Canada, or the US.
- Keep ordinary positive or negative product opinions such as "Chinese SUVs are amazing", "they look nice but may not be reliable", "Chinese cars are cheaper", "China's SUV evolution is insane", or "I would not buy this brand", unless they also contain a separate high-risk issue below.
- Drop political, geopolitical, ideological, sovereignty, military, sanctions, war, election, protest, government, party, leader, ethnic/religious conflict, separatism, or historical atrocity content involving any country or region, including China, Taiwan, Hong Kong, Macau, Tibet, Xinjiang, Russia, the US, etc.
- Drop nationalist incitement, dehumanizing attacks, hate, or insults targeting a nationality/ethnicity/region/people group. Product or brand insults alone are not hate speech.
- Drop content about censorship, VPN/firewall, banned organizations, cults, protests, genocide, concentration camps, political prisoners, dictatorship/regime claims, or propaganda accusations.
- Drop illegal or platform-risk content: pornography, sexual solicitation, minors, gambling, drugs, fraud, fake documents, loan sharks, trafficking, doxxing, weapons, organized crime, violent crime, self-harm, hate, discrimination, scams, private data trading, or instructions for wrongdoing.
- Drop borderline political/legal/safety cases. Do not treat ordinary product praise or criticism as borderline just because it mentions China.
- Do not sanitize unsafe content. Do not summarize unsafe content. Do not translate unsafe content. Just drop it.
- For safe non-Chinese comments, use lively natural Chinese while preserving meaning.
- For safe non-Chinese subtitles, use concise natural Chinese while preserving meaning and timing readability.
- Subtitle items may be short sentence fragments. Translate only the fragment. Do not add notes, explanations, completions, labels, or text such as "original sentence incomplete".
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

function parseSafetyReviewBatch(
  raw: string,
  inputs: SafetyReviewInput[],
  targetLanguage: string
): SafetyReviewOutput[] {
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
      if (
        requiresChineseOutput(targetLanguage) &&
        !hasChinese(source.text) &&
        !isNonSemanticText(source.text) &&
        !hasChinese(output.translation)
      ) {
        throw new BatchRetryableTranslationError(
          "missing-target-language",
          `Translation batch item stayed non-Chinese at ${index}: ${source.id}`
        );
      }
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

export const SENSITIVE_PLACEHOLDER = "[SENSITIVE]";

export interface SubtitleSafetyReviewOutput {
  id: string;
  action: "keep" | "sensitive";
  translation?: string;
  reason?: string;
}

export function subtitleContextAwarePrompt(
  targetLanguage: string,
  sourceContext: string,
  fullSubtitleText: string,
  userPrompt: string,
): string {
  return `你是一个严格的字幕安全审核和翻译专家。

## 视频信息

${sourceContext}

## 完整字幕上下文

以下是完整字幕内容，每行一个编号对应一个字幕时间段。通读全部内容理解完整上下文后再翻译。

${fullSubtitleText}

## 翻译指引

目标语言：${targetLanguage}

${userPrompt}

## 安全审核规则

字幕是视频内容本身，审核标准应明显宽松于评论。只过滤明确的违法和极端高风险内容，保留所有正常产品讨论。

### 必须保留的内容（不应标记为敏感）：
- 产品、技术、价格、设计、品牌、市场、消费者评价等正常讨论
- 提及政府、政策、法规、监管、补贴、关税、贸易战等，只要语境是讨论产业和商业影响
- 提及军事、战争，只要语境是比喻或历史背景（如"trade war"、"price war"）
- 涉及国家间的比较、竞争关系、市场格局讨论
- 关于经济体制的讨论（资本主义、社会主义、市场经济等）
- 个人的政治观点表达或社会评论，只要不是煽动性内容
- 新闻报道式的陈述（"The president announced..."、"The government said..."）

### 标记为敏感的内容（仅限以下明确的极端情况）：
- 直接煽动民族仇恨、种族歧视、非人化攻击
- 明确的色情、性暴力、未成年人相关内容
- 具体的违法犯罪指导（制毒、造假证、黑客攻击教程等）
- 自残、恐怖主义指导
- 具体个人的恶意人肉搜索、隐私泄露

### 判断原则：
- 宁可保留，不要误杀。字幕被误删会直接破坏观看体验。
- 如果一条字幕只是包含"政府"、"政治"、"军事"等词汇但语境正常，保留。
- 只有内容本身确实违法或极端有害时才标记为敏感。
- 标记为敏感时，r 字段必须填写具体原因（如"煽动仇恨"、"色情"、"犯罪指导"）。没有充分理由不得标记为敏感，不确定的内容一律保留翻译。
- 产品评测、技术参数、电池续航、价格对比、品牌评价、市场分析等正常商业讨论绝对不能标记为敏感。
- 敏感内容不翻译、不概括、不清洗，将 translation 字段设为 "${SENSITIVE_PLACEHOLDER}" 占位符。
- 输入字幕已经按正常语义段切分。逐条翻译当前字幕段，不要把某一条的内容提前、延后或合并到相邻条目。
- 如果原文已是目标语言，原样返回。
- 翻译文本只输出译文，不要包含原文、双语对照、标签、解释或额外行。
- 翻译文本开头不能有标点符号（如"。"、"，"、"、"、"；"、"！"等）。
- 每条 t 字段必须只包含对应输入条目的译文。严禁输出相邻条目的内容。

## 输入输出格式

输入为紧凑 JSON 数组：
[{"i":0,"t":"源文本"},{"i":1,"t":"源文本"},...]

输出严格 JSON 数组，不要 markdown，不要外层包装：
[{"i":0,"a":"k","t":"翻译文本"},{"i":1,"a":"k","t":"翻译文本"},...]

字段：i=编号(与输入一致), a=k(保留翻译)/s(敏感), t=翻译文本或"${SENSITIVE_PLACEHOLDER}", r=仅s时填写简短原因

## 最重要规则：条数必须一致

输入有多少条，输出必须有多少条。少一条或多一条都是严重错误。
生成完输出后，数一下数组长度，确认和输入一致。如果不一致，你必须修正。

## 示例

示例1（正常语义段逐条翻译）：
输入共3条：[{"i":0,"t":"And this car is coming to the West."},{"i":1,"t":"Apparently it could even be coming to the United States because Geely plans on coming to the United States."},{"i":2,"t":"They own Volvo and Polestar, which are in the US right now."}]
输出必须3条：[{"i":0,"a":"k","t":"这款车即将进入西方市场。"},{"i":1,"a":"k","t":"它甚至可能进入美国，因为吉利计划进军美国市场。"},{"i":2,"a":"k","t":"他们拥有沃尔沃和极星，这两个品牌目前已经在美国销售。"}]

示例2（正常完整句）：
输入共2条：[{"i":0,"t":"This car costs around $40,000 in China."},{"i":1,"t":"That is incredibly cheap for what you get."}]
输出必须2条：[{"i":0,"a":"k","t":"这款车在中国售价约4万美元。"},{"i":1,"a":"k","t":"以这个配置来说非常划算。"}]

示例3（含敏感项）：
输入共3条：[{"i":0,"t":"The interior is beautiful."},{"i":1,"t":"[政治煽动内容]"},{"i":2,"t":"Great build quality."}]
输出必须3条：[{"i":0,"a":"k","t":"内饰很漂亮。"},{"i":1,"a":"s","t":"${SENSITIVE_PLACEHOLDER}","r":"政治煽动"},{"i":2,"a":"k","t":"做工很棒。"}]

## 错误示例（严格禁止）

输入共3条：[{"i":0,"t":"The car is similar to the BYD Dolphin."},{"i":1,"t":"But it is $4,000 cheaper."},{"i":2,"t":"Here are the specs and details."}]
❌ 错误输出（把第2、3条内容提前合并到第1条）：
[{"i":0,"a":"k","t":"这款车和比亚迪海豚很像，但便宜4000美元，下面是参数。"},{"i":1,"a":"k","t":"但它便宜4000美元。"},{"i":2,"a":"k","t":"下面是参数和细节。"}]
✓ 正确输出（每条只翻译本条内容）：
[{"i":0,"a":"k","t":"这款车和比亚迪海豚很相似。"},{"i":1,"a":"k","t":"但它要便宜4000美元。"},{"i":2,"a":"k","t":"下面是它的参数和详细信息。"}]`;


}

function parseSubtitleSafetyBatch(
  raw: string,
  inputs: SafetyReviewInput[],
): SubtitleSafetyReviewOutput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(raw));
  } catch {
    const reason = isModelRefusal(raw) ? "model-refusal" : "invalid-json-or-refusal";
    throw new BatchRetryableTranslationError(reason, `Subtitle batch returned ${reason}`);
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
    throw new BatchRetryableTranslationError("invalid-json-shape", "Subtitle batch response is not an array");
  }
  if (parsed.length !== inputs.length) {
    throw new BatchRetryableTranslationError(
      "length-mismatch",
      `Subtitle batch length mismatch: expected ${inputs.length}, got ${parsed.length}`,
    );
  }

  return parsed.map((item, index) => {
    const source = inputs[index];
    const c = item as Record<string, unknown>;

    const outputI = c.i !== undefined ? Number(c.i) : undefined;
    if (outputI !== undefined && outputI !== index) {
      throw new BatchRetryableTranslationError(
        "id-mismatch",
        `Subtitle batch i mismatch at ${index}: expected ${index}, got ${outputI}`,
      );
    }

    const a = String(c.a ?? c.action ?? "").toLowerCase();
    if (a === "s" || a === "sensitive" || a === "drop") {
      return {
        id: source.id,
        action: "sensitive" as const,
        translation: SENSITIVE_PLACEHOLDER,
        reason: String(c.r ?? c.reason ?? "model"),
      };
    }

    const translation = c.t ?? c.translation;
    if (typeof translation === "string" && translation.trim()) {
      return {
        id: source.id,
        action: "keep" as const,
        translation: translation.trim(),
      };
    }

    return {
      id: source.id,
      action: "sensitive" as const,
      translation: SENSITIVE_PLACEHOLDER,
      reason: "invalid-item",
    };
  });
}

function markBatchSensitive(inputs: SafetyReviewInput[], reason: string): SubtitleSafetyReviewOutput[] {
  return inputs.map((source) => ({
    id: source.id,
    action: "sensitive" as const,
    translation: SENSITIVE_PLACEHOLDER,
    reason,
  }));
}

export async function translateSubtitleBatchWithContext(
  inputs: SafetyReviewInput[],
  targetLanguage: string,
  systemPrompt: string,
): Promise<SubtitleSafetyReviewOutput[]> {
  if (inputs.length === 0) return [];

  const maxBatchAttempts = Math.max(1, Number(process.env.TRANSLATE_BATCH_RETRY_LIMIT || 3));
  let lastRetryableError: BatchRetryableTranslationError | undefined;

  for (let attempt = 1; attempt <= maxBatchAttempts; attempt += 1) {
    try {
      const retryInstruction =
        attempt > 1
          ? `\n\n重试 ${attempt}/${maxBatchAttempts}：上次响应验证失败（输出条数与输入不一致）。输入共${inputs.length}条，输出也必须正好${inputs.length}条。数一下你的输出数组长度。`
          : `\n\n本次输入共${inputs.length}条，输出数组必须正好${inputs.length}条。`;

      const compactInputs = inputs.map((input, idx) => ({ i: idx, t: input.text }));
      const raw = await translateText({
        text: JSON.stringify(compactInputs) + retryInstruction,
        targetLanguage,
        systemPrompt,
      });

      return parseSubtitleSafetyBatch(raw, inputs);
    } catch (error) {
      if (!(error instanceof BatchRetryableTranslationError)) throw error;
      lastRetryableError = error;
      if (attempt < maxBatchAttempts) continue;
    }
  }

  const reason = lastRetryableError?.reason || "batch-validation-failed";
  if (inputs.length === 1) return markBatchSensitive(inputs, reason);

  const [left, right] = splitBatch(inputs);
  const leftResults = await translateSubtitleBatchWithContext(left, targetLanguage, systemPrompt);
  const rightResults = await translateSubtitleBatchWithContext(right, targetLanguage, systemPrompt);
  return [...leftResults, ...rightResults];
}

export async function translateBatchWithSafetyReview(
  inputs: SafetyReviewInput[],
  targetLanguage: string,
  kind: "comment" | "subtitle",
  context?: string,
  extraInstructions?: string
): Promise<SafetyReviewOutput[]> {
  if (inputs.length === 0) return [];

  const maxBatchAttempts = Math.max(1, Number(process.env.TRANSLATE_BATCH_RETRY_LIMIT || 3));
  let lastRetryableError: BatchRetryableTranslationError | undefined;

  for (let attempt = 1; attempt <= maxBatchAttempts; attempt += 1) {
    try {
      const retryInstruction =
        attempt > 1
          ? `\n\nRetry attempt ${attempt}/${maxBatchAttempts}: the previous response failed validation. Re-check every kept non-Chinese item and make sure its translation is actual ${targetLanguageInstruction(
              targetLanguage
            )}. Do not return the source English/non-Chinese text as translation.`
          : "";
      const raw = await translateText({
        text: JSON.stringify(inputs) + retryInstruction,
        targetLanguage,
        systemPrompt: batchSafetyReviewTranslationPrompt(kind, targetLanguage, context, extraInstructions),
      });

      return parseSafetyReviewBatch(raw, inputs, targetLanguage);
    } catch (error) {
      if (!(error instanceof BatchRetryableTranslationError)) throw error;
      lastRetryableError = error;
      if (attempt < maxBatchAttempts) continue;
    }
  }

  const reason = lastRetryableError?.reason || "batch-validation-failed";
  if (inputs.length === 1) return dropBatch(inputs, reason);

  const [left, right] = splitBatch(inputs);
  const leftResults = await translateBatchWithSafetyReview(left, targetLanguage, kind, context, extraInstructions);
  const rightResults = await translateBatchWithSafetyReview(right, targetLanguage, kind, context, extraInstructions);
  return [...leftResults, ...rightResults];
}
