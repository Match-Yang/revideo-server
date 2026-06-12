// Shared cover-template engine (pure, dependency-free).
// This is the single source of truth for both dashboard previews and backend
// cover rendering. Templates define concrete text lines: count, font scale,
// position, rotation, fill, stroke and shadow.

export interface CoverField {
  key: string;
  label: string;
  placeholder: string;
}

export interface CoverLineStyle {
  key: string;
  label: string;
  placeholder: string;
  x: number; // fraction of canvas width
  y: number; // fraction of canvas height
  size: number; // fraction of canvas height
  align?: "left" | "center" | "right";
  rotate?: number;
  color: string;
  stroke?: string;
  strokeWidth?: number; // fraction of font size
  shadow?: string;
  font?: "sans" | "round" | "hand";
  weight?: number;
  letterSpacing?: number; // em
  italic?: boolean;
}

export interface TemplateSpec {
  id: string;
  name: string;
  ai: string;
  sampleBg: string;
  sampleText: string[];
  lines: CoverLineStyle[];
  noText?: boolean;
}

const SANS_FONT =
  "Heiti SC, PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif";
const ROUND_FONT =
  "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif";
const HAND_FONT =
  "Comic Sans MS, Kaiti SC, STKaiti, Xingkai SC, cursive";

const LEAD = "封面文案以视频标题和介绍为核心，紧扣视频实际主题。";

export const DEFAULT_COVER_TEMPLATE = "粗黑橙字";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fontFamily(font?: CoverLineStyle["font"]): string {
  if (font === "hand") return HAND_FONT;
  if (font === "round") return ROUND_FONT;
  return SANS_FONT;
}

function lineToField(line: CoverLineStyle): CoverField {
  return {
    key: line.key,
    label: line.label,
    placeholder: line.placeholder,
  };
}

function textEl(text: string, line: CoverLineStyle, w: number, h: number): string {
  const x = line.x * w;
  const y = line.y * h;
  const size = line.size * h;
  const anchor = line.align === "right" ? "end" : line.align === "left" ? "start" : "middle";
  const strokeWidth = (line.strokeWidth ?? 0.08) * size;
  const stroke = line.stroke
    ? ` stroke="${line.stroke}" stroke-width="${strokeWidth}" paint-order="stroke" stroke-linejoin="round" stroke-linecap="round"`
    : "";
  const shadow = line.shadow ? ` filter="url(#${line.shadow})"` : "";
  const rotate = line.rotate ? ` rotate(${line.rotate} ${x} ${y})` : "";
  const transform = rotate ? ` transform="${rotate}"` : "";
  const letterSpacing = line.letterSpacing ? ` letter-spacing="${line.letterSpacing}em"` : "";
  const italic = line.italic ? ' font-style="italic"' : "";
  return `<text x="${x}" y="${y}" dominant-baseline="middle" text-anchor="${anchor}" font-size="${size}" font-weight="${line.weight ?? 900}" font-family="${fontFamily(line.font)}" fill="${line.color}"${stroke}${shadow}${letterSpacing}${italic}${transform}>${esc(text)}</text>`;
}

function defs(): string {
  return `<defs>
    <filter id="shadowBlack" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="5" flood-color="#000000" flood-opacity="0.9"/>
    </filter>
    <filter id="shadowSoft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="5" stdDeviation="3" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
    <filter id="shadowBlue" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="8" dy="8" stdDeviation="1.5" flood-color="#3159d4" flood-opacity="1"/>
    </filter>
  </defs>`;
}

