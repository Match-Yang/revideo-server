import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import puppeteer, { type Browser } from "puppeteer";
import { BROWSER_PROFILE_DIR } from "../config";

let browserProcess: ChildProcessWithoutNullStreams | null = null;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export interface BrowserStatus {
  installed: boolean;
  running: boolean;
  executablePath?: string;
  cdpUrl: string;
  webSocketDebuggerUrl?: string;
  profileDir: string;
  error?: string;
}

export type BrowserPlatform = "bilibili" | "douyin";

export interface PlatformLoginStatus {
  platform: BrowserPlatform;
  checked: boolean;
  loggedIn: boolean;
  url?: string;
  message: string;
}

const PLATFORM_URLS: Record<BrowserPlatform, { home: string; loginHints: string[] }> = {
  bilibili: {
    home: "https://member.bilibili.com/platform/upload/video/frame",
    loginHints: ["登录", "扫码登录", "密码登录"],
  },
  douyin: {
    home: "https://creator.douyin.com/creator-micro/content/upload",
    loginHints: ["登录", "扫码登录", "验证码"],
  },
};

async function getVersionJson(): Promise<Record<string, unknown> | null> {
  try {
    const resp = await fetch("http://127.0.0.1:9222/json/version");
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function connectRunningBrowser(): Promise<Browser> {
  const status = await startBrowser();
  if (!status.webSocketDebuggerUrl) {
    throw new Error(status.error || "Browser CDP endpoint is not available");
  }
  return puppeteer.connect({
    browserWSEndpoint: status.webSocketDebuggerUrl,
    protocolTimeout: 300000,
  });
}

export async function getBrowserStatus(): Promise<BrowserStatus> {
  let executablePath: string | undefined;
  let installed = false;
  let error: string | undefined;

  try {
    executablePath = puppeteer.executablePath();
    installed = Boolean(executablePath && fs.existsSync(executablePath));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (!installed) {
    const fallback = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
    if (fallback) {
      executablePath = fallback;
      installed = true;
      error = undefined;
    }
  }

  const version = await getVersionJson();
  const webSocketDebuggerUrl =
    typeof version?.webSocketDebuggerUrl === "string" ? version.webSocketDebuggerUrl : undefined;

  return {
    installed,
    running: Boolean(version),
    executablePath,
    cdpUrl: "http://127.0.0.1:9222",
    webSocketDebuggerUrl,
    profileDir: BROWSER_PROFILE_DIR,
    ...(error ? { error } : {}),
  };
}

export async function startBrowser(): Promise<BrowserStatus> {
  const status = await getBrowserStatus();
  if (status.running) return status;
  if (!status.installed || !status.executablePath) {
    return {
      ...status,
      error: status.error || "Chrome/Chromium executable was not found by Puppeteer",
    };
  }

  fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
  browserProcess = spawn(status.executablePath, [
    "--remote-debugging-port=9222",
    `--user-data-dir=${BROWSER_PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
  ]);

  browserProcess.on("exit", () => {
    browserProcess = null;
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const next = await getBrowserStatus();
    if (next.running) return next;
  }

  return {
    ...(await getBrowserStatus()),
    error: "Browser was started but CDP did not become available on port 9222",
  };
}

export async function stopBrowser(): Promise<BrowserStatus> {
  if (browserProcess) {
    browserProcess.kill();
    browserProcess = null;
  }
  return getBrowserStatus();
}

export async function getBrowserHealth() {
  const status = await getBrowserStatus();
  return {
    ...status,
    checks: {
      cdpReachable: status.running,
      profileDirExists: fs.existsSync(BROWSER_PROFILE_DIR),
      bilibiliLoginCheck: status.running ? "available" : "browser-not-running",
      douyinLoginCheck: status.running ? "available" : "browser-not-running",
    },
  };
}

export async function openPlatformLogin(platform: BrowserPlatform): Promise<PlatformLoginStatus> {
  const config = PLATFORM_URLS[platform];
  const browser = await connectRunningBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(config.home, { waitUntil: "domcontentloaded", timeout: 120000 });
    return {
      platform,
      checked: true,
      loggedIn: false,
      url: page.url(),
      message: "Opened platform page. Please log in if required, then run preflight again.",
    };
  } finally {
    await browser.disconnect();
  }
}

export async function checkPlatformLogin(platform: BrowserPlatform): Promise<PlatformLoginStatus> {
  const config = PLATFORM_URLS[platform];
  const browser = await connectRunningBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(config.home, { waitUntil: "domcontentloaded", timeout: 120000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 5000));
    const url = page.url();
    const hasLoginHint = config.loginHints.some((hint) => bodyText.includes(hint));
    const loggedIn = !hasLoginHint && !/login|passport|sso/i.test(url);
    await page.close().catch(() => undefined);
    return {
      platform,
      checked: true,
      loggedIn,
      url,
      message: loggedIn ? "Login appears valid" : "Login is required or could not be confirmed",
    };
  } catch (err) {
    return {
      platform,
      checked: true,
      loggedIn: false,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser.disconnect();
  }
}
