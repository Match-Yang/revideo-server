import puppeteer, { type Browser, type Page } from "puppeteer";

// ============================================================
// Types
// ============================================================

interface PublishOptions {
  videoPath: string;
  title: string;
  description: string;
  tags?: string[];
  category?: string; // Bilibili分区: 汽车, 科技数码, vlog, 美食, etc.
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
  return puppeteer.connect({ browserWSEndpoint: ws, protocolTimeout: 300000 });
}

async function findOrCreatePage(browser: Browser, urlPattern: string): Promise<Page> {
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes(urlPattern));
  if (!page) {
    page = await browser.newPage();
  }
  return page;
}

async function createFreshPage(browser: Browser, urlPattern: string): Promise<Page> {
  const pages = await browser.pages();
  await Promise.all(
    pages
      .filter((p) => p.url().includes(urlPattern))
      .map((p) => p.close().catch(() => undefined))
  );
  return browser.newPage();
}

async function handleDeclarationModal(page: Page): Promise<boolean> {
  const hasModal = await page.evaluate(() => !!document.querySelector('.semi-modal-content'));
  if (!hasModal) return false;

  // Click the radio input element (not the label) for "内容为个人观点或见解"
  await page.evaluate(() => {
    const labels = document.querySelectorAll('.semi-radioGroup label.semi-radio');
    for (const label of labels) {
      const addon = label.querySelector('.semi-radio-addon');
      if (addon && addon.textContent?.trim() === '内容为个人观点或见解') {
        const input = label.querySelector('input[type="radio"]');
        if (input) (input as HTMLInputElement).click();
        else (label as HTMLElement).click();
        return;
      }
    }
  });

  await sleep(1500);

  // Click confirm button
  const clicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('.semi-modal-content button');
    for (const btn of btns) {
      if (btn.textContent?.trim() === '确定' && !btn.classList.contains('semi-button-disabled')) {
        (btn as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    await sleep(1000);
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.semi-modal-content button');
      for (const btn of btns) {
        if (btn.textContent?.trim() === '确定') {
          (btn as HTMLElement).click();
          break;
        }
      }
    });
  }

  await sleep(1000);
  return true;
}

