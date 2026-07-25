//! Core types for the Revideo job pipeline.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

// ── Job ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevideoJob {
    pub id: String,
    pub source: JobSource,
    pub targets: Vec<TargetPlatform>,
    pub options: JobOptions,
    pub workflow: WorkflowState,
    pub artifacts: Artifacts,
    pub settings_snapshot: RevideoSettings,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSource {
    pub platform: SourcePlatform,
    pub url: String,
    pub metadata: Option<SourceMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub duration_seconds: Option<f64>,
    pub formats: Vec<VideoFormat>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoFormat {
    pub format_id: String,
    pub resolution: Option<String>,
    pub fps: Option<f64>,
    pub codec: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourcePlatform { YouTube, TikTok, Bilibili, Douyin }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TargetPlatform { Bilibili, Douyin, YouTube, TikTok, Xiaohongshu, Instagram, X }

// ── Workflow ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobStep {
    Created, ProbingSource, DownloadingSource, NormalizingAssets,
    TranslatingAssets, ModeratingAssets, GeneratingCoverImage,
    RenderingVideo, GeneratingPlatformDrafts, PreflightingTargets,
    PublishingTargets, Completed,
}

impl JobStep {
    pub fn pipeline_order() -> &'static [JobStep] {
        use JobStep::*;
        &[ProbingSource, DownloadingSource, NormalizingAssets, TranslatingAssets, ModeratingAssets, GeneratingCoverImage, RenderingVideo, GeneratingPlatformDrafts, PreflightingTargets, PublishingTargets]
    }
    pub fn can_skip(&self) -> bool {
        matches!(self, JobStep::TranslatingAssets | JobStep::ModeratingAssets | JobStep::GeneratingCoverImage | JobStep::GeneratingPlatformDrafts)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowState { pub current_step: JobStep, pub steps: HashMap<JobStep, WorkflowStepState> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStepState { pub status: StepStatus, pub percent: u8, pub attempts: u32, pub started_at: Option<DateTime<Utc>>, pub finished_at: Option<DateTime<Utc>>, pub error: Option<String> }

impl WorkflowStepState {
    pub fn pending() -> Self { Self { status: StepStatus::Pending, percent: 0, attempts: 0, started_at: None, finished_at: None, error: None } }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StepStatus { Pending, Running, Completed, Failed, Skipped, Paused }

// ── Job Options ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobOptions {
    pub target_language: String,
    #[serde(default)] pub render_template: Option<String>,
    #[serde(default)] pub download_quality: String,
    #[serde(default)] pub repeat_times: u32,
    #[serde(default)] pub target_comment_count: usize,
    #[serde(default)] pub render_comments: bool,
    #[serde(default)] pub bilingual_subtitles: bool,
    #[serde(default)] pub subtitle_mode: TranslationMode,
    #[serde(default)] pub comment_mode: TranslationMode,
    #[serde(default)] pub sensitive_content: SensitiveContentMode,
    #[serde(default)] pub style_constraints: Option<String>,
    #[serde(default)] pub translate_provider: Option<String>,
    #[serde(default)] pub output_aspect: String,
    #[serde(default)] pub output_resolution: String,
    #[serde(default)] pub publish_action: PublishAction,
    #[serde(default)] pub prompt_overrides: HashMap<String, String>,
}

impl Default for JobOptions {
    fn default() -> Self {
        Self { target_language: "zh-CN".into(), render_template: None, download_quality: "best".into(), repeat_times: 0, target_comment_count: 800, render_comments: false, bilingual_subtitles: false, subtitle_mode: TranslationMode::Auto, comment_mode: TranslationMode::Auto, sensitive_content: Default::default(), style_constraints: None, translate_provider: None, output_aspect: "9:16".into(), output_resolution: "1080x1920".into(), publish_action: Default::default(), prompt_overrides: Default::default() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TranslationMode { #[default] Auto, Always, Off }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SensitiveContentMode { #[default] Preserve, Soften, Mark, Delete }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PublishAction { #[default] Publish, Draft, DryRun }

// ── Artifacts ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Artifacts { pub source: Option<SourceArtifacts>, pub derived: Option<DerivedArtifacts>, #[serde(default)] pub publish: HashMap<TargetPlatform, PublishResult> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceArtifacts { pub media_path: PathBuf, pub metadata_path: PathBuf, pub subtitles_path: PathBuf, pub comments_path: PathBuf }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerivedArtifacts { pub render_path: PathBuf, pub copy_path: PathBuf, pub cover_path: Option<PathBuf>, pub translated_comments_path: Option<PathBuf>, pub translated_subtitles_path: Option<PathBuf> }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishResult { pub platform: TargetPlatform, pub status: PublishStatus, pub url: Option<String>, pub error: Option<String>, pub finished_at: DateTime<Utc> }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PublishStatus { Success, Failed, Cancelled }

// ── Settings ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RevideoSettings { #[serde(default)] pub llm: LlmSettings, #[serde(default)] pub task: TaskSettings, #[serde(default)] pub agent: AgentSettings }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmSettings {
    #[serde(default)] pub provider: String, #[serde(default)] pub api_base: String,
    #[serde(default)] pub api_key: String, #[serde(default)] pub text_model: String,
    #[serde(default)] pub vision_model: String, #[serde(default)] pub temperature: f64,
    #[serde(default)] pub timeout_secs: u64,
}
impl Default for LlmSettings { fn default() -> Self { Self { provider: String::new(), api_base: String::new(), api_key: String::new(), text_model: "gpt-4o".into(), vision_model: String::new(), temperature: 0.3, timeout_secs: 120 } } }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentSettings { #[serde(default)] pub instruction: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSettings {
    #[serde(default)] pub discovery: DiscoverySettings, #[serde(default)] pub download: DownloadSettings,
    #[serde(default)] pub prepare: PrepareSettings, #[serde(default)] pub translation: TranslationSettings,
    #[serde(default)] pub cover: CoverSettings, #[serde(default)] pub render: RenderSettings,
    #[serde(default)] pub publish: PublishSettings,
}
impl Default for TaskSettings { fn default() -> Self { Self { discovery: Default::default(), download: Default::default(), prepare: Default::default(), translation: Default::default(), cover: Default::default(), render: Default::default(), publish: Default::default() } } }

// ── Task sub-settings ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoverySettings {
    #[serde(default)] pub enabled: bool, #[serde(default)] pub run_hour: u8,
    #[serde(default)] pub channels: Vec<String>, #[serde(default)] pub min_views: u64,
    #[serde(default)] pub min_comments: u64, #[serde(default)] pub max_age_days: u32,
    #[serde(default)] pub semantic_filter_prompt: String, #[serde(default)] pub max_duration_sec: u32,
    #[serde(default)] pub repeat_times: u32,
}
impl Default for DiscoverySettings { fn default() -> Self { Self { enabled: false, run_hour: 8, channels: vec![], min_views: 0, min_comments: 0, max_age_days: 7, semantic_filter_prompt: String::new(), max_duration_sec: 600, repeat_times: 0 } } }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadSettings {
    #[serde(default)] pub cookies_path: Option<String>, #[serde(default)] pub js_runtime: Option<String>,
    #[serde(default)] pub video_quality: String, #[serde(default)] pub max_comments: usize,
    #[serde(default)] pub retry_count: u32, #[serde(default)] pub timeout_sec: u64,
    #[serde(default = "default_comment_seconds")] pub comment_seconds: f64,
}
fn default_comment_seconds() -> f64 { 2.0 }
impl Default for DownloadSettings { fn default() -> Self { Self { cookies_path: None, js_runtime: None, video_quality: "best".into(), max_comments: 800, retry_count: 3, timeout_sec: 600, comment_seconds: default_comment_seconds() } } }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrepareSettings {
    #[serde(default)] pub output_aspect: String, #[serde(default)] pub output_resolution: String,
    #[serde(default)] pub fit_mode: FitMode, #[serde(default)] pub subtitle_cleanup: bool,
}
impl Default for PrepareSettings { fn default() -> Self { Self { output_aspect: "9:16".into(), output_resolution: "1080x1920".into(), fit_mode: FitMode::Contain, subtitle_cleanup: true } } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum FitMode { #[default] Contain, Cover, Stretch }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationSettings {
    #[serde(default)] pub target_language: String, #[serde(default)] pub subtitle_mode: TranslationMode,
    #[serde(default)] pub comment_mode: TranslationMode, #[serde(default)] pub bilingual_subtitles: bool,
    #[serde(default)] pub sensitive_content: SensitiveContentMode, #[serde(default)] pub style_constraints: String,
    #[serde(default)] pub subtitle_prompt_override: String, #[serde(default)] pub comment_prompt_override: String,
}
impl Default for TranslationSettings { fn default() -> Self { Self { target_language: "zh-CN".into(), subtitle_mode: TranslationMode::Auto, comment_mode: TranslationMode::Auto, bilingual_subtitles: false, sensitive_content: Default::default(), style_constraints: String::new(), subtitle_prompt_override: String::new(), comment_prompt_override: String::new() } } }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverSettings {
    #[serde(default)] pub template: String, #[serde(default)] pub image_mode: CoverImageMode,
    #[serde(default)] pub fixed_frame_index: Option<u32>, #[serde(default)] pub copy_mode: CoverCopyMode,
    #[serde(default)] pub copy_lines: Vec<String>, #[serde(default)] pub ai_prompt: String,
}
impl Default for CoverSettings { fn default() -> Self { Self { template: String::new(), image_mode: CoverImageMode::Ai, fixed_frame_index: None, copy_mode: CoverCopyMode::None, copy_lines: vec![], ai_prompt: String::new() } } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum CoverImageMode { #[default] Ai, Fixed }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum CoverCopyMode { #[default] None, Fixed, Ai }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderSettings {
    #[serde(default)] pub output_dir: Option<String>, #[serde(default)] pub template: Option<String>,
    #[serde(default)] pub render_comments: bool, #[serde(default)] pub comment_font_size: u32,
    #[serde(default)] pub subtitle_font_size: u32, #[serde(default)] pub hardware_accel: bool,
    #[serde(default)] pub comment_content: CommentContentMode, #[serde(default)] pub repeat_times: u32,
    #[serde(default)] pub output_format: String,
    #[serde(default)] pub comment_line_height: LineHeight,
    #[serde(default)] pub subtitle_line_height: LineHeight,
    #[serde(default)] pub long_comment_behavior: LongCommentBehavior,
}
impl Default for RenderSettings { fn default() -> Self { Self { output_dir: None, template: None, render_comments: false, comment_font_size: 24, subtitle_font_size: 32, hardware_accel: true, comment_content: CommentContentMode::Full, repeat_times: 0, output_format: "mp4".into(), comment_line_height: LineHeight::Standard, subtitle_line_height: LineHeight::Standard, long_comment_behavior: LongCommentBehavior::Wrap } } }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LineHeight { #[default] Compact, Standard, Loose }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LongCommentBehavior { #[default] Wrap, Truncate, Shrink }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum CommentContentMode { #[default] Full, Truncated, Summary }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PublishSettings {
    #[serde(default)] pub max_retries: u32, #[serde(default)] pub retry_delay_secs: u64,
    #[serde(default)] pub platforms: PlatformPublishConfigs,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlatformPublishConfigs {
    #[serde(default)] pub bilibili: PlatformPublishConfig, #[serde(default)] pub douyin: PlatformPublishConfig,
    #[serde(default)] pub xiaohongshu: PlatformPublishConfig, #[serde(default)] pub youtube: PlatformPublishConfig,
    #[serde(default)] pub tiktok: PlatformPublishConfig, #[serde(default)] pub instagram: PlatformPublishConfig,
    #[serde(default)] pub x: PlatformPublishConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformPublishConfig {
    #[serde(default)] pub enabled: bool, #[serde(default)] pub default_action: PublishAction,
    #[serde(default)] pub retry_count: u32,
    #[serde(default)] pub title_prompt: String, #[serde(default)] pub description_prompt: String,
    #[serde(default)] pub tags_prompt: String,
    #[serde(default)] pub extra: serde_json::Value,
}
impl Default for PlatformPublishConfig { fn default() -> Self { Self { enabled: false, default_action: PublishAction::Publish, retry_count: 1, title_prompt: String::new(), description_prompt: String::new(), tags_prompt: String::new(), extra: serde_json::Value::Object(serde_json::Map::new()) } } }

// ── Events ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobEvent { pub id: String, pub job_id: String, pub timestamp: DateTime<Utc>, pub level: EventLevel, pub step: Option<JobStep>, pub message: String, #[serde(skip_serializing_if = "Option::is_none")] pub data: Option<serde_json::Value> }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EventLevel { Info, Warn, Error, Debug }

// ── Create Job Request ───────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct CreateJobRequest { pub url: String, pub platform: Option<SourcePlatform>, #[serde(default)] pub targets: Vec<TargetPlatform>, #[serde(default)] pub options: Option<JobOptions> }

// ── Configuration ────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AppPaths { pub data_dir: PathBuf, pub jobs_dir: PathBuf, pub events_file: PathBuf, pub settings_file: PathBuf, pub browser_dir: PathBuf }

impl AppPaths {
    pub fn resolve() -> Self {
        let data_dir = directories::ProjectDirs::from("com", "revideo", "revideo-app").map(|d| d.data_dir().to_path_buf()).unwrap_or_else(|| PathBuf::from("./data"));
        Self { jobs_dir: data_dir.join("jobs"), events_file: data_dir.join("events.jsonl"), settings_file: data_dir.join("settings.json"), browser_dir: data_dir.join("browser").join("profile"), data_dir }
    }
    pub fn job_dir(&self, id: &str) -> PathBuf { self.jobs_dir.join(id) }
    pub fn job_manifest(&self, id: &str) -> PathBuf { self.job_dir(id).join("manifest.json") }
}
