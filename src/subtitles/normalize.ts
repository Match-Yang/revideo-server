export interface NormalizedSubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

interface WebVttBlock {
  start: number;
  end: number;
  textLines: string[];
}

interface TimedFragment {
  start: number;
  endHint: number;
  text: string;
  order: number;
}

const INLINE_TIMESTAMP_RE = /<(\d{2}:\d{2}:\d{2}\.\d{3})>/g;
const HAS_INLINE_TIMESTAMP_RE = /<\d{2}:\d{2}:\d{2}\.\d{3}>/;
const TIMING_LINE_RE =
  /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/;

export function hasInlineWebVttTimestamps(content: string): boolean {
  return HAS_INLINE_TIMESTAMP_RE.test(content);
}

export function parseSubtitleTimestamp(value: string): number {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function cleanSubtitleText(value: string): string {
  return decodeEntities(value)
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
    .replace(/<\/?c[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWebVttBlocks(content: string): WebVttBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split(/\n/);
  const blocks: WebVttBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const timing = lines[index].match(TIMING_LINE_RE);
    if (!timing) continue;

    const textLines: string[] = [];
    index += 1;
    while (index < lines.length && !TIMING_LINE_RE.test(lines[index])) {
      textLines.push(lines[index]);
      index += 1;
    }
    index -= 1;

    blocks.push({
      start: parseSubtitleTimestamp(timing[1]),
      end: parseSubtitleTimestamp(timing[2]),
      textLines,
    });
  }

  return blocks;
}

function pushTimedText(
  fragments: TimedFragment[],
  rawText: string,
  start: number,
  endHint: number,
  order: number,
): number {
  const text = cleanSubtitleText(rawText);
  if (!text) return order;
  fragments.push({ start, endHint, text, order });
  return order + 1;
}

function extractInlineFragments(blocks: WebVttBlock[]): TimedFragment[] {
  let order = 0;
  const fragments: TimedFragment[] = [];

  for (const block of blocks) {
    for (const line of block.textLines) {
      if (!HAS_INLINE_TIMESTAMP_RE.test(line)) continue;

      INLINE_TIMESTAMP_RE.lastIndex = 0;
      let cursor = 0;
      let currentStart = block.start;
      let match: RegExpExecArray | null;

      while ((match = INLINE_TIMESTAMP_RE.exec(line))) {
        order = pushTimedText(fragments, line.slice(cursor, match.index), currentStart, block.end, order);
        currentStart = parseSubtitleTimestamp(match[1]);
        cursor = match.index + match[0].length;
      }

      order = pushTimedText(fragments, line.slice(cursor), currentStart, block.end, order);
    }
  }

  const seen = new Set<string>();
  return fragments
    .sort((a, b) => (a.start === b.start ? a.order - b.order : a.start - b.start))
    .filter((fragment) => {
      const key = `${fragment.start.toFixed(3)}\u0000${fragment.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function appendFragmentText(current: string, next: string): string {
  if (!current) return next.trim();
  const trimmed = next.trim();
  if (!trimmed) return current;
  if (/^[,.;:!?%)\]}，。；：！？、]/.test(trimmed)) return `${current}${trimmed}`;
  if (/[$£€¥]$/.test(current)) return `${current}${trimmed}`;
  return `${current} ${trimmed}`;
}

function shouldBreakSegment(text: string, duration: number, nextGap: number): boolean {
  const charCount = text.length;
  if (/[.!?。！？]$/.test(text) && duration >= 0.8) return true;
  if (/[,;:，；：]$/.test(text) && (duration >= 5.2 || charCount >= 70)) return true;
  if (nextGap >= 0.5 && duration >= 1.2) return true;
  if (duration >= 8 || charCount >= 150) return true;
  return false;
}

function timedFragmentsToNormalCues(fragments: TimedFragment[]): NormalizedSubtitleCue[] {
  const cues: NormalizedSubtitleCue[] = [];
  let currentStart: number | undefined;
  let currentEnd = 0;
  let currentText = "";

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    const next = fragments[index + 1];
    const fragmentEnd = next && next.start > fragment.start ? next.start : fragment.endHint;

    if (currentStart === undefined) currentStart = fragment.start;
    currentEnd = Math.max(currentEnd, fragmentEnd);
    currentText = appendFragmentText(currentText, fragment.text);

    const nextGap = next ? Math.max(0, next.start - currentEnd) : Number.POSITIVE_INFINITY;
    const duration = currentEnd - currentStart;
    if (index === fragments.length - 1 || shouldBreakSegment(currentText, duration, nextGap)) {
      cues.push({
        id: `cue-${cues.length}`,
        start: currentStart,
        end: Math.max(currentStart + 0.25, currentEnd),
        text: currentText,
      });
      currentStart = undefined;
      currentEnd = 0;
      currentText = "";
    }
  }

  return mergeTinyCues(cues);
}

function canMerge(left: NormalizedSubtitleCue, right: NormalizedSubtitleCue): boolean {
  const duration = right.end - left.start;
  const textLength = `${left.text} ${right.text}`.length;
  return duration <= 6.5 && textLength <= 110;
}

function mergeCuePair(left: NormalizedSubtitleCue, right: NormalizedSubtitleCue, id: string): NormalizedSubtitleCue {
  return {
    id,
    start: left.start,
    end: Math.max(left.end, right.end),
    text: appendFragmentText(left.text, right.text),
  };
}

function mergeTinyCues(input: NormalizedSubtitleCue[]): NormalizedSubtitleCue[] {
  const merged: NormalizedSubtitleCue[] = [];

  for (const cue of input) {
    const duration = cue.end - cue.start;
    const isTiny = duration < 0.7 || cue.text.length < 4;
    const previous = merged[merged.length - 1];

    if (isTiny && previous && canMerge(previous, cue)) {
      merged[merged.length - 1] = mergeCuePair(previous, cue, previous.id);
      continue;
    }

    merged.push({ ...cue, id: `cue-${merged.length}` });
  }

  for (let index = 0; index < merged.length - 1; index += 1) {
    const cue = merged[index];
    const next = merged[index + 1];
    if (cue.end > next.start) cue.end = Math.max(cue.start + 0.25, next.start - 0.02);
  }

  return merged.map((cue, index) => ({ ...cue, id: `cue-${index}` }));
}

export function normalizeYouTubeRollingWebVtt(content: string): NormalizedSubtitleCue[] | undefined {
  if (!hasInlineWebVttTimestamps(content)) return undefined;

  const fragments = extractInlineFragments(parseWebVttBlocks(content));
  if (fragments.length === 0) return undefined;

  const cues = timedFragmentsToNormalCues(fragments);
  return cues.length > 0 ? cues : undefined;
}

export function normalizeShortWebVttCues(content: string): NormalizedSubtitleCue[] | undefined {
  const blocks = parseWebVttBlocks(content);
  if (blocks.length === 0) return undefined;
  const cues = blocks
    .map((block, index) => ({
      id: `cue-${index}`,
      start: block.start,
      end: block.end,
      text: cleanSubtitleText(block.textLines.join("\n")),
    }))
    .filter((cue) => cue.text);
  const merged = mergeTinyCues(cues);
  return merged.length > 0 ? merged : undefined;
}

function formatSubtitleTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function serializeWebVttCues(cues: NormalizedSubtitleCue[], language = "captions"): string {
  const blocks = cues.map((cue) =>
    `${formatSubtitleTimestamp(cue.start)} --> ${formatSubtitleTimestamp(cue.end)}\n${cue.text}`
  );
  return `WEBVTT\nKind: captions\nLanguage: ${language}\n\n${blocks.join("\n\n")}\n`;
}