const TEMPLATES: TemplateSpec[] = [
  {
    id: "无模板",
    name: "无模板",
    ai: "",
    noText: true,
    sampleBg: "linear-gradient(135deg,#222,#111)",
    sampleText: [],
    lines: [],
  },
  {
    id: "粗黑橙字",
    name: "粗黑橙字",
    ai: `${LEAD}生成两行强冲击标题：第一行短铺垫，第二行是核心大标题。`,
    sampleBg: "#181a1b",
    sampleText: ["毕业后找工作", "如此简单！"],
    lines: [
      {
        key: "line1",
        label: "第一行",
        placeholder: "毕业后找工作",
        x: 0.34,
        y: 0.37,
        size: 0.118,
        align: "center",
        color: "#ffffff",
        stroke: "#050505",
        strokeWidth: 0.12,
        shadow: "shadowSoft",
      },
      {
        key: "line2",
        label: "第二行",
        placeholder: "如此简单！",
        x: 0.5,
        y: 0.62,
        size: 0.185,
        align: "center",
        color: "#070707",
        stroke: "#ff9d00",
        strokeWidth: 0.1,
        shadow: "shadowBlack",
      },
    ],
  },
  {
    id: "红青斜切",
    name: "红青斜切",
    ai: `${LEAD}生成两行反差式文案：第一行短疑问，第二行大结论。`,
    sampleBg: "#181a1b",
    sampleText: ["收视冠军？", "翻身力作？"],
    lines: [
      {
        key: "line1",
        label: "第一行",
        placeholder: "收视冠军？",
        x: 0.36,
        y: 0.43,
        size: 0.125,
        align: "center",
        rotate: -7,
        color: "#ef2e26",
        stroke: "#ffffff",
        strokeWidth: 0.08,
        shadow: "shadowBlack",
      },
      {
        key: "line2",
        label: "第二行",
        placeholder: "翻身力作？",
        x: 0.47,
        y: 0.66,
        size: 0.19,
        align: "center",
        color: "#16e6ff",
        stroke: "#050505",
        strokeWidth: 0.055,
        shadow: "shadowBlack",
      },
    ],
  },
  {
    id: "单行棕影",
    name: "单行棕影",
    ai: `${LEAD}生成一行清晰标题，适合攻略、教程、知识类视频。`,
    sampleBg: "#181a1b",
    sampleText: ["角色养成攻略"],
    lines: [
      {
        key: "line1",
        label: "标题",
        placeholder: "角色养成攻略",
        x: 0.5,
        y: 0.53,
        size: 0.135,
        align: "center",
        color: "#ffffff",
        stroke: "#8a624f",
        strokeWidth: 0.07,
        shadow: "shadowSoft",
      },
    ],
  },
  {
    id: "三段错位",
    name: "三段错位",
    ai: `${LEAD}生成三段错位短句，前两句短，第三句是最大重点。`,
    sampleBg: "#181a1b",
    sampleText: ["你根本", "不会", "上厕所"],
    lines: [
      {
        key: "line1",
        label: "左上短句",
        placeholder: "你根本",
        x: 0.25,
        y: 0.28,
        size: 0.13,
        align: "center",
        rotate: -12,
        color: "#050505",
        stroke: "#ffffff",
        strokeWidth: 0.08,
        shadow: "shadowSoft",
      },
      {
        key: "line2",
        label: "右上短句",
        placeholder: "不会",
        x: 0.72,
        y: 0.30,
        size: 0.115,
        align: "center",
        rotate: -14,
        color: "#050505",
        stroke: "#ffffff",
        strokeWidth: 0.08,
        shadow: "shadowSoft",
      },
      {
        key: "line3",
        label: "底部主标题",
        placeholder: "上厕所",
        x: 0.56,
        y: 0.70,
        size: 0.185,
        align: "center",
        color: "#050505",
        stroke: "#ffffff",
        strokeWidth: 0.065,
        shadow: "shadowSoft",
      },
    ],
  },
  {
    id: "绿黄红字",
    name: "绿黄红字",
    ai: `${LEAD}生成两行年轻化吐槽文案：第一行对象/人群，第二行核心梗。`,
    sampleBg: "#181a1b",
    sampleText: ["年轻人", "耗子尾汁"],
    lines: [
      {
        key: "line1",
        label: "第一行",
        placeholder: "年轻人",
        x: 0.30,
        y: 0.30,
        size: 0.13,
        align: "center",
        rotate: -7,
        color: "#29a34a",
        stroke: "#ffeb3b",
        strokeWidth: 0.09,
        shadow: "shadowSoft",
        letterSpacing: 0.08,
      },
      {
        key: "line2",
        label: "第二行",
        placeholder: "耗子尾汁",
        x: 0.50,
        y: 0.62,
        size: 0.195,
        align: "center",
        color: "#ff392e",
        stroke: "#ffeb3b",
        strokeWidth: 0.075,
        shadow: "shadowSoft",
        letterSpacing: 0.05,
      },
    ],
  },
  {
    id: "手写Vlog",
    name: "手写Vlog",
    ai: `${LEAD}生成两行 Vlog 文案：第一行英文或短标签，第二行中文主题。`,
    sampleBg: "#181a1b",
    sampleText: ["Vlog", "我的旅行回忆"],
    lines: [
      {
        key: "line1",
        label: "手写标题",
        placeholder: "Vlog",
        x: 0.30,
        y: 0.34,
        size: 0.14,
        align: "center",
        rotate: -8,
        color: "#ffffff",
        font: "hand",
        weight: 500,
      },
      {
        key: "line2",
        label: "手写副标题",
        placeholder: "我的旅行回忆",
        x: 0.32,
        y: 0.55,
        size: 0.09,
        align: "center",
        rotate: -8,
        color: "#ffffff",
        font: "hand",
        weight: 500,
        letterSpacing: 0.08,
      },
    ],
  },
  {
    id: "蓝影红字Vlog",
    name: "蓝影红字Vlog",
    ai: `${LEAD}生成三行生活 Vlog 文案，第一、二行短，第三行是大主题。`,
    sampleBg: "#181a1b",
    sampleText: ["我的", "vlog", "日常生活"],
    lines: [
      {
        key: "line1",
        label: "第一行",
        placeholder: "我的",
        x: 0.49,
        y: 0.30,
        size: 0.13,
        align: "center",
        rotate: 5,
        color: "#ff4037",
        stroke: "#3159d4",
        strokeWidth: 0.09,
        shadow: "shadowBlue",
      },
      {
        key: "line2",
        label: "第二行",
        placeholder: "vlog",
        x: 0.66,
        y: 0.43,
        size: 0.115,
        align: "center",
        rotate: 5,
        color: "#ff4037",
        stroke: "#3159d4",
        strokeWidth: 0.09,
        shadow: "shadowBlue",
      },
      {
        key: "line3",
        label: "第三行",
        placeholder: "日常生活",
        x: 0.55,
        y: 0.66,
        size: 0.165,
        align: "center",
        color: "#ff4037",
        stroke: "#3159d4",
        strokeWidth: 0.07,
        shadow: "shadowBlue",
      },
    ],
  },
  {
    id: "美食散点",
    name: "美食散点",
    ai: `${LEAD}生成四行美食文案：第一行冲击短句，第二行菜系/主题，第三四行是菜品标签。`,
    sampleBg: "#181a1b",
    sampleText: ["辣到没朋友！", "川菜", "辣子鸡", "水煮肉片"],
    lines: [
      {
        key: "line1",
        label: "顶部短句",
        placeholder: "辣到没朋友！",
        x: 0.33,
        y: 0.28,
        size: 0.105,
        align: "center",
        rotate: -4,
        color: "#ff392e",
        stroke: "#ffffff",
        strokeWidth: 0.08,
        shadow: "shadowSoft",
      },
      {
        key: "line2",
        label: "顶部主词",
        placeholder: "川菜",
        x: 0.68,
        y: 0.25,
        size: 0.17,
        align: "center",
        color: "#ff392e",
        stroke: "#ffffff",
        strokeWidth: 0.065,
        shadow: "shadowSoft",
      },
      {
        key: "line3",
        label: "左下标签",
        placeholder: "辣子鸡",
        x: 0.25,
        y: 0.58,
        size: 0.085,
        align: "center",
        rotate: -11,
        color: "#fff32b",
        stroke: "#050505",
        strokeWidth: 0.08,
        shadow: "shadowSoft",
      },
      {
        key: "line4",
        label: "右下标签",
        placeholder: "水煮肉片",
        x: 0.54,
        y: 0.65,
        size: 0.085,
        align: "center",
        rotate: 13,
        color: "#fff32b",
        stroke: "#050505",
        strokeWidth: 0.08,
        shadow: "shadowSoft",
      },
    ],
  },
  {
    id: "黄蓝三行",
    name: "黄蓝三行",
    ai: `${LEAD}生成三行知识/玄学/教程标题，第一行短引子，后两行是主标题。`,
    sampleBg: "#181a1b",
    sampleText: ["熬夜", "如何", "科学修仙"],
    lines: [
      {
        key: "line1",
        label: "引子",
        placeholder: "熬夜",
        x: 0.21,
        y: 0.28,
        size: 0.1,
        align: "center",
        color: "#ffffff",
        stroke: "#3159d4",
        strokeWidth: 0.12,
        shadow: "shadowSoft",
      },
      {
        key: "line2",
        label: "主标题一",
        placeholder: "如何",
        x: 0.29,
        y: 0.50,
        size: 0.175,
        align: "center",
        color: "#ffeb3b",
        stroke: "#3159d4",
        strokeWidth: 0.09,
        shadow: "shadowSoft",
      },
      {
        key: "line3",
        label: "主标题二",
        placeholder: "科学修仙",
        x: 0.37,
        y: 0.70,
        size: 0.165,
        align: "center",
        color: "#ffeb3b",
        stroke: "#3159d4",
        strokeWidth: 0.09,
        shadow: "shadowSoft",
      },
    ],
  },
  {
    id: "白黄居中",
    name: "白黄居中",
    ai: `${LEAD}生成两行居中标题：第一行短评价，第二行是作品名或核心对象。`,
    sampleBg: "#181a1b",
    sampleText: ["最强拉麦！", "《躲汉子》"],
    lines: [
      {
        key: "line1",
        label: "第一行",
        placeholder: "最强拉麦！",
        x: 0.58,
        y: 0.35,
        size: 0.11,
        align: "center",
        color: "#ffffff",
        stroke: "#2a2a2a",
        strokeWidth: 0.055,
        shadow: "shadowSoft",
      },
      {
        key: "line2",
        label: "第二行",
        placeholder: "《躲汉子》",
        x: 0.57,
        y: 0.55,
        size: 0.16,
        align: "center",
        color: "#ffeb25",
        stroke: "#050505",
        strokeWidth: 0.055,
        shadow: "shadowSoft",
      },
    ],
  },
];

