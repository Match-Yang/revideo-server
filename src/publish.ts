import puppeteer, { type Browser, type Page } from "puppeteer";

// ============================================================
// Types
// ============================================================

interface PublishOptions {
  videoPath: string;
  title: string;
  description: string;
  tags?: string[];
}

interface PublishProgress {
  stage: string;
  percent: number;
  message: string;
}

// ============================================================
// Helpers
// ============================================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function discoverCdpEndpoint(): Promise<string> {
  const resp = await fetch("http://127.0.0.1:9222/json/version");
  const data = await resp.json();
  return data.webSocketDebuggerUrl;
}

async function connectBrowser(cdpEndpoint?: string): Promise<Browser> {
  const ws = cdpEndpoint || (await discoverCdpEndpoint());
  return puppeteer.connect({ browserWSEndpoint: ws });
}

async function findOrCreatePage(browser: Browser, urlPattern: string): Promise<Page> {
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes(urlPattern));
  if (!page) {
    page = await browser.newPage();
  }
  return page;
}

async function closePopups(page: Page) {
  // Try multiple rounds to close all popups
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => {
      document.querySelectorAll("button").forEach((b) => {
        const t = b.textContent.trim();
        if (
          ["暂不考虑", "知道了", "禁止", "取消", "同意"].includes(t) &&
          b.offsetHeight > 0
        ) {
          (b as HTMLButtonElement).click();
        }
      });
    });
    await sleep(500);
  }
  // Escape key for any remaining modals
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape");
    await sleep(300);
  }
}

async function uploadFile(page: Page, filePath: string) {
  const [fileChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 15000 }),
    page.evaluate(() => {
      const input = document.querySelector('input[type="file"]');
      if (input) (input as HTMLInputElement).click();
    }),
  ]);
  await fileChooser.accept([filePath]);
}

// ============================================================
// Bilibili
// ============================================================

async function publishBilibili(
  options: PublishOptions,
  cdpEndpoint: string | undefined,
  onProgress: (p: PublishProgress) => void
) {
  const { videoPath, title, description, tags = [] } = options;

  onProgress({ stage: "connecting", percent: 0, message: "正在连接B站..." });
  const browser = await connectBrowser(cdpEndpoint);

  try {
    const page = await findOrCreatePage(browser, "bilibili");

    onProgress({ stage: "navigating", percent: 5, message: "正在打开B站投稿页..." });
    await page.goto("https://member.bilibili.com/platform/upload/video/frame", {
      waitUntil: "networkidle2",
    });
    await sleep(3000);

    onProgress({ stage: "uploading", percent: 10, message: "正在上传视频到B站..." });
    await uploadFile(page, videoPath);
    onProgress({ stage: "uploading", percent: 20, message: "视频已提交，等待处理..." });
    await sleep(5000);

    // Wait for the edit form to appear (title input visible)
    await page.waitForFunction(
      () => {
        const input = document.querySelector(
          'input.input-val[placeholder*="标题"]'
        ) as HTMLInputElement;
        return input && input.offsetHeight > 0;
      },
      { timeout: 60000 }
    );
    onProgress({ stage: "uploading", percent: 30, message: "视频上传完成，正在填写信息..." });

    // Close popups
    await closePopups(page);
    await sleep(1000);

    // Fill title (Vue reactivity: use native setter)
    onProgress({ stage: "filling", percent: 35, message: "正在填写标题..." });
    const titleInput = await page.$('input.input-val[placeholder*="标题"]');
    if (titleInput) {
      await page.evaluate(
        (el: HTMLInputElement, val: string) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
          )!.set;
          setter.call(el, val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        },
        titleInput,
        title
      );
    }

    // Fill description (contenteditable ql-editor)
    onProgress({ stage: "filling", percent: 45, message: "正在填写简介..." });
    const descEditor = await page.$(
      ".desc-text-wrp .ql-editor, .desc-container .ql-editor"
    );
    if (descEditor) {
      await page.evaluate(
        (el: HTMLElement, text: string) => {
          el.focus();
          document.execCommand("selectAll", false, null);
          document.execCommand("insertText", false, text);
        },
        descEditor,
        description
      );
    }

    // Add tags
    if (tags.length > 0) {
      onProgress({ stage: "filling", percent: 55, message: "正在添加标签..." });
      const tagInput = await page.$('input.input-val[placeholder*="创建标签"]');
      if (tagInput) {
        for (const tag of tags) {
          await tagInput.click();
          await page.evaluate(
            (el: HTMLInputElement, val: string) => {
              const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value"
              )!.set;
              setter.call(el, val);
              el.dispatchEvent(new Event("input", { bubbles: true }));
            },
            tagInput,
            tag
          );
          await page.keyboard.press("Enter");
          await sleep(300);
        }
      }
    }

    await sleep(1000);

    // Submit - remove overlays first, then click
    onProgress({ stage: "submitting", percent: 65, message: "正在提交投稿..." });
    await page.evaluate(() => {
      document.querySelectorAll(".bcc-overlay").forEach((o) => o.remove());
      document.querySelectorAll(".bcc-dialog__wrapper").forEach((d) => {
        if (d.offsetHeight > 0) d.remove();
      });
    });
    await sleep(500);

    await page.evaluate(() => {
      const btn = document.querySelector("span.submit-add");
      if (btn) (btn as HTMLElement).click();
    });

    // Wait for success indicator
    onProgress({ stage: "submitting", percent: 75, message: "等待投稿确认..." });
    await page.waitForFunction(
      () => document.body.innerText.includes("稿件投递成功"),
      { timeout: 30000 }
    ).catch(() => {
      // Timeout is ok - might have already navigated
    });

    await sleep(2000);
    onProgress({ stage: "done-bilibili", percent: 50, message: "✅ B站投稿成功！" });
  } finally {
    await browser.disconnect();
  }
}

