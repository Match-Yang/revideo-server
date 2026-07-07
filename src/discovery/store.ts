import path from "path";
import fs from "fs";
import { DATA_DIR } from "../config";
import type { DiscoveryRunRecord, DiscoveryRunStats } from "./types";

const DISCOVERY_FILE = path.join(DATA_DIR, "discovery.json");

const EMPTY_STATS: DiscoveryRunStats = {
  scanned: 0,
  hardFiltered: 0,
  deduped: 0,
  llmFiltered: 0,
  created: 0,
};

export function loadDiscoveryRecord(): DiscoveryRunRecord | null {
  try {
    const raw = fs.readFileSync(DISCOVERY_FILE, "utf-8");
    return JSON.parse(raw) as DiscoveryRunRecord;
  } catch {
    return null;
  }
}

export function saveDiscoveryRecord(record: DiscoveryRunRecord): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DISCOVERY_FILE, JSON.stringify(record, null, 2), "utf-8");
}

export function emptyStats(): DiscoveryRunStats {
  return { ...EMPTY_STATS };
}

/** 标记为「运行中」并写入。用于手动触发/定时触发时占位，避免重入。 */
export function markRunning(): void {
  saveDiscoveryRecord({
    lastRunAt: new Date().toISOString(),
    lastRunStatus: "running",
    stats: emptyStats(),
    createdJobIds: [],
    errors: [],
  });
}