const TEMPLATE_MAP = Object.fromEntries(TEMPLATES.map((template) => [template.id, template]));

export const COVER_TEMPLATE_IDS = TEMPLATES.map((template) => template.id);

export function getTemplateSpec(id: string): TemplateSpec {
  return TEMPLATE_MAP[id] || TEMPLATE_MAP[DEFAULT_COVER_TEMPLATE];
}

export function normalizeCoverTemplateId(id: string): string {
  return TEMPLATE_MAP[id] ? id : DEFAULT_COVER_TEMPLATE;
}

export function coverTemplateAiPrompt(id: string): string {
  return getTemplateSpec(id).ai;
}

export function coverTemplateFields(id: string): CoverField[] {
  return getTemplateSpec(id).lines.map(lineToField);
}

export function coverTemplateSampleBg(id: string): string {
  return getTemplateSpec(id).sampleBg;
}

export function coverTemplateSampleText(id: string): string[] {
  return getTemplateSpec(id).sampleText;
}

export function isNoTemplate(id: string): boolean {
  return !!getTemplateSpec(id).noText;
}

export interface BuildSvgOptions {
  width?: number;
  height?: number;
  orientation?: "landscape" | "portrait";
  responsive?: boolean;
}

export function buildCoverSvg(
  id: string,
  texts: string[],
  opts: BuildSvgOptions = {},
): string {
  const spec = getTemplateSpec(id);
  const landscape = (opts.orientation ?? "landscape") === "landscape";
  const w = opts.width ?? (landscape ? 1440 : 1080);
  const h = opts.height ?? (landscape ? 1080 : 1920);
  const sizeAttr = opts.responsive
    ? 'width="100%" height="100%"'
    : `width="${w}" height="${h}"`;
  const body = spec.noText
    ? ""
    : spec.lines
      .map((line, index) => {
        const text = (texts[index] || spec.sampleText[index] || "").trim();
        return text ? textEl(text, line, w, h) : "";
      })
      .join("");
  return `<svg ${sizeAttr} viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${defs()}${body}</svg>`;
}