async function closePopups(page: Page) {
  // Try multiple rounds to close all popups
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => {
      // Check both <button> and other clickable elements (div, span, etc.)
      const allElements = document.querySelectorAll('button, [class*="btn"], [role="button"], div[class*="dialog"] *');
      const clicked = new Set<string>();
      allElements.forEach((el) => {
        const t = el.textContent?.trim();
        if (
          t &&
          ["暂不考虑", "知道了", "禁止", "取消", "同意", "不用了", "继续编辑"].includes(t) &&
          (el as HTMLElement).offsetHeight > 0 &&
          !clicked.has(t)
        ) {
          // Only click "不用了" (not "继续编辑")
          if (t !== '继续编辑') {
            (el as HTMLElement).click();
            clicked.add(t);
          }
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
  // Wait for file input to exist on the page
  await page.waitForSelector('input[type="file"]', { timeout: 30000 });
  await sleep(500);
  // Use the first file input and set files directly
  const fileInput = await page.$('input[type="file"]');
  if (fileInput) {
    await fileInput.uploadFile(filePath);
  }
}

async function queryBilibiliArchive(page: Page, title: string): Promise<Record<string, unknown>> {
  try {
    const pageBvid = await page.evaluate(() => {
      const haystack = [
        window.location.href,
        ...Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href),
        document.body?.innerText || "",
      ].join("\n");
      return haystack.match(/BV[0-9A-Za-z]+/)?.[0] || "";
    });
    const keywords = Array.from(
      new Set([
        pageBvid,
        title,
        title.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim(),
        title.split(/[（(]|#/)[0].trim(),
      ].filter(Boolean))
    );
    let data: unknown = null;
    let rows: Array<any> = [];
    for (let attempt = 0; attempt < 6 && rows.length === 0; attempt += 1) {
      for (const keyword of keywords) {
        data = await page.evaluate(async (kw: string) => {
          const resp = await fetch(
            `/x2/creative/web/archives/sp?pn=1&ps=10&keyword=${encodeURIComponent(kw)}`,
            { credentials: "include" }
          );
          return resp.json();
        }, keyword);
        rows = ((data as any)?.data?.arc_audits || []) as Array<any>;
        if (rows.length > 0) break;
      }
      if (rows.length === 0) await sleep(3000);
    }
    const exact = rows.find((row) => row?.Archive?.title === title) || rows[0];
    const archive = exact?.Archive;
    if (!archive) {
      return pageBvid
        ? { bvid: pageBvid, url: `https://www.bilibili.com/video/${pageBvid}`, raw: data as Record<string, unknown> }
        : { raw: data as Record<string, unknown> };
    }
    const bvid = typeof archive.bvid === "string" && archive.bvid.startsWith("BV") ? archive.bvid : pageBvid;
    return {
      aid: archive.aid,
      bvid,
      url: bvid ? `https://www.bilibili.com/video/${bvid}` : undefined,
      title: archive.title,
      duration: archive.duration,
      state: archive.state,
      desc: archive.desc,
      raw: archive,
    };
  } catch (err) {
    return {
      resultLookupError: err instanceof Error ? err.message : String(err),
    };
  }
}

async function getCurrentBilibiliCategory(page: Page): Promise<string> {
  return page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll(".form-item, .form-group, .upload-form-item, [class*='form-item']"));
    const categoryField = fields.find((field) => field.textContent?.includes("分区"));
    const candidate =
      categoryField?.querySelector(".selector-container, .select-container, [class*='select-controller'], [class*='select-container']") ||
      categoryField;
    if (!(candidate instanceof HTMLElement) || candidate.offsetHeight <= 0) return "";
    return (candidate.textContent || "").replace(/\s+/g, " ").trim().replace(/^分区\s*/, "").trim();
  });
}

// ============================================================
// Bilibili
// ============================================================

async function publishBilibili(
  options: PublishOptions,
  cdpEndpoint: string | undefined,
  onProgress: (p: PublishProgress) => void
): Promise<Record<string, unknown>> {
  const { videoPath, title, description, tags = [] } = options;

  onProgress({ stage: "connecting", percent: 0, message: "正在连接B站..." });
  const browser = await connectBrowser(cdpEndpoint);
  let page: Page | undefined;

  try {
    page = await createFreshPage(browser, "bilibili");

    onProgress({ stage: "navigating", percent: 5, message: "正在打开B站投稿页..." });
    await page.goto("https://member.bilibili.com/platform/upload/video/frame", {
      waitUntil: "domcontentloaded",
      timeout: 180000
    });
    await page.waitForSelector('input[type="file"], input.input-val[placeholder*="标题"]', {
      timeout: 60000,
    });
    await sleep(3000);

    // Close any popups BEFORE uploading (e.g. "继续编辑/不用了" dialog)
    await closePopups(page);
    await sleep(1000);

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
          )?.set;
          setter?.call(el, val);
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
        (el: Element, text: string) => {
          (el as HTMLElement).focus();
          document.execCommand("selectAll", false, undefined);
          document.execCommand("insertText", false, text);
        },
        descEditor,
        description
      );
    }

    // Select category (分区) — must come before tags & topics, as it determines recommendations
    if (options.category) {
      onProgress({ stage: "filling", percent: 50, message: `正在设置分区: ${options.category}...` });
      try {
        let currentCategory = await getCurrentBilibiliCategory(page);
        if (currentCategory.includes(options.category)) {
          console.log(`[Category] Current category confirmed: ${currentCategory}`);
        } else {
          const clickedContainer = await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll("span, div, label"));
            const label = labels.find((el) => el.textContent?.trim() === "分区");
            const field =
              label?.closest(".form-item, .form-group, .upload-form-item, [class*='form']") ||
              label?.parentElement?.parentElement ||
              null;
            const container =
              field?.querySelector(".select-container, [class*='select-container'], [class*='select-box']") ||
              null;
            if (container instanceof HTMLElement) {
              container.click();
              return true;
            }
            const visibleSelects = Array.from(document.querySelectorAll(".select-container, [class*='select-container'], [class*='select']"))
              .filter((item): item is HTMLElement => item instanceof HTMLElement && item.offsetHeight > 0);
            const candidate =
              visibleSelects.find((item) => item.textContent?.includes("分区")) ||
              visibleSelects.find((item) => item.textContent?.includes("请选择")) ||
              visibleSelects.find((item) => item.textContent?.includes("vlog")) ||
              visibleSelects[visibleSelects.length - 1];
            candidate?.click();
            return Boolean(candidate);
          });
          if (clickedContainer) {
            await sleep(1000);
            const clicked = await page.evaluate((targetCategory: string) => {
              const items = document.querySelectorAll('.drop-list-v2-item, .bcc-option, [class*="option"], [class*="drop-list"] [title], [role="option"]');
              for (const item of items) {
                const title = item.getAttribute('title') || item.textContent?.trim();
                if (title === targetCategory || title?.includes(targetCategory)) {
                  (item as HTMLElement).click();
                  return true;
                }
              }
              return false;
            }, options.category);
            await sleep(1000);
            currentCategory = await getCurrentBilibiliCategory(page);
            if (currentCategory.includes(options.category)) {
              console.log(`[Category] Category confirmed: ${currentCategory}`);
            } else if (!clicked) {
              console.log(`[Category] "${options.category}" not found in dropdown, current=${currentCategory || "unknown"}, keeping default`);
            }
          } else {
            currentCategory = await getCurrentBilibiliCategory(page);
            console.log(`[Category] Category dropdown not found, current=${currentCategory || "unknown"}, keeping default`);
          }
        }
      } catch (e) {
        console.error('[Category] Failed to set category:', e);
      }
    }

    // Clear existing tags, then add new ones
    // B站 tag DOM: .tag-pre-wrp > .label-item-v2-container > svg.close.icon-sprite
    if (tags.length > 0) {
      onProgress({ stage: "filling", percent: 55, message: "正在设置标签..." });
      console.log(`[Tag] Starting to fill ${tags.length} tags: ${JSON.stringify(tags)}`);

      // Remove existing tags one by one (clicking all at once causes missed clicks)
      for (;;) {
        const removed = await page.evaluate(() => {
          const item = Array.from(document.querySelectorAll('.tag-pre-wrp .label-item-v2-container'))
            .find(el => (el as HTMLElement).offsetHeight > 0);
          if (!item) return false;
          const closeBtn = item.querySelector('svg.close');
          if (closeBtn) closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        });
        if (!removed) break;
        await sleep(200);
      }

      // Find the visible tag input
      const tagInput = await page.evaluateHandle(() => {
        return Array.from(document.querySelectorAll('input.input-val[placeholder*="创建标签"]'))
          .find(el => (el as HTMLElement).offsetHeight > 0) || null;
      });
      console.log(`[Tag] tagInput found: ${!!(tagInput && tagInput.asElement())}`);

      if (tagInput && tagInput.asElement()) {
        const inputEl = tagInput.asElement()!;
        for (const tag of tags) {
          await page.evaluate((el: HTMLInputElement, val: string) => {
            el.focus();
            el.value = '';
            document.execCommand('selectAll', false, undefined);
            document.execCommand('insertText', false, val);
            el.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
            el.dispatchEvent(new KeyboardEvent('keyup', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
          }, inputEl, tag);
          await sleep(500);

          const verify = await page.evaluate(() => {
            const items = document.querySelectorAll('.tag-pre-wrp .label-item-v2-container');
            return Array.from(items).map((t: Element) => t.textContent!.trim());
          });
          console.log(`[Tag] Added "${tag}", current tags: ${JSON.stringify(verify)}`);
        }
      } else {
        console.log('[Tag] WARNING: Tag input not found, skipping tag fill');
      }
    }

    // Select the first recommended topic
    try {
      const topicSelected = await page.evaluate(() => {
        const items = document.querySelectorAll('.tag-topic-list .hot-tag-container');
        if (items.length === 0) return false;
        const alreadySelected = Array.from(items).some(el => el.classList.contains('hot-tag-container-selected'));
        if (alreadySelected) return true;
        (items[0] as HTMLElement).click();
        return true;
      });
      if (topicSelected) console.log('[Topic] Selected first recommended topic');
    } catch (e) {
      console.log('[Topic] Could not select topic:', (e as Error).message);
    }

    // Upload cover image (required by Bilibili)
    onProgress({ stage: "filling", percent: 60, message: "正在上传封面..." });
    try {
      const { execSync } = require('child_process');
      const path = require('path');
      const fs = require('fs');
      let coverPath = videoPath.replace(/\.mp4$/, '-cover.jpg');
      // Also try removing -cut suffix (e.g. video-cut.mp4 → video-cover.jpg)
      if (!fs.existsSync(coverPath)) {
        const baseCover = videoPath.replace(/-cut\.mp4$/, '-cover.jpg');
        if (baseCover !== coverPath && fs.existsSync(baseCover)) coverPath = baseCover;
      }
      // If cover doesn't exist next to video, try extracting from video
      if (!fs.existsSync(coverPath)) {
        const tmpCover = path.join(require('os').tmpdir(), `bili-cover-${Date.now()}.jpg`);
        // Use -ss BEFORE -i to seek fast without full decode, limit resolution to save memory
        try {
          execSync(`ffmpeg -nostdin -y -ss 2 -i "${videoPath}" -frames:v 1 -vf "scale=640:-1" -q:v 2 "${tmpCover}"`, { stdio: 'ignore', maxBuffer: 1024 * 1024 });
          if (fs.existsSync(tmpCover)) coverPath = tmpCover;
        } catch(e) {
          console.log('[Cover] ffmpeg failed, B站 will use auto-generated cover');
        }
      }
      if (fs.existsSync(coverPath)) {
        console.log('[Cover] Using cover:', coverPath);
        // Wait for cover area to load — B站 may still be processing the video
        const editBtn = await page.waitForSelector('.edit-text', { timeout: 30000 }).catch(() => null);
        if (editBtn) {
          console.log('[Cover] Clicking 封面设置...');
          await editBtn.click();

          // Wait for cover dialog to appear with retry
          let dialogOpened = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await page.waitForFunction(
                () => !!document.querySelector('input[type="file"][accept*="image"]'),
                { timeout: 10000 }
              );
              dialogOpened = true;
              console.log(`[Cover] Dialog opened on attempt ${attempt + 1}`);
              break;
            } catch {
              console.log(`[Cover] Dialog not opened on attempt ${attempt + 1}, retrying...`);
              // Close any blocking popups and retry
              await page.keyboard.press("Escape");
              await sleep(500);
              await editBtn.click();
              await sleep(2000);
            }
          }

          if (!dialogOpened) {
            console.log('[Cover] Dialog failed to open after 3 attempts');
          }

          // 勾选"双比例同步改动"checkbox
          await page.evaluate(() => {
            const checkbox = document.querySelector('.bcc-checkbox-checkbox');
            if (checkbox) {
              const input = checkbox.querySelector('input[type="checkbox"]');
              if (input instanceof HTMLInputElement && !input.checked) {
                (checkbox as HTMLElement).click();
              }
            }
          });
          await sleep(500);

          // Upload cover image
          const coverInputs = await page.$$('input[type="file"][accept*="image"]');
          console.log('[Cover] Image file inputs found:', coverInputs.length);
          if (coverInputs.length > 0) {
            await coverInputs[0].uploadFile(coverPath);
            console.log('[Cover] Uploaded cover via file input');
            onProgress({ stage: "filling", percent: 62, message: "封面上传中..." });
            // Wait for cover image to load in editor (blob preview appears)
            await page.waitForFunction(
              () => {
                const imgs = document.querySelectorAll('.cover-editor img, .cover-crop-container img, [class*="cover-editor"] img');
                return Array.from(imgs).some(i => {
                  const src = (i as HTMLImageElement).src;
                  return src.startsWith('blob:') && (i as HTMLImageElement).naturalWidth > 0;
                });
              },
              { timeout: 30000 }
            ).catch(() => {});
            await sleep(5000);
          } else {
            console.log('[Cover] No image file input found, cannot upload cover');
          }

          // Click "完成" to confirm cover
          const confirmResult = await page.evaluate(() => {
            const submitBtn = document.querySelector('.cover-editor-button .button.submit');
            if (submitBtn) { (submitBtn as HTMLElement).click(); return 'clicked submit'; }
            const fallback = Array.from(document.querySelectorAll('span, button, div'))
              .find(el => el.textContent?.trim() === '完成' && (el as HTMLElement).offsetHeight > 0);
            if (fallback) { (fallback as HTMLElement).click(); return 'clicked fallback'; }
            return 'not found';
          });
          console.log('[Cover] Close dialog:', confirmResult);

          // Wait for dialog close and cover to be applied to form
          await page.waitForFunction(
            () => {
              const coverImg = document.querySelector('.cover-img');
              if (!coverImg) return false;
              const bg = window.getComputedStyle(coverImg).backgroundImage;
              return bg && bg !== 'none' && bg.includes('http');
            },
            { timeout: 15000 }
          ).then(() => {
            console.log('[Cover] Cover confirmed on form');
          }).catch(() => {
            console.log('[Cover] Could not confirm cover on form, proceeding anyway');
          });
        } else {
          console.log('[Cover] No 封面设置 button found after 30s, B站 will use auto-generated cover');
        }
      } else {
        console.log('[Cover] No cover image found, B站 will use auto-generated cover');
      }
    } catch (e) {
      console.error('Cover upload failed:', e);
    }

    await sleep(1000);

    // Submit - click the submit button
    onProgress({ stage: "submitting", percent: 65, message: "正在提交投稿..." });
    await page.evaluate(() => {
      const btn = document.querySelector("span.submit-add");
      if (btn) (btn as HTMLElement).click();
    });

    // Poll for submit result: handle both quick submit and slow upload scenarios.
    // For large videos, B站 shows "等待视频上传完后会自动提交，请勿关闭当前页面"
    // after clicking submit — we must wait until upload finishes and "稿件投递成功" appears.
    onProgress({ stage: "submitting", percent: 75, message: "等待投稿确认..." });
    const SUBMIT_POLL_INTERVAL = 5000;
    const submitStart = Date.now();

    while (true) {
      const state = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        if (bodyText.includes("稿件投递成功")) return "success" as const;
        if (bodyText.includes("等待视频上传完后会自动提交")) return "uploading" as const;
        if (bodyText.includes("视频上传中") || bodyText.includes("正在上传")) return "uploading" as const;
        // Detect error tips that block submission
        const errorTips = ["至少填写一个标签", "请选择分区", "请填写标题", "请上传封面"];
        for (const tip of errorTips) {
          if (bodyText.includes(tip)) return ("error:" + tip) as const;
        }
        return "unknown" as const;
      });

      const elapsed = Math.round((Date.now() - submitStart) / 1000);
      console.log(`[Submit] [${elapsed}s] state=${state}`);

      if (state === "success") {
        console.log(`[Submit] 稿件投递成功 after ${elapsed}s`);
        break;
      }

      if (state.startsWith("error:")) {
        const errorMsg = state.slice(6);
        console.error(`[Submit] B站投稿失败: ${errorMsg}`);
        throw new Error(`B站投稿失败: ${errorMsg}`);
      }

      if (state === "uploading") {
        onProgress({ stage: "submitting", percent: 75, message: `视频上传中，等待完成... (${elapsed}s)` });
      }

      await sleep(SUBMIT_POLL_INTERVAL);
    }

    // Loop exits only when "稿件投递成功" is detected

    // Disable beforeunload handler to prevent "确定要离开吗" dialog on disconnect
    await page.evaluate(() => {
      window.onbeforeunload = null;
    });

    const result = await queryBilibiliArchive(page, title);
    await sleep(2000);
    onProgress({ stage: "done-bilibili", percent: 50, message: "✅ B站投稿成功！" });
    return result;
  } catch (e) {
    // Disable beforeunload before disconnect to avoid dialog
    try { await page?.evaluate(() => { window.onbeforeunload = null; }); } catch (e2) {}
    throw e;
  } finally {
    try { await page?.evaluate(() => { window.onbeforeunload = null; }); } catch (e) {}
    try { await browser.disconnect(); } catch (e) {}
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
          )?.set;
          setter?.call(el, val);
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
        (el: Element, text: string) => {
          (el as HTMLElement).focus();
          document.execCommand("selectAll", false, undefined);
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

    // Click publish & loop: keep handling declaration modal until redirect
    onProgress({ stage: "submitting", percent: 85, message: "正在发布..." });
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.evaluate(() => {
        document.querySelectorAll("button").forEach((b) => {
          if (b.textContent.trim() === "发布") {
            (b as HTMLButtonElement).click();
          }
        });
      });

      // Wait for either redirect or modal
      const redirected = await Promise.race([
        page.waitForFunction(
          () => window.location.href.includes("enter_from=publish"),
          { timeout: 10000 }
        ).then(async () => {
          // Avoid false positive: publish_page contains "publish" but isn't success
          const url = page.url();
          if (url.includes("enter_from=publish_page")) return false;
          return true;
        }).catch(() => false),
        sleep(3000).then(() => false),
      ]);

      if (redirected) break;

      const modalHandled = await handleDeclarationModal(page);
      if (modalHandled) {
        onProgress({ stage: "submitting", percent: 85 + attempt, message: `声明已确认，重新提交发布 (${attempt + 1})...` });
        await sleep(1000);
      } else {
        // No redirect and no modal — might need more time, retry
        await sleep(2000);
      }
    }

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
  bilibili?: { title: string; description: string; tags?: string[]; category?: string };
  douyin?: { title: string; description: string };
  cdpEndpoint?: string;
}

export async function publish(
  req: PublishRequest,
  onProgress: (p: PublishProgress) => void
) {
  const { videoPath, cdpEndpoint } = req;

  // Validate video file
  const fs = await import("fs");
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频文件不存在: ${videoPath}`);
  }

  // Detect platforms from provided configs
  const platforms: ("bilibili" | "douyin")[] = [];
  if (req.bilibili) platforms.push("bilibili");
  if (req.douyin) platforms.push("douyin");

  if (platforms.length === 0) {
    throw new Error("请至少提供 bilibili 或 douyin 的发布配置");
  }

  const results: Record<string, { success: boolean; error?: string; [key: string]: unknown }> = {};

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
          category: req.bilibili?.category,
        };
        const result = await publishBilibili(opts, cdpEndpoint, (p) =>
          onProgress({
            ...p,
            percent: basePercent + (p.percent / platforms.length),
          })
        );
        results.bilibili = { success: true, ...result };
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
