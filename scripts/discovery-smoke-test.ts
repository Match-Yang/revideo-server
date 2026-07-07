import { runDiscovery } from "../src/discovery/discover";

(async () => {
  console.log("Running discovery smoke test...");
  console.log("(依赖 settings 里已配置 channels/targets，否则返回空结果)\n");
  const result = await runDiscovery();
  console.log("Stats:", result.stats);
  console.log(`Found ${result.videos.length} new videos`);
  for (const v of result.videos.slice(0, 10)) {
    console.log(
      `  ${v.videoId} | ${v.title} | dur=${v.durationSec}s repeat=${v.repeatTimes} views=${v.viewCount} comments=${v.commentCount}`,
    );
  }
  if (result.errors.length > 0) {
    console.log("\nErrors:");
    for (const e of result.errors) console.log(`  ${e}`);
  }
  console.log("\nDone.");
})();