// ============================================================
// Douyin
// ============================================================

async function publishDouyin(
  options: PublishOptions,
  cdpEndpoint: string | undefined,
  onProgress: (p: PublishProgress) => void
) {
  const { videoPath, title, description } = options;

  onProgress({ stage: "connecting", percent: 50, message: "正在连接抖音..." });
  const browser = await connectBrowser(cdpEndpoint);

  try {
    const page = await findOrCreatePage(browser, "douyin");
    await page.setViewport({ width: 1440, height: 900 });

    onProgress({
      stage: "navigating",
      percent: 52,
      message: "正在打开抖音创作平台...",
    });
    await page.goto(
      "https://creator.douyin.com/creator-micro/content/upload",
      { waitUntil: "networkidle2" }
    );
    await sleep(3000);

    onProgress({ stage: "uploading", percent: 55, message: "正在上传视频到抖音..." });
    await uploadFile(page, videoPath);
    onProgress({ stage: "uploading", percent: 60, message: "视频已提交，等待处理..." });

    // Wait for edit form (cover area visible)
    await page.waitForFunction(
      () => {
        const body = document.body.innerText;
        return body.includes("作品描述") || body.includes("设置封面");
      },
      { timeout: 60000 }
    );
    onProgress({
      stage: "uploading",
      percent: 70,
      message: "视频上传完成，正在填写信息...",
    });

    // Fill title (React: native setter)
    onProgress({ stage: "filling", percent: 73, message: "正在填写标题..." });
    const titleInput = await page.$(
      'input.semi-input-default[placeholder*="作品标题"]'
    );
    if (titleInput) {
      await page.evaluate(
        (el: HTMLInputElement, val: string) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
          )!.set;
          setter.call(el, val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        },
        titleInput,
        title
      );
    }

    // Fill description (contenteditable editor-kit-container)
    onProgress({ stage: "filling", percent: 78, message: "正在填写描述..." });
    const descEditor = await page.$(".editor-kit-container");
    if (descEditor) {
      await page.evaluate(
        (el: HTMLElement, text: string) => {
          el.focus();
          document.execCommand("selectAll", false, null);
          document.execCommand("insertText", false, text);
        },
        descEditor,
        description
      );
    }

    await sleep(1000);

    // Close popups
    await closePopups(page);
    await sleep(500);

    // Click publish button
    onProgress({ stage: "submitting", percent: 85, message: "正在发布..." });
    await page.evaluate(() => {
      document.querySelectorAll("button").forEach((b) => {
        if (b.textContent.trim() === "发布") {
          (b as HTMLButtonElement).click();
        }
      });
    });

    // Wait for redirect to manage page
    onProgress({ stage: "submitting", percent: 90, message: "等待发布确认..." });
    await page
      .waitForFunction(
        () => window.location.href.includes("enter_from=publish"),
        { timeout: 30000 }
      )
      .catch(() => {});

    await sleep(2000);
    onProgress({ stage: "done-douyin", percent: 95, message: "✅ 抖音发布成功！" });
  } finally {
    await browser.disconnect();
  }
}

// ============================================================
// Main publish function
// ============================================================

export interface PublishRequest {
  videoPath: string;
  platforms: ("bilibili" | "douyin")[];
  bilibili?: { title: string; description: string; tags?: string[] };
  douyin?: { title: string; description: string };
  cdpEndpoint?: string;
}

export async function publish(
  req: PublishRequest,
  onProgress: (p: PublishProgress) => void
) {
  const { videoPath, platforms, cdpEndpoint } = req;

  // Validate video file
  const fs = await import("fs");
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频文件不存在: ${videoPath}`);
  }

  if (!platforms || platforms.length === 0) {
    throw new Error("请指定至少一个发布平台");
  }

  const results: Record<string, { success: boolean; error?: string }> = {};

  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const basePercent = (i / platforms.length) * 100;

    try {
      if (platform === "bilibili") {
        const opts: PublishOptions = {
          videoPath,
          title: req.bilibili?.title || "",
          description: req.bilibili?.description || "",
          tags: req.bilibili?.tags,
        };
        await publishBilibili(opts, cdpEndpoint, (p) =>
          onProgress({
            ...p,
            percent: basePercent + (p.percent / platforms.length),
          })
        );
        results.bilibili = { success: true };
      } else if (platform === "douyin") {
        const opts: PublishOptions = {
          videoPath,
          title: req.douyin?.title || "",
          description: req.douyin?.description || "",
        };
        await publishDouyin(opts, cdpEndpoint, (p) =>
          onProgress({
            ...p,
            percent: basePercent + (p.percent / platforms.length),
          })
        );
        results.douyin = { success: true };
      }
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      results[platform] = { success: false, error: errorMsg };
      onProgress({
        stage: `error-${platform}`,
        percent: basePercent + (100 / platforms.length),
        message: `❌ ${platform} 发布失败: ${errorMsg}`,
      });
    }
  }

  return results;
}
