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
  | "generating-cover-image"
  | "generating-platform-drafts"
  | "preflighting-targets"
  | "publishing-targets"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "paused";
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
  renderComments?: boolean;
  bilingualSubtitles?: boolean;
  subtitleMode?: "auto" | "always" | "off" | string;
  commentMode?: "auto" | "always" | "off" | string;
  sensitiveContent?: "preserve" | "soften" | "mark" | "delete" | string;
  styleConstraints?: string[];
  translateProvider?: string;
  outputAspect?: "auto" | "portrait" | "landscape" | "source" | string;
  outputResolution?: "auto" | "1080x1920" | "720x1280" | "1920x1080" | string;
  publishAction?: "draft" | "publish";
  promptOverrides?: {
    subtitle?: string;
    comment?: string;
  };
}

export interface JobArtifacts {
  rootDir: string;
  manifestPath: string;
  sourceDir: string;
  derivedDir: string;
  publishDir: string;
  outputVideo?: string;
  coverImage?: string;
  coverImagePortrait?: string;
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
