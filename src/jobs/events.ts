import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { EVENTS_FILE } from "../config";
import type { JobEvent } from "./types";

function ensureEventFile(): void {
  const dir = path.dirname(EVENTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, "");
}

export function appendJobEvent(event: Omit<JobEvent, "id" | "ts">): JobEvent {
  ensureEventFile();
  const fullEvent: JobEvent = {
    ...event,
    id: randomUUID(),
    ts: Date.now(),
  };
  fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(fullEvent)}\n`);
  return fullEvent;
}

export function getJobEvents(jobId: string): JobEvent[] {
  ensureEventFile();
  return fs
    .readFileSync(EVENTS_FILE, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JobEvent)
    .filter((event) => event.jobId === jobId)
    .sort((a, b) => a.ts - b.ts);
}
