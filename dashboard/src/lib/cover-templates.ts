// Shared cover-template engine (pure, dependency-free).
// Single source of truth for BOTH the backend renderer
// (src/jobs/generate-cover.ts) and the dashboard preview cards. It only builds
// SVG/strings — no fs / sharp / DOM — so it is safe to import on either side.

export interface CoverField {
  key: string;
  label: string;
  placeholder: string;
}

export interface LineStyle {
  sizeFrac: number; // font size as a fraction of canvas height
  color?: string; // text fill (not needed when `chip` provides the fill)
  stroke?: string;
  sw?: number; // stroke width as a fraction of the font size
  italic?: boolean;
  chip?: string; // if set, draw a filled box behind this line
  chipText?: string; // optional text color override when on a chip
  shadow?: boolean;
}

export interface TextBox {
  align: "left" | "center";
  x?: number; // left anchor as fraction of width (align=left)
  anchorY: "top" | "center" | "bottom";
  margin?: number; // top/bottom margin as fraction of height
  gap?: number; // gap between lines as fraction of height
}

export interface TemplateSpec {
  fields: CoverField[];
  ai: string;
  sampleBg: string; // CSS background used behind the SVG in preview cards
  lines: [LineStyle, LineStyle, LineStyle];
  box: TextBox;
  layers?: (w: number, h: number, uid: string) => string; // behind text
  front?: (w: number, h: number, uid: string) => string; // above text
  noText?: boolean;
}

const FONT_STACK =
  "Heiti SC, PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif";

const defaultFields: CoverField[] = [
  { key: "line1", label: "第一行", placeholder: "情绪/语气词，如：海外网友" },
  { key: "line2", label: "第二行", placeholder: "主标题前半句" },
  { key: "line3", label: "第三行", placeholder: "主标题后半句" },
];

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Rough text width estimate (CJK ≈ 1em, ASCII ≈ 0.56em).
function estWidth(text: string, size: number): number {
  let u = 0;
  for (const ch of text) u += ch.charCodeAt(0) > 255 ? 1 : 0.56;
  return u * size;
}

// ---- layer primitives (absolute coordinates) ----------------------------

export function rectEl(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  op = 1,
  rx = 0,
  rot = 0,
): string {
  const t = rot ? ` transform="rotate(${rot} ${x + w / 2} ${y + h / 2})"` : "";
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" fill-opacity="${op}"${t}/>`;
}

export function polyEl(pts: Array<[number, number]>, fill: string, op = 1): string {
  const p = pts.map(([x, y]) => `${x},${y}`).join(" ");
  return `<polygon points="${p}" fill="${fill}" fill-opacity="${op}"/>`;
}

// Full-frame darkening / tint.
function darken(w: number, h: number, op: number, color = "#000"): string {
  return rectEl(0, 0, w, h, color, op);
}

