import "dotenv/config";
import { loadJob, saveJob, setJobStep } from "../src/jobs/store";
import { translateSubtitles } from "../src/jobs/translate-job";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) throw new Error("Usage: tsx scripts/regenerate-job-subtitles.ts <jobId>");

  const job = loadJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const targetLanguage = job.options.targetLanguage || "zh-CN";
  const subtitles = await translateSubtitles(job, targetLanguage);
  const latest = loadJob(jobId) || job;
  latest.source.metadata = {
    ...(latest.source.metadata || {}),
    translation: {
      ...((latest.source.metadata?.translation as Record<string, unknown>) || {}),
      subtitles,
    },
  };
  saveJob(latest);
  setJobStep(jobId, "translating-assets", "completed", { percent: 100 });
  console.log(JSON.stringify(subtitles, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
