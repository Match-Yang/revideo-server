//! Tauri IPC bindings — wraps invoke calls with type-safe helpers.

import { invoke } from "@tauri-apps/api/core";
import type { RevideoJob, RevideoSettings, CreateJobRequest } from "./types";

// ── Jobs ──

export async function listJobs(): Promise<RevideoJob[]> {
  return invoke<RevideoJob[]>("list_jobs");
}

export async function createJob(request: CreateJobRequest): Promise<RevideoJob> {
  return invoke<RevideoJob>("create_job", { request });
}

export async function getJob(id: string): Promise<RevideoJob> {
  return invoke<RevideoJob>("get_job", { id });
}

export async function deleteJob(id: string): Promise<void> {
  return invoke<void>("delete_job", { id });
}

export async function runFullPipeline(id: string): Promise<QueuedRun> {
  return invoke<QueuedRun>("run_full_pipeline", { id });
}

export async function cancelJob(id: string): Promise<void> {
  return invoke<void>("cancel_job", { id });
}

export async function ping(): Promise<string> {
  return invoke<string>("ping");
}

export async function initApp(): Promise<string> {
  return invoke<string>("init_app");
}

// ── Settings ──

export async function getSettings(): Promise<RevideoSettings> {
  return invoke<RevideoSettings>("get_settings");
}

export async function updateSettings(partial: Record<string, unknown>): Promise<RevideoSettings> {
  return invoke<RevideoSettings>("update_settings", { partial });
}

// ── Health ──

export interface HealthStatus {
  healthy: boolean;
  ffmpeg_available: boolean;
  ytdlp_available: boolean;
  sidecar_running: boolean;
  llm_configured: boolean;
}

export async function getHealth(): Promise<HealthStatus> {
  return invoke<HealthStatus>("get_health");
}

// ── Sidecar ──

export async function startSidecar(): Promise<void> {
  return invoke<void>("start_sidecar");
}

export async function stopSidecar(): Promise<void> {
  return invoke<void>("stop_sidecar");
}

// ── Queue ──

export interface QueuedRun {
  id: string;
  job_id: string;
  steps: string[];
  force: boolean;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface QueueSnapshot {
  active: QueuedRun | null;
  queued: QueuedRun[];
  history: QueuedRun[];
}

export async function getQueue(): Promise<QueueSnapshot> {
  return invoke<QueueSnapshot>("get_queue");
}

export async function retryJob(id: string): Promise<QueuedRun> {
  return invoke<QueuedRun>("retry_job", { id });
}

export async function pauseJob(id: string): Promise<string[]> {
  return invoke<string[]>("pause_job", { id });
}

export async function resumeJob(id: string): Promise<QueuedRun> {
  return invoke<QueuedRun>("resume_job", { id });
}

// ── Events ──

export interface JobEvent {
  id: string;
  job_id: string;
  timestamp: string;
  level: string;
  step: string | null;
  message: string;
  data?: unknown;
}

export async function getJobEvents(id: string): Promise<JobEvent[]> {
  return invoke<JobEvent[]>("get_job_events", { id });
}

// ── Probe ──

export async function probeUrl(url: string): Promise<RevideoJob> {
  return invoke<RevideoJob>("probe_url", { url });
}

// ── Browser ──

export interface BrowserStatus {
  running: boolean;
  cdp_port: number;
  profile_dir: string;
}

export async function getBrowserStatus(): Promise<BrowserStatus> {
  return invoke<BrowserStatus>("get_browser_status");
}

export async function startBrowser(): Promise<void> {
  return invoke<void>("start_browser");
}

export async function stopBrowser(): Promise<void> {
  return invoke<void>("stop_browser");
}

export async function openPlatformLogin(platform: string): Promise<void> {
  return invoke<void>("open_platform_login", { platform });
}

// ── Translate test ──

export async function testTranslate(text: string): Promise<string> {
  return invoke<string>("test_translate", { text });
}

// ── Discovery ──

export interface DiscoveryStatus {
  last_run_at: string | null;
  last_status: string;
  stats: Record<string, number>;
  errors: string[];
}

export async function getDiscoveryStatus(): Promise<DiscoveryStatus> {
  return invoke<DiscoveryStatus>("get_discovery_status");
}

export async function runDiscovery(): Promise<string> {
  return invoke<string>("run_discovery");
}

// ── Browser extras ──

export async function restartBrowser(): Promise<void> {
  return invoke<void>("restart_browser");
}

export async function checkPlatformLogin(platform: string): Promise<{ logged_in: boolean }> {
  return invoke<{ logged_in: boolean }>("check_platform_login", { platform });
}

// ── Platforms ──

export interface PlatformInfo {
  source: string[];
  target: string[];
}

export async function getPlatforms(): Promise<PlatformInfo> {
  return invoke<PlatformInfo>("get_platforms");
}
