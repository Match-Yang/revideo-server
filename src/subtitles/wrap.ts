import fs from "fs";

// ffmpeg converts VTT/SRT subtitles to ASS using a fixed 384x288 play
// resolution (its default PlayResX/PlayResY), and the inherited Default style
// uses MarginL=MarginR=10. So the usable text width is 384 - 20 = 364 ASS units.
const ASS_PLAY_RES_X = 384;
const ASS_MARGIN = 10;
// Headroom for the text outline + rendering variance so a wrapped segment never
// overflows the margin (which is what clips long CJK lines today).
const WRAP_SAFETY = 0.9;

const CJK_RE = /[一-鿿㐀-䶿぀-ヿ가-힯]/u;

/**
 * Estimated glyph width in "CJK em" units, where one CJK ideograph = 1.0. Used
 * to budget subtitle line lengths so wrapped segments fit the ASS play width.
 */
export function charWidth(char: string): number {
  if (CJK_RE.test(char)) return 1;
  if (/[A-Z]/.test(char)) return 0.64;
  if (/[a-z0-9]/.test(char)) return 0.55;
  if (/\s/.test(char)) return 0.32;
  return 0.72;
}

export function textWidth(text: string): number {
  return [...text].reduce((sum, char) => sum + charWidth(char), 0);
}

export function tokenizeParagraph(paragraph: string): string[] {
  const tokens = paragraph.match(
    /[一-鿿㐀-䶿぀-ヿ가-힯]|[^\s一-鿿㐀-䶿぀-ヿ가-힯]+|\s+/gu,
  );
  return tokens || [];
}

function trimLineEnd(value: string): string {
  return value.replace(/\s+$/g, "");
}

export function wrapParagraph(paragraph: string, maxWidth: number): string[] {
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

// Characters that must not begin a wrapped line (kinsoku shori, lite). Pulling
// them back onto the previous line may nudge it ~1em past the budget, which the
// WRAP_SAFETY headroom absorbs.
const LEADING_PUNCT_RE = /^[，。；：！？、,.!?;:）》」』\]）)]/;

function kinsokuFixup(lines: string[]): string[] {
  for (let i = 1; i < lines.length; i += 1) {
    while (lines[i] && LEADING_PUNCT_RE.test(lines[i])) {
      lines[i - 1] += lines[i][0];
      lines[i] = lines[i].slice(1);
      if (!lines[i].trim()) {
        lines.splice(i, 1);
        i -= 1;
        break;
      }
    }
  }
  return lines;
}

/**
 * Maximum line width in CJK-em units for a given ASS font size, derived from the
 * 384-unit play resolution. Wrapped lines stay <= this wide so they fit without
 * libass needing to auto-wrap (CJK has no spaces, so libass can't break long
 * Chinese lines and clips them - we break explicitly instead).
 */
export function subtitleMaxWidthEm(fontSize: number): number {
  const usable = ASS_PLAY_RES_X - ASS_MARGIN * 2;
  return Math.max(4, (usable / fontSize) * WRAP_SAFETY);
}

/** Wrap one cue's text, preserving existing line breaks (e.g. bilingual). */
export function wrapSubtitleText(text: string, maxWidthEm: number): string {
  return text
    .split(/\r?\n/)
    .map((line) => kinsokuFixup(wrapParagraph(line, maxWidthEm)).join("\n"))
    .join("\n");
}

const TIMING_RE = /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/;

/** Wrap every cue in a WebVTT document; non-cue blocks (header) are preserved. */
export function wrapSubtitleVtt(content: string, maxWidthEm: number): string {
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = text.split(/\n[ \t]*\n/);
  const wrapped = blocks.map((block) => {
    if (!TIMING_RE.test(block)) return block;
    const lines = block.split("\n");
    const timingIdx = lines.findIndex((line) => TIMING_RE.test(line));
    const head = lines.slice(0, timingIdx + 1);
    const body = lines.slice(timingIdx + 1).join("\n").trim();
    if (!body) return block;
    return [...head, wrapSubtitleText(body, maxWidthEm)].join("\n");
  });
  return `${wrapped.join("\n\n").trim()}\n`;
}

/**
 * Wrap a VTT file on disk into `destPath`, sized for the given ASS font size.
 * If reading or wrapping fails, copies the source verbatim so rendering never
 * breaks. Returns `destPath`.
 */
export function wrapSubtitleVttFile(srcPath: string, destPath: string, fontSize: number): string {
  const content = fs.readFileSync(srcPath, "utf-8");
  fs.writeFileSync(destPath, wrapSubtitleVtt(content, subtitleMaxWidthEm(fontSize)), "utf-8");
  return destPath;
}
