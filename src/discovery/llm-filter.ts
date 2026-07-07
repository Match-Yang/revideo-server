import { translateText } from "../translate/openai-compatible";
import type { DiscoveredVideo } from "./types";

/**
 * 让 LLM 按用户提示词对视频列表做语义过滤，返回保留的 videoId 列表。
 * 容错：若 LLM 返回非法 JSON 或调用失败，降级为「全部保留」（宁滥勿缺）。
 */
export async function llmFilterVideos(
  videos: DiscoveredVideo[],
  prompt: string,
  signal?: AbortSignal,
): Promise<{ kept: string[]; error?: string }> {
  if (!prompt.trim() || videos.length === 0) {
    return { kept: videos.map((v) => v.videoId) };
  }

  const lines = videos.map((v, i) => {
    const meta = [
      `views=${v.viewCount ?? "?"}`,
      `comments=${v.commentCount ?? "?"}`,
      `date=${v.publishedAt ?? "?"}`,
    ].join(" ");
    return `${i + 1}. [${v.videoId}] ${v.title}  (${meta})`;
  });
  const videoListText = lines.join("\n");

  const systemPrompt = `你是一个视频筛选助手。用户会给你一个筛选标准和一组带编号的视频（含 videoId、标题、观看数、评论数、发布日期）。
请严格按照筛选标准判断哪些视频符合，返回一个 JSON 数组，元素是符合的视频的 videoId 字符串。
只返回 JSON 数组，不要任何其他文字。例如：["abc123","def456"]

筛选标准：
${prompt}

待筛选视频：
${videoListText}`;

  try {
    const raw = await translateText({
      text: "请按上述标准筛选视频，返回 JSON 数组。",
      sourceLanguage: "auto",
      targetLanguage: "zh",
      systemPrompt,
    });
    // 尝试从返回文本里提取 JSON 数组
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      return { kept: videos.map((v) => v.videoId), error: "LLM 未返回 JSON 数组，已全部保留" };
    }
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) {
      return { kept: videos.map((v) => v.videoId), error: "LLM 返回非数组，已全部保留" };
    }
    const validIds = new Set(videos.map((v) => v.videoId));
    const kept = parsed.filter((id): id is string => typeof id === "string" && validIds.has(id));
    return { kept };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kept: videos.map((v) => v.videoId), error: `LLM 过滤失败：${msg}，已全部保留` };
  }
}
