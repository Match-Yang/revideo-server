export type SourcePlatform = "youtube" | "tiktok" | "bilibili" | "douyin";
export type TargetPlatform = "bilibili" | "douyin" | "youtube" | "tiktok" | "xiaohongshu" | "instagram" | "x";
export type JobStep = "probing-source" | "downloading-source" | "normalizing-assets" | "translating-assets" | "moderating-assets" | "generating-cover-image" | "rendering-video" | "generating-platform-drafts" | "preflighting-targets" | "publishing-targets";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "paused";
export type TranslationMode = "auto" | "always" | "off";
export type SensitiveContentMode = "preserve" | "soften" | "mark" | "delete";
export type PublishAction = "publish" | "draft" | "dry-run";
export type FitMode = "contain" | "cover" | "stretch";
export type CoverImageMode = "ai" | "fixed";
export type CoverCopyMode = "none" | "fixed" | "ai";
export type CommentContentMode = "full" | "truncated" | "summary";

export type LineHeight = "compact" | "standard" | "loose";
export type LongCommentBehavior = "wrap" | "truncate" | "shrink";

export interface RevideoJob {
  id: string;
  source: { platform: SourcePlatform; url: string; metadata: { title?: string; author?: string; duration_seconds?: number; formats: { format_id: string; resolution?: string; fps?: number; codec?: string }[]; language?: string } | null };
  targets: TargetPlatform[];
  options: {
    target_language: string; render_template?: string; download_quality: string; repeat_times: number; target_comment_count: number; render_comments: boolean; bilingual_subtitles: boolean;
    subtitle_mode: TranslationMode; comment_mode: TranslationMode; sensitive_content: SensitiveContentMode;
    style_constraints?: string; translate_provider?: string; output_aspect: string; output_resolution: string; publish_action: PublishAction;
    prompt_overrides: Record<string, string>;
  };
  workflow: { current_step: string; steps: Record<string, { status: StepStatus; percent: number; attempts: number; started_at: string | null; finished_at: string | null; error: string | null }> };
  artifacts: { source: { media_path: string; metadata_path: string; subtitles_path: string; comments_path: string } | null; derived: { render_path: string; copy_path: string; cover_path: string | null; translated_comments_path: string | null; translated_subtitles_path: string | null } | null; publish: Record<string, { status: string; url: string | null; error: string | null; finished_at: string }> };
  created_at: string; updated_at: string;
}

export interface RevideoSettings {
  llm: LlmSettings;
  task: TaskSettings;
  agent: { instruction: string };
}
export interface LlmSettings { provider: string; api_base: string; api_key: string; text_model: string; vision_model: string; temperature: number; timeout_secs: number }
export interface TaskSettings {
  discovery: DiscoverySettings; download: DownloadSettings; prepare: PrepareSettings;
  translation: TranslationSettings; cover: CoverSettings; render: RenderSettings; publish: PublishSettings;
}
export interface DiscoverySettings { enabled: boolean; run_hour: number; channels: string[]; min_views: number; min_comments: number; max_age_days: number; semantic_filter_prompt: string; max_duration_sec: number; repeat_times: number }
export interface DownloadSettings { cookies_path?: string; js_runtime?: string; video_quality: string; max_comments: number; retry_count: number; timeout_sec: number; comment_seconds: number }
export interface PrepareSettings { output_aspect: string; output_resolution: string; fit_mode: FitMode; subtitle_cleanup: boolean }
export interface TranslationSettings { target_language: string; subtitle_mode: TranslationMode; comment_mode: TranslationMode; bilingual_subtitles: boolean; sensitive_content: SensitiveContentMode; style_constraints: string; subtitle_prompt_override: string; comment_prompt_override: string }
export interface CoverSettings { template: string; image_mode: CoverImageMode; fixed_frame_index?: number; copy_mode: CoverCopyMode; copy_lines: string[]; ai_prompt: string }
export interface RenderSettings { output_dir?: string; template?: string; render_comments: boolean; comment_font_size: number; subtitle_font_size: number; hardware_accel: boolean; comment_content: CommentContentMode; repeat_times: number; output_format: string; comment_line_height: LineHeight; subtitle_line_height: LineHeight; long_comment_behavior: LongCommentBehavior }
export interface PublishSettings { max_retries: number; retry_delay_secs: number; platforms: PlatformPublishConfigs }
export interface PlatformPublishConfigs { bilibili: PlatformPublishConfig; douyin: PlatformPublishConfig; xiaohongshu: PlatformPublishConfig; youtube: PlatformPublishConfig; tiktok: PlatformPublishConfig; instagram: PlatformPublishConfig; x: PlatformPublishConfig }
export interface PlatformPublishConfig { enabled: boolean; default_action: PublishAction; retry_count: number; title_prompt: string; description_prompt: string; tags_prompt: string; extra: Record<string, unknown> }

export interface CreateJobRequest { url: string; platform?: SourcePlatform; targets?: TargetPlatform[]; options?: Partial<RevideoJob["options"]> }
