import path from "path";

export const DATA_DIR = path.resolve(process.env.REVIDEO_DATA_DIR || "data");
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const EVENTS_FILE = path.join(DATA_DIR, "events.jsonl");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const BROWSER_DIR = path.join(DATA_DIR, "browser");
export const BROWSER_PROFILE_DIR = path.join(BROWSER_DIR, "profile");

export const SERVER_PORT = Number(process.env.REVIDEO_PORT || 3001);
