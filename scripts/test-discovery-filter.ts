/**
 * 测试脚本：用 yt-dlp flat-playlist 扫频道视频，再 probe 前 N 个，
 * 展示每一步过滤的实际效果。
 *
 * 用法: npx tsx scripts/test-discovery-filter.ts
 */
import { execFileText } from "../src/platforms/sources/youtube";
import { resolveCommand } from "../src/dependencies";
import { loadSettings } from "../src/settings";
import { createJobId, loadJob } from "../src/jobs/store";
// 复制 normalizeChannelUrl 逻辑（未导出）
function normalizeChannelUrl(url: string): string {
  const trimmed = url.trim();
  const base = trimmed.replace(/\/+$/, "");
  if (/\/(videos|shorts|streams|playlists)(\/|$|\?)/.test(base)) return base;
  return `${base}/videos`;
}

// ── 测试频道列表 ──
const CHANNELS = [
  "https://www.youtube.com/@CarSauce",
  "https://www.youtube.com/@wheelfactor360",
  "https://www.youtube.com/@carview_global",
  "https://www.youtube.com/@Beyond-EV",
];

// 硬编码当前过滤阈值（从 settings.json 读）
const settings = loadSettings();
const cfg = settings.task.discovery;
const { minViews, minComments, maxAgeDays } = cfg.filters;
const llmPrompt = cfg.llmPrompt;

console.log("=".repeat(72));
console.log("📋 当前发现过滤器配置");
console.log("=".repeat(72));
console.log(`  minViews:    ${minViews}`);
console.log(`  minComments: ${minComments}`);
console.log(`  maxAgeDays:  ${maxAgeDays}`);
console.log(`  LLM Prompt:  ${llmPrompt ? llmPrompt.slice(0, 80) + "..." : "(空)"}`);
console.log(`  短视频阈值:  ${cfg.shortVideo.maxDurationSec}s, 重复 ${cfg.shortVideo.repeatTimes} 次`);

// ── 1. flat-playlist 扫描每个频道 ──
console.log("\n" + "=".repeat(72));
console.log("📡 步骤1: flat-playlist 扫描频道");
console.log("=".repeat(72));

interface VideoEntry {
  videoId: string;
  url: string;
  title: string;
  uploadDate?: string;     // YYYYMMDD
  viewCount?: number;
  commentCount?: number;
  durationSec?: number;
  channel: string;
}

// yt-dlp flat-playlist 是否带评论数/观看数的关键：用 --flat-playlist 通常不返回，
// 但我们试试用 -J （不加 --flat-playlist）能拿到多少元数据。
async function listVideos(channelUrl: string): Promise<{ entries: VideoEntry[]; error?: string }> {
  const normalized = normalizeChannelUrl(channelUrl);
  const baseArgs = ["--flat-playlist", "-J", "--skip-download"];
  try {
    const stdout = await execFileText(resolveCommand("yt-dlp"), [...baseArgs, normalized]);
    const raw = JSON.parse(stdout);
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    return {
      entries: entries.map((e: any, i: number) => ({
        videoId: e.id || "",
        url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
        title: e.title || "",
        uploadDate: e.upload_date,
        viewCount: e.view_count,
        commentCount: e.comment_count,
        durationSec: e.duration,
        channel: channelUrl,
      })),
    };
  } catch (err) {
    return { entries: [], error: String(err) };
  }
}

interface ProbeResult {
  videoId: string;
  title: string;
  uploadDate?: string;
  viewCount?: number;
  commentCount?: number;
  durationSec?: number;
  channel: string;
  url: string;
  error?: string;
}

async function probeVideo(url: string): Promise<ProbeResult> {
  const baseArgs = ["-J", "--skip-download"];
  try {
    const stdout = await execFileText(resolveCommand("yt-dlp"), [...baseArgs, url]);
    const raw = JSON.parse(stdout);
    return {
      videoId: raw.id || "",
      title: raw.title || "",
      uploadDate: raw.upload_date,
      viewCount: raw.view_count,
      commentCount: raw.comment_count,
      durationSec: raw.duration,
      channel: raw.channel_url || "",
      url,
    };
  } catch (err) {
    return { videoId: "?", title: "PROBE FAILED", url, error: String(err).split("\n")[0] };
  }
}

