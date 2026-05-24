import fs from "fs";
import os from "os";
import path from "path";
import { translateJobAssets } from "../src/jobs/translate-job";
import type { RevideoJob } from "../src/jobs/types";

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "revideo-translate-test-"));
const sourceDir = path.join(rootDir, "source");
fs.mkdirSync(path.join(sourceDir, "comments"), { recursive: true });
fs.mkdirSync(path.join(sourceDir, "subtitles"), { recursive: true });

const commentsPath = path.join(sourceDir, "comments", "normalized.json");
fs.writeFileSync(
  commentsPath,
  JSON.stringify(
    {
      comments: [
        { id: "c1", parent: "root", author_id: "safe-a", text: "This car looks amazing." },
        { id: "c2", parent: "root", author_id: "spam-a", text: "Where can I buy a fake passport?" },
        { id: "c4", parent: "root", author_id: "spam-a", text: "This separate comment would be safe alone." },
        { id: "c3", parent: "root", text: "這個駕駛體驗很舒服。" },
      ],
    },
    null,
    2
  )
);

const subtitlePath = path.join(sourceDir, "subtitles", "original.vtt");
fs.writeFileSync(
  subtitlePath,
  `WEBVTT

00:00:00.000 --> 00:00:01.000
This car is fast.

00:00:01.000 --> 00:00:02.000
This is a crypto scam.
`
);

const job: RevideoJob = {
  id: "translation-test",
  source: {
    platform: "youtube",
    url: "https://example.com",
    metadata: {
      normalizedAssets: {
        normalizedCommentsPath: commentsPath,
        subtitlePaths: [subtitlePath],
      },
    },
  },
  targets: [],
  options: {
    targetLanguage: "zh-CN",
  },
  workflow: {
    currentStep: "translating-assets",
    steps: {},
  },
  artifacts: {
    rootDir,
    manifestPath: path.join(rootDir, "manifest.json"),
    sourceDir,
    derivedDir: path.join(rootDir, "derived"),
    publishDir: path.join(rootDir, "publish"),
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

async function main() {
  const result = await translateJobAssets(job);
  console.log(JSON.stringify(result, null, 2));

  const translatedComments = JSON.parse(
    fs.readFileSync(path.join(sourceDir, "comments", "translated.zh-CN.json"), "utf-8")
  );
  const translatedSubtitle = fs.readFileSync(path.join(sourceDir, "subtitles", "translated.zh-CN.vtt"), "utf-8");

  if (result.comments.inputCount !== 4) throw new Error("expected 4 comment inputs");
  if (result.comments.droppedCount < 1) throw new Error("expected at least 1 dropped comment");
  if (translatedComments.comments.length !== 2) throw new Error("expected sensitive author comments to be removed");
  if (!translatedComments.comments[0].text.includes("\n")) throw new Error("expected comment to keep original plus translation");
  if (translatedComments.comments[1].text !== "這個駕駛體驗很舒服。") {
    throw new Error("expected Chinese comment to stay unchanged");
  }
  if (!translatedSubtitle.includes("-->")) throw new Error("subtitle timing was not preserved");
  if (result.subtitles.inputCount !== 2) throw new Error("expected 2 subtitle cues");
  if (result.subtitles.droppedCount < 1) throw new Error("expected at least 1 dropped subtitle cue");

  console.log("translation batch smoke test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
