export type SourcePlatform =
  | "auto"
  | "youtube"
  | "tiktok"
  | "bilibili"
  | "douyin"
  | "xiaohongshu"
  | "instagram"
  | "x";

export type TargetPlatform =
  | "bilibili"
  | "douyin"
  | "youtube"
  | "tiktok"
  | "xiaohongshu"
  | "instagram"
  | "x";

export type JobStep =
  | "created"
  | "probing-source"
  | "downloading-source"
  | "normalizing-assets"
  | "translating-assets"
  | "moderating-assets"
  | "rendering-video"
  | "generating-platform-drafts"
  | "preflighting-targets"
  | "publishing-targets"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type TargetStatus =
  | "pending"
  | "drafted"
  | "preflighting"
  | "publishing"
  | "published"
  | "failed"
  | "skipped";

export interface WorkflowStepState {
  step: JobStep;
  status: StepStatus;
  percent: number;
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface JobSource {
  platform: SourcePlatform;
  url: string;
  contentId?: string;
  author?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export interface JobTarget {
  platform: TargetPlatform;
  status: TargetStatus;
  draft?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface JobOptions {
  targetLanguage?: string;
  renderTemplate?: string;
  downloadQuality?: "auto" | "best" | "1080p" | "720p" | "480p" | string;
  repeatTimes?: number;
  targetCommentCount?: number;
  translateProvider?: string;
}

export interface JobArtifacts {
  rootDir: string;
  manifestPath: string;
  sourceDir: string;
  derivedDir: string;
  publishDir: string;
  outputVideo?: string;
  coverImage?: string;
}

export interface RevideoJob {
  id: string;
  source: JobSource;
  targets: JobTarget[];
  options: JobOptions;
  workflow: {
    currentStep: JobStep;
    steps: Partial<Record<JobStep, WorkflowStepState>>;
  };
  artifacts: JobArtifacts;
  settingsSnapshot?: unknown;
  requirement?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateJobRequest {
  source: {
    url: string;
    platform?: SourcePlatform;
  };
  targets?: Array<{ platform: TargetPlatform; draft?: Record<string, unknown> }>;
  options?: JobOptions;
  requirement?: string;
}

export interface JobEvent {
  id: string;
  jobId: string;
  ts: number;
  level: "debug" | "info" | "warn" | "error";
  step?: JobStep;
  message: string;
  data?: Record<string, unknown>;
}
