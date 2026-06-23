import os from "os";
import path from "path";

// Canonical location for all server state (settings, tasks, events, browser
// profile). This is the ONLY data directory — there is no in-tree fallback,
// so settings are always read & written in one place regardless of whether the
// server is launched via pm2, launchd, or `npm run dev`.
//
// Override with REVIDEO_DATA_DIR only for tests or custom installs.
function resolveDataDir(): string {
  const explicit = process.env.REVIDEO_DATA_DIR;
  if (explicit) return path.resolve(explicit);
  return path.join(os.homedir(), ".revideo-server", "data");
}

export const DATA_DIR = resolveDataDir();
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const EVENTS_FILE = path.join(DATA_DIR, "events.jsonl");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const BROWSER_DIR = path.join(DATA_DIR, "browser");
export const BROWSER_PROFILE_DIR = path.join(BROWSER_DIR, "profile");

export const SERVER_PORT = Number(process.env.REVIDEO_PORT || 3001);