// Vertical gradient band anchored to bottom (legibility for bottom text).
function bottomGrad(w: number, h: number, uid: string, color: string, frac: number): string {
  return `<defs><linearGradient id="bg_${uid}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${color}" stop-opacity="0.85"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${rectEl(0, h * (1 - frac), w, h * frac, `url(#bg_${uid})`)}`;
}

// ---- text block ---------------------------------------------------------

function renderText(texts: string[], spec: TemplateSpec, w: number, h: number, uid: string): string {
  const box = spec.box;
  const gap = (box.gap ?? 0.02) * h;
  const sizes = spec.lines.map((l) => l.sizeFrac * h);
  const used = texts.map((_, i) => i).filter((i) => texts[i]);
  const blockH = used.reduce((s, i) => s + sizes[i], 0) + Math.max(0, used.length - 1) * gap;

  const margin = (box.margin ?? 0.07) * h;
  let top: number;
  if (box.anchorY === "top") top = margin;
  else if (box.anchorY === "bottom") top = h - margin - blockH;
  else top = (h - blockH) / 2;

  const leftX = (box.x ?? 0.06) * w;
  const cx = w / 2;
  let out = "";

  for (const i of used) {
    const s = spec.lines[i];
    const size = sizes[i];
    const tw = estWidth(texts[i], size);
    const padX = size * 0.22;
    const x = box.align === "center" ? cx : leftX;
    if (s.chip) {
      const cw = tw + padX * 2;
      const chipX = box.align === "center" ? cx - cw / 2 : leftX - padX;
      out += rectEl(chipX, top - size * 0.12, cw, size * 1.24, s.chip, 1, size * 0.12);
    }
    const sw = (s.sw ?? 0.085) * size;
    const fill = s.chip ? s.chipText || "#fff" : s.color || "#fff";
    const stroke = s.chip ? "" : s.stroke ? ` stroke="${s.stroke}" stroke-width="${sw}" paint-order="stroke" stroke-linejoin="round"` : "";
    const anchor = box.align === "center" ? "middle" : "start";
    const style = s.italic ? ' font-style="italic"' : "";
    out += `<text x="${x}" y="${top}" dominant-baseline="hanging" text-anchor="${anchor}" font-size="${size}" font-weight="900" font-family="${FONT_STACK}" fill="${fill}"${stroke}${style}>${esc(texts[i])}</text>`;
    top += size + gap;
  }
  return out;
}

export { FONT_STACK, defaultFields, esc, estWidth, darken, bottomGrad, renderText };

// ---- template registry --------------------------------------------------

const LEAD = "封面文案以视频标题和介绍为核心，紧扣视频实际主题。";

export const DEFAULT_COVER_TEMPLATE = "红黄爆款";

const TEMPLATES: Record<string, TemplateSpec> = {
  "无模板": {
    fields: [],
    ai: "",
    noText: true,
    sampleBg: "linear-gradient(135deg,#cbd5e1,#94a3b8)",
    box: { align: "center", anchorY: "center" },
    lines: [
      { sizeFrac: 0.1, color: "#fff" },
      { sizeFrac: 0.1, color: "#fff" },
      { sizeFrac: 0.1, color: "#fff" },
    ],
  },
  "红黄爆款": {
    fields: defaultFields,
    ai: `${LEAD}用强冲击、有悬念的爆款口吻制造点击欲望，避免与视频内容无关的夸张。`,
    sampleBg: "linear-gradient(135deg,#3a0d0d,#7a1f10)",
    layers: (w, h, u) => darken(w, h, 0.12) + bottomGrad(w, h, u, "#000", 0.55),
    box: { align: "left", x: 0.055, anchorY: "bottom", margin: 0.06, gap: 0.012 },
    lines: [
      { sizeFrac: 0.085, color: "#fff", stroke: "#c81e1e", sw: 0.12 },
      { sizeFrac: 0.155, color: "#ffe000", stroke: "#c81e1e", sw: 0.12 },
      { sizeFrac: 0.078, chip: "#e21b1b", chipText: "#fff" },
    ],
  },
  "美食探店": {
    fields: defaultFields,
    ai: `${LEAD}突出美食/探店的诱人卖点，用具体菜名或看点做短标签式文案。`,
    sampleBg: "linear-gradient(135deg,#5a1b08,#b3450f)",
    layers: (w, h, u) => darken(w, h, 0.1) + bottomGrad(w, h, u, "#1a0600", 0.6),
    box: { align: "left", x: 0.06, anchorY: "bottom", margin: 0.07, gap: 0.022 },
    lines: [
      { sizeFrac: 0.082, color: "#fff", stroke: "#000", sw: 0.1 },
      { sizeFrac: 0.105, chip: "#e0231f", chipText: "#fff" },
      { sizeFrac: 0.105, chip: "#1f5fe0", chipText: "#fff" },
    ],
  },
  "蓝色科技": {
    fields: defaultFields,
    ai: `${LEAD}突出科技感与硬核参数，文案冷静、专业、有信息量。`,
    sampleBg: "linear-gradient(135deg,#041018,#0a3550)",
    layers: (w, h, u) => darken(w, h, 0.22) + bottomGrad(w, h, u, "#001018", 0.4),
    front: (w, h) => rectEl(w * 0.06, h * 0.2 + h * 0.3, w * 0.3, h * 0.012, "#00E5FF", 1, h * 0.006),
    box: { align: "left", x: 0.06, anchorY: "top", margin: 0.1, gap: 0.018 },
    lines: [
      { sizeFrac: 0.08, color: "#7FD4FF", stroke: "#001018", sw: 0.1 },
      { sizeFrac: 0.14, color: "#00E5FF", stroke: "#001a26", sw: 0.12 },
      { sizeFrac: 0.07, color: "#ffffff", stroke: "#002b3d", sw: 0.08 },
    ],
  },
  "黑金质感": {
    fields: defaultFields,
    ai: `${LEAD}走高级、克制的质感路线，文案精炼、有格调。`,
    sampleBg: "linear-gradient(135deg,#0a0a0a,#241a08)",
    layers: (w, h) => darken(w, h, 0.4),
    front: (w, h) =>
      rectEl(w * 0.25, h * 0.5 - h * 0.18, w * 0.5, h * 0.004, "#D4AF37") +
      rectEl(w * 0.25, h * 0.5 + h * 0.18, w * 0.5, h * 0.004, "#D4AF37"),
    box: { align: "center", anchorY: "center", gap: 0.03 },
    lines: [
      { sizeFrac: 0.05, color: "#D4AF37" },
      { sizeFrac: 0.11, color: "#F7ECC9" },
      { sizeFrac: 0.045, color: "#D4AF37" },
    ],
  },
  "清新简约": {
    fields: defaultFields,
    ai: `${LEAD}走清新简约风格，文案自然、轻松、有亲和力。`,
    sampleBg: "linear-gradient(135deg,#dbe6f5,#a9c2e6)",
    layers: (w, h) =>
      rectEl(0, h * 0.58, w, h * 0.42, "#ffffff", 0.82) +
      rectEl(0, h * 0.58, w, h * 0.012, "#2563EB", 0.9),
    box: { align: "left", x: 0.08, anchorY: "bottom", margin: 0.08, gap: 0.015 },
    lines: [
      { sizeFrac: 0.07, color: "#2563EB" },
      { sizeFrac: 0.12, color: "#0F172A" },
      { sizeFrac: 0.06, color: "#475569" },
    ],
  },
  "蓝天vlog": {
    fields: defaultFields,
    ai: `${LEAD}走轻松治愈的 Vlog 口吻，像朋友分享一样自然。`,
    sampleBg: "linear-gradient(180deg,#7ec8ff,#cfeaff)",
    layers: (w, h, u) =>
      `<defs><linearGradient id="sky_${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3ff" stop-opacity="0.55"/><stop offset="1" stop-color="#bfe3ff" stop-opacity="0"/></linearGradient></defs>` +
      rectEl(0, 0, w, h * 0.5, `url(#sky_${u})`),
    box: { align: "left", x: 0.06, anchorY: "top", margin: 0.09, gap: 0.018 },
    lines: [
      { sizeFrac: 0.1, color: "#1d4ed8", italic: true, stroke: "#ffffff", sw: 0.06 },
      { sizeFrac: 0.075, color: "#ffffff", stroke: "#1e3a8a", sw: 0.08 },
      { sizeFrac: 0.06, color: "#e0ecff", stroke: "#1e3a8a", sw: 0.06 },
    ],
  },
  "新闻头条": {
    fields: defaultFields,
    ai: `${LEAD}用新闻头条式的客观口吻概括核心事件，避免主观夸张。`,
    sampleBg: "linear-gradient(135deg,#101826,#26405e)",
    layers: (w, h) =>
      darken(w, h, 0.12) +
      rectEl(0, h * 0.72, w, h * 0.28, "#0b2e7a", 0.92) +
      rectEl(0, h * 0.7, w, h * 0.022, "#dd1111"),
    box: { align: "left", x: 0.05, anchorY: "bottom", margin: 0.045, gap: 0.01 },
    lines: [
      { sizeFrac: 0.06, color: "#FFE000", stroke: "#7a0b0b", sw: 0.1 },
      { sizeFrac: 0.085, color: "#ffffff", stroke: "#0b2e7a", sw: 0.08 },
      { sizeFrac: 0.05, color: "#cfe0ff" },
    ],
  },
  "综艺花字": {
    fields: defaultFields,
    ai: `${LEAD}用综艺花字般活泼、夸张、有梗的口吻，突出笑点和看点。`,
    sampleBg: "linear-gradient(135deg,#2a0f2a,#0f2a26)",
    layers: (w, h) => darken(w, h, 0.25),
    box: { align: "center", anchorY: "center", gap: 0.02 },
    lines: [
      { sizeFrac: 0.1, color: "#FF4FA3", stroke: "#ffffff", sw: 0.14 },
      { sizeFrac: 0.135, color: "#FFE000", stroke: "#222222", sw: 0.12 },
      { sizeFrac: 0.08, color: "#36E0C8", stroke: "#222222", sw: 0.12 },
    ],
  },
  "打工人": {
    fields: defaultFields,
    ai: `${LEAD}用打工人/职场共鸣的口吻，犀利、有代入感。`,
    sampleBg: "linear-gradient(135deg,#161616,#3a3526)",
    layers: (w, h, u) => darken(w, h, 0.12) + bottomGrad(w, h, u, "#000", 0.6),
    box: { align: "left", x: 0.06, anchorY: "bottom", margin: 0.07, gap: 0.012 },
    lines: [
      { sizeFrac: 0.07, color: "#ffffff", stroke: "#000", sw: 0.1 },
      { sizeFrac: 0.145, color: "#FFC400", stroke: "#000", sw: 0.12 },
      { sizeFrac: 0.07, color: "#ffffff", stroke: "#000", sw: 0.08 },
    ],
  },
  "撞色分栏": {
    fields: defaultFields,
    ai: `${LEAD}用利落的短句制造反差与冲突感，突出核心结论。`,
    sampleBg: "linear-gradient(135deg,#1f2937,#374151)",
    layers: (w, h) =>
      darken(w, h, 0.12) +
      polyEl([[0, h * 0.22], [w * 0.72, h * 0.4], [w * 0.62, h], [0, h]], "#FFD400", 0.96),
    box: { align: "left", x: 0.07, anchorY: "bottom", margin: 0.1, gap: 0.018 },
    lines: [
      { sizeFrac: 0.085, color: "#1f2937" },
      { sizeFrac: 0.12, color: "#111827" },
      { sizeFrac: 0.085, chip: "#111827", chipText: "#FFE000" },
    ],
  },
  "悬念追问": {
    fields: defaultFields,
    ai: `${LEAD}用设问/悬念口吻抛出核心看点，引导观众点击寻找答案。`,
    sampleBg: "linear-gradient(135deg,#2a0a0a,#5a1212)",
    layers: (w, h) => darken(w, h, 0.25),
    front: (w, h) => {
      const r = h * 0.11;
      const cx = w * 0.85;
      const cy = h * 0.17;
      return (
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#dd1111" stroke="#fff" stroke-width="${r * 0.12}"/>` +
        `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${r * 1.1}" font-weight="900" font-family="${FONT_STACK}" fill="#fff">秘</text>`
      );
    },
    box: { align: "left", x: 0.06, anchorY: "center", gap: 0.018 },
    lines: [
      { sizeFrac: 0.08, color: "#ffffff", stroke: "#b00000", sw: 0.1 },
      { sizeFrac: 0.13, color: "#FFE000", stroke: "#7a0b0b", sw: 0.12 },
      { sizeFrac: 0.1, color: "#FFE000", stroke: "#7a0b0b", sw: 0.12 },
    ],
  },
};

// ---- public API ---------------------------------------------------------

export const COVER_TEMPLATE_IDS = Object.keys(TEMPLATES);

export function getTemplateSpec(id: string): TemplateSpec {
  return TEMPLATES[id] || TEMPLATES[DEFAULT_COVER_TEMPLATE];
}
export function coverTemplateAiPrompt(id: string): string {
  return getTemplateSpec(id).ai;
}
export function coverTemplateFields(id: string): CoverField[] {
  return getTemplateSpec(id).fields;
}
export function coverTemplateSampleBg(id: string): string {
  return getTemplateSpec(id).sampleBg;
}
export function isNoTemplate(id: string): boolean {
  return !!getTemplateSpec(id).noText;
}

export interface BuildSvgOptions {
  width?: number;
  height?: number;
  orientation?: "landscape" | "portrait";
  responsive?: boolean; // emit width/height="100%" for inline preview
  uid?: string;
}

let _uidCounter = 0;

export function buildCoverSvg(
  id: string,
  texts: string[],
  opts: BuildSvgOptions = {},
): string {
  const spec = getTemplateSpec(id);
  const landscape = (opts.orientation ?? "landscape") === "landscape";
  const w = opts.width ?? (landscape ? 1440 : 1080);
  const h = opts.height ?? (landscape ? 1080 : 1920);
  const uid = opts.uid ?? `c${_uidCounter++}`;
  const sizeAttr = opts.responsive
    ? 'width="100%" height="100%"'
    : `width="${w}" height="${h}"`;
  let body = "";
  if (!spec.noText) {
    if (spec.layers) body += spec.layers(w, h, uid);
    body += renderText(texts, spec, w, h, uid);
    if (spec.front) body += spec.front(w, h, uid);
  }
  return `<svg ${sizeAttr} viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