function daysSince(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;
  const normalized = dateStr.length === 8
    ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
    : dateStr;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return undefined;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

function fmtDate(dateStr: string | undefined): string {
  if (!dateStr) return "无日期";
  if (dateStr.length === 8) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  return dateStr;
}

function fmtNum(n: number | undefined): string {
  return n !== undefined ? n.toLocaleString() : "?";
}

// ══════════════════════════════════════════════════
//  主流程
// ══════════════════════════════════════════════════

async function main() {
  const allEntries: VideoEntry[] = [];

  for (const ch of CHANNELS) {
    process.stdout.write(`\n📡 扫描 ${ch} ... `);
    const { entries, error } = await listVideos(ch);
    if (error) {
      console.log(`❌ 失败: ${error.slice(0, 60)}`);
      continue;
    }
    console.log(`✅ ${entries.length} 个视频`);
    allEntries.push(...entries.map(e => ({ ...e, channel: ch })));
  }

  // 去重
  const seen = new Set<string>();
  const unique = allEntries.filter(e => {
    if (seen.has(e.videoId)) return false;
    seen.add(e.videoId);
    return true;
  });
  console.log(`\n📊 去重后共 ${unique.length} 个视频（${allEntries.length - unique.length} 个跨频道重复）`);

  // 按频道分组显示时间分布
  console.log("\n" + "=".repeat(72));
  console.log("📊 各频道视频日期分布 (flat-playlist)");
  console.log("=".repeat(72));

  for (const ch of CHANNELS) {
    const chVids = unique.filter(e => e.channel === ch);
    if (chVids.length === 0) { console.log(`\n${ch}: (无数据)`); continue; }

    // 统计日期
    const dated = chVids.filter(e => e.uploadDate);
    const undated = chVids.filter(e => !e.uploadDate);
    const ages = dated.map(e => daysSince(e.uploadDate)).filter((a): a is number => a !== undefined);

    const maxAge = ages.length > 0 ? Math.max(...ages) : 0;
    const minAge = ages.length > 0 ? Math.min(...ages) : 0;
    // 按30天窗口统计
    const in30d = ages.filter(a => a <= 30).length;
    const in60d = ages.filter(a => a <= 60).length;
    const in90d = ages.filter(a => a <= 90).length;

    console.log(`\n${ch}`);
    console.log(`  总数: ${chVids.length} | 有日期: ${dated.length} | 无日期: ${undated.length}`);
    console.log(`  日期跨度: ${fmtDate(dated[dated.length - 1]?.uploadDate)} ~ ${fmtDate(dated[0]?.uploadDate)}`);
    console.log(`  距今: 最新 ${Math.round(minAge)} 天前 ~ 最旧 ${Math.round(maxAge)} 天前`);
    console.log(`  在 30d 窗口内: ${in30d} 个`);
    console.log(`  在 60d 窗口内: ${in60d} 个`);
    console.log(`  在 90d 窗口内: ${in90d} 个`);

    // 显示最新的10个视频标题+日期
    const newest = [...chVids].sort((a, b) => (b.uploadDate || "").localeCompare(a.uploadDate || ""));
    console.log(`  最新 10 个视频:`);
    for (const v of newest.slice(0, 10)) {
      const age = daysSince(v.uploadDate);
      const ageStr = age !== undefined ? `${Math.round(age)}天前` : "?";
      console.log(`    [${ageStr}] ${v.title?.slice(0, 60) || "?"}`);
    }
  }

  // ── 2. probe 前 N 个最新视频 ──
  // 按日期排序，取最新的
  const sorted = [...unique].sort((a, b) => (b.uploadDate || "").localeCompare(a.uploadDate || ""));
  // 取最新的25个来 probe（看看它们的真实view_count / comment_count）
  const topN = Math.min(25, sorted.length);
  const toProbe = sorted.slice(0, topN);

  console.log("\n" + "=".repeat(72));
  console.log(`🔬 步骤2: probe 最新 ${topN} 个视频（查看真实观看数/评论数/发布日期）`);
  console.log("=".repeat(72));

  const probeResults: (ProbeResult & { channelShort: string })[] = [];
  for (let i = 0; i < toProbe.length; i++) {
    const v = toProbe[i];
    process.stdout.write(`  [${i + 1}/${topN}] probing ${v.videoId} ... `);
    const p = await probeVideo(v.url);
    const chShort = v.channel.match(/@([^/]+)/)?.[1] || v.channel;
    probeResults.push({ ...p, channelShort: chShort });

    const age = daysSince(p.uploadDate);
    const ageStr = age !== undefined ? `${Math.round(age)}天` : "?";
    const passAge = age === undefined || age <= maxAgeDays;
    const passViews = p.viewCount === undefined || p.viewCount >= minViews;
    const passComments = p.commentCount === undefined || p.commentCount >= minComments;
    const passed = passAge && passViews && passComments;

    console.log(
      `📅 ${fmtDate(p.uploadDate)} (${ageStr}) ` +
      `👁 ${fmtNum(p.viewCount)} ` +
      `💬 ${fmtNum(p.commentCount)} ` +
      `⏱ ${p.durationSec ? Math.round(p.durationSec) + "s" : "?"} ` +
      `${passed ? "✅" : "❌"}`
    );
    if (!passed) {
      const reasons: string[] = [];
      if (!passAge) reasons.push(`时效>${maxAgeDays}d`);
      if (!passViews) reasons.push(`观看<${minViews}`);
      if (!passComments) reasons.push(`评论<${minComments}`);
      console.log(`    原因: ${reasons.join(", ")}`);
    }
    // 延迟500ms
    await new Promise(r => setTimeout(r, 500));
  }

  // ── 汇总统计 ──
  console.log("\n" + "=".repeat(72));
  console.log("📊 过滤效果汇总");
  console.log("=".repeat(72));

  const passAll = probeResults.filter(p => {
    const age = daysSince(p.uploadDate);
    return (age === undefined || age <= maxAgeDays)
      && (p.viewCount === undefined || p.viewCount >= minViews)
      && (p.commentCount === undefined || p.commentCount >= minComments);
  });
  const failAge = probeResults.filter(p => {
    const age = daysSince(p.uploadDate);
    return age !== undefined && age > maxAgeDays;
  });
  const failViews = probeResults.filter(p => {
    return p.viewCount !== undefined && p.viewCount < minViews;
  });
  const failComments = probeResults.filter(p => {
    return p.commentCount !== undefined && p.commentCount < minComments;
  });

  console.log(`  probe 总计: ${probeResults.length} 个`);
  console.log(`  全部通过: ${passAll.length} 个`);
  console.log(`  ❌ 时效淘汰: ${failAge.length} 个`);
  console.log(`  ❌ 观看数淘汰: ${failViews.length} 个`);
  console.log(`  ❌ 评论数淘汰: ${failComments.length} 个`);

  // 检查所有视频中是否有在30天窗口内的
  const allDates = unique.map(e => e.uploadDate).filter(Boolean) as string[];
  allDates.sort().reverse();
  console.log(`\n📈 所有 ${unique.length} 个视频的日期分布:`);
  const in30 = unique.filter(e => {
    const age = daysSince(e.uploadDate);
    return age !== undefined && age <= 30;
  }).length;
  const in60 = unique.filter(e => {
    const age = daysSince(e.uploadDate);
    return age !== undefined && age <= 60;
  }).length;
  const in90 = unique.filter(e => {
    const age = daysSince(e.uploadDate);
    return age !== undefined && age <= 90;
  }).length;
  console.log(`  30天内: ${in30} 个`);
  console.log(`  60天内: ${in60} 个`);
  console.log(`  90天内: ${in90} 个`);

  // ── 建议 ──
  console.log("\n" + "💡 建议");
  console.log("-".repeat(72));
  const latestAge = daysSince(allDates[0]);
  if (latestAge !== undefined && latestAge > 30) {
    console.log(`  这些频道最新视频已是 ${Math.round(latestAge)} 天前，maxAgeDays=30 将杀死全部视频。`);
    console.log(`  → 建议将 maxAgeDays 增大到 ${Math.round(latestAge) + 30} 以上`);
  }
  if (in30 === 0 && in60 > 0) {
    console.log(`  → 建议将 maxAgeDays 改到 60，可覆盖 ${in60} 个视频`);
  }
  if (in60 === 0 && in90 > 0) {
    console.log(`  → 建议将 maxAgeDays 改到 90，可覆盖 ${in90} 个视频`);
  }
  if (failComments.length > 0) {
    const avgComments = probeResults
      .filter(p => p.commentCount !== undefined)
      .map(p => p.commentCount!)
      .reduce((a, b) => a + b, 0) / probeResults.filter(p => p.commentCount !== undefined).length;
    console.log(`  这些视频平均评论数: ${Math.round(avgComments)}`);
    if (avgComments < minComments) {
      console.log(`  → 建议将 minComments 降低到 ${Math.round(avgComments)} 左右`);
    }
  }
}

main().catch(console.error);
