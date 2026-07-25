//! Source adapter trait + YouTube and TikTok implementations.
//!
//! Source adapters handle probing (metadata extraction) and downloading
//! (video, subtitles, comments) from source platforms via yt-dlp.

use async_trait::async_trait;
use revideo_core::{JobSource, SourceMetadata, VideoFormat};
use serde::Deserialize;
use std::path::PathBuf;
use thiserror::Error;
use tracing::{info, warn};

#[derive(Error, Debug)]
pub enum SourceError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("yt-dlp error: {0}")]
    YtDlp(String),
    #[error("Parse error: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("Unsupported URL: {0}")]
    UnsupportedUrl(String),
}

pub type SourceResult<T> = Result<T, SourceError>;

/// Download progress callback.
pub type ProgressFn = Box<dyn Fn(String) + Send + Sync>;

/// Trait implemented by each source platform adapter.
#[async_trait]
pub trait SourceAdapter: Send + Sync {
    /// Returns true if this adapter can handle the given URL.
    fn can_handle(&self, url: &str) -> bool;

    /// Extract metadata without downloading the full video.
    async fn probe(&self, url: &str) -> SourceResult<JobSource>;

    /// Download video, subtitles, comments, and metadata to target directory.
    async fn download(
        &self,
        url: &str,
        output_dir: PathBuf,
        quality: &str,
        on_progress: Option<ProgressFn>,
    ) -> SourceResult<DownloadResult>;
}

#[derive(Debug, Clone)]
pub struct DownloadResult {
    pub media_path: PathBuf,
    pub metadata_path: PathBuf,
    pub subtitles_path: PathBuf,
    pub comments_path: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct DownloadOptions {
    pub cookies_path: Option<String>,
    pub js_runtime: Option<String>,
    pub max_comments: usize,
}

// ── yt-dlp helpers ───────────────────────────────────────────────────

/// Find the yt-dlp binary, checking env var and common paths.
pub fn find_ytdlp() -> PathBuf {
    if let Ok(path) = std::env::var("YT_DLP_BIN") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return p;
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.local/bin/yt-dlp"),
        "/usr/local/bin/yt-dlp".into(),
        "/opt/homebrew/bin/yt-dlp".into(),
        "/usr/bin/yt-dlp".into(),
    ];
    for c in &candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("yt-dlp")
}

/// Convert a user-facing quality string to a yt-dlp format selector.
/// "720p" → "bv*[height<=720]+ba/b[height<=720]/best"
/// "best" → "best"
/// "1080p" → "bv*[height<=1080]+ba/b[height<=1080]/best"
fn quality_to_format_selector(quality: &str) -> String {
    if quality == "best" || quality == "auto" {
        return "bv*[height<=720]+ba/b[height<=720]/best".into();
    }
    // Parse "720p" or "1080p" style
    if let Some(h) = quality.trim_end_matches('p').parse::<u32>().ok() {
        return format!("bv*[height<={h}]+ba/b[height<={h}]/best");
    }
    // Fallback: pass through as-is
    quality.to_string()
}

/// Build common yt-dlp args shared by probe and download.
fn common_ytdlp_args(cookies: Option<&str>, js_runtime: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    // Cookies for bot bypass
    if let Some(cookie_path) = cookies {
        if std::path::Path::new(cookie_path).exists() {
            args.push("--cookies".into());
            args.push(cookie_path.into());
            info!("Using cookies from {cookie_path}");
        }
    }

    // JS runtime for YouTube player extraction
    let runtime = js_runtime.unwrap_or("node");
    args.push("--js-runtimes".into());
    args.push(runtime.into());

    args
}

/// Run yt-dlp with given args and return stdout as string.
async fn run_ytdlp(args: &[String]) -> SourceResult<String> {
    let ytdlp = find_ytdlp();
    info!("yt-dlp: {} {}", ytdlp.display(), args.join(" "));
    let output = tokio::process::Command::new(&ytdlp)
        .args(args)
        .output()
        .await
        .map_err(|e| SourceError::YtDlp(format!("Failed to run yt-dlp: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(SourceError::YtDlp(stderr.trim().to_string()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Parse yt-dlp JSON output into SourceMetadata.
fn parse_metadata(raw: &str) -> SourceResult<SourceMetadata> {
    #[derive(Deserialize)]
    struct YtDlpInfo {
        title: Option<String>,
        uploader: Option<String>,
        duration: Option<f64>,
        language: Option<String>,
        formats: Option<Vec<YtDlpFormat>>,
    }

    #[derive(Deserialize)]
    struct YtDlpFormat {
        format_id: String,
        resolution: Option<String>,
        fps: Option<f64>,
        vcodec: Option<String>,
    }

    let info: YtDlpInfo = serde_json::from_str(raw)?;

    Ok(SourceMetadata {
        title: info.title,
        author: info.uploader,
        duration_seconds: info.duration,
        language: info.language,
        formats: info
            .formats
            .unwrap_or_default()
            .into_iter()
            .map(|f| VideoFormat {
                format_id: f.format_id,
                resolution: f.resolution,
                fps: f.fps,
                codec: f.vcodec,
            })
            .collect(),
    })
}

/// Resolve cookies path: settings > env var > default path.
fn resolve_cookies() -> Option<String> {
    // Check env var
    if let Ok(p) = std::env::var("YT_DLP_COOKIES") {
        if std::path::Path::new(&p).exists() {
            return Some(p);
        }
    }
    // Default path
    let home = std::env::var("HOME").unwrap_or_default();
    let default = format!("{home}/Downloads/youtube.com_cookies.txt");
    if std::path::Path::new(&default).exists() {
        return Some(default);
    }
    None
}

// ── YouTube Adapter ──────────────────────────────────────────────────

pub struct YoutubeAdapter;

#[async_trait]
impl SourceAdapter for YoutubeAdapter {
    fn can_handle(&self, url: &str) -> bool {
        url.contains("youtube.com") || url.contains("youtu.be")
    }

    async fn probe(&self, url: &str) -> SourceResult<JobSource> {
        let cookies = resolve_cookies();
        let mut args = common_ytdlp_args(cookies.as_deref(), Some("node"));
        args.extend_from_slice(&[
            "--dump-json".into(),
            "--no-playlist".into(),
            "--no-download".into(),
            url.to_string(),
        ]);

        let raw = run_ytdlp(&args).await?;
        let metadata = parse_metadata(&raw)?;

        Ok(JobSource {
            platform: revideo_core::SourcePlatform::YouTube,
            url: url.to_string(),
            metadata: Some(metadata),
        })
    }

    async fn download(
        &self,
        url: &str,
        output_dir: PathBuf,
        quality: &str,
        _on_progress: Option<ProgressFn>,
    ) -> SourceResult<DownloadResult> {
        tokio::fs::create_dir_all(&output_dir).await?;

        let media_dir = output_dir.join("media");
        let subs_dir = output_dir.join("subtitles");
        let comments_dir = output_dir.join("comments");
        tokio::fs::create_dir_all(&media_dir).await?;
        tokio::fs::create_dir_all(&subs_dir).await?;

        let cookies = resolve_cookies();

        // Pass 1: Download video + info.json + comments
        let media_template = media_dir.join("%(id)s.%(ext)s");
        {
            let mut args = common_ytdlp_args(cookies.as_deref(), Some("node"));
            let format_sel = quality_to_format_selector(quality);
            args.extend_from_slice(&[
                "--format".into(), format_sel,
                "--write-info-json".into(),
                "--write-comments".into(),
                "--extractor-args".into(), "youtube:max_comments=800,800,0,0;comment_sort=top".into(),
                "--no-playlist".into(),
                "--output".into(), media_template.to_string_lossy().to_string(),
                url.to_string(),
            ]);
            run_ytdlp(&args).await?;
        }

        // Pass 2: Download subtitles with fallback order
        let subs_template = subs_dir.join("%(id)s.%(ext)s");
        let sub_lang_groups = [
            "zh-Hans,zh-Hant,zh.*,en.*,en",
            "zh.*,en.*,en",
            "en.*,en",
            "en",
        ];
        let mut subs_ok = false;
        for lang_group in &sub_lang_groups {
            let mut args = common_ytdlp_args(cookies.as_deref(), Some("node"));
            args.extend_from_slice(&[
                "--skip-download".into(),
                "--write-subs".into(),
                "--write-auto-subs".into(),
                "--sub-langs".into(), (*lang_group).to_string(),
                "--convert-subs".into(), "vtt".into(),
                "--no-playlist".into(),
                "--output".into(), subs_template.to_string_lossy().to_string(),
                url.to_string(),
            ]);
            match run_ytdlp(&args).await {
                Ok(_) => { subs_ok = true; break; }
                Err(e) => {
                    warn!("Subtitle download failed for {lang_group}: {e}");
                }
            }
        }
        if !subs_ok {
            warn!("All subtitle language groups failed; continuing without subtitles");
        }

        // Find the actual downloaded files (with retry for fs sync)
        let media_path = find_first_file_retry(&media_dir, &["mp4", "mkv", "webm"], 3)?;
        let metadata_path = find_first_file_retry(&media_dir, &["info.json"], 3)?;

        Ok(DownloadResult {
            media_path,
            metadata_path,
            subtitles_path: subs_dir,
            comments_path: comments_dir,
        })
    }
}

// ── TikTok Adapter ───────────────────────────────────────────────────

pub struct TiktokAdapter;

#[async_trait]
impl SourceAdapter for TiktokAdapter {
    fn can_handle(&self, url: &str) -> bool {
        url.contains("tiktok.com")
    }

    async fn probe(&self, url: &str) -> SourceResult<JobSource> {
        let raw = run_ytdlp(&[
            "--dump-json".into(),
            "--no-playlist".into(),
            "--no-download".into(),
            url.to_string(),
        ])
        .await?;

        let metadata = parse_metadata(&raw)?;

        Ok(JobSource {
            platform: revideo_core::SourcePlatform::TikTok,
            url: url.to_string(),
            metadata: Some(metadata),
        })
    }

    async fn download(
        &self,
        url: &str,
        output_dir: PathBuf,
        quality: &str,
        _on_progress: Option<ProgressFn>,
    ) -> SourceResult<DownloadResult> {
        tokio::fs::create_dir_all(&output_dir).await?;

        let media_dir = output_dir.join("media");
        let subs_dir = output_dir.join("subtitles");
        let comments_dir = output_dir.join("comments");
        tokio::fs::create_dir_all(&media_dir).await?;

        let output_template = media_dir.join("%(title)s.%(ext)s");

        run_ytdlp(&[
            format!("--format"),
            quality.to_string(),
            "--write-info-json".into(),
            "--output".into(),
            output_template.to_string_lossy().to_string(),
            url.to_string(),
        ])
        .await?;

        let media_path = find_first_file(&media_dir, &["mp4", "mkv", "webm"])?;
        let metadata_path = find_first_file(&media_dir, &["info.json"])?;

        Ok(DownloadResult {
            media_path,
            metadata_path,
            subtitles_path: subs_dir,
            comments_path: comments_dir,
        })
    }
}

// ── helpers ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_selector() {
        assert_eq!(quality_to_format_selector("720p"), "bv*[height<=720]+ba/b[height<=720]/best");
        assert_eq!(quality_to_format_selector("1080p"), "bv*[height<=1080]+ba/b[height<=1080]/best");
        assert_eq!(quality_to_format_selector("480p"), "bv*[height<=480]+ba/b[height<=480]/best");
        assert_eq!(quality_to_format_selector("best"), "bv*[height<=720]+ba/b[height<=720]/best");
        assert_eq!(quality_to_format_selector("auto"), "bv*[height<=720]+ba/b[height<=720]/best");
        assert!(quality_to_format_selector("720p").contains("height<=720"));
    }

    #[test]
    fn test_find_ytdlp() {
        let p = find_ytdlp();
        assert!(p.exists(), "yt-dlp not found at {}", p.display());
    }
}

fn find_first_file(dir: &PathBuf, extensions: &[&str]) -> SourceResult<PathBuf> {
    tracing::info!("find_first_file: scanning {} for {:?}", dir.display(), extensions);
    let entries: Vec<_> = match std::fs::read_dir(dir) {
        Ok(iter) => iter.filter_map(|e| e.ok()).collect(),
        Err(e) => {
            tracing::error!("find_first_file: cannot read_dir {}: {e}", dir.display());
            return Err(SourceError::YtDlp(format!("Cannot read directory {}: {e}", dir.display())));
        }
    };
    for entry in &entries {
        let path = entry.path();
        let name = entry.file_name();
        let ext_info = path.extension().map(|e| e.to_string_lossy().to_lowercase());
        tracing::debug!("find_first_file: entry={} ext={:?}", name.to_string_lossy(), ext_info);
        if let Some(ref ext_str) = ext_info {
            // Multi-component extensions like "info.json" need suffix matching
            // because Path::extension() only returns the last component ("json").
            let name_lower = name.to_string_lossy().to_lowercase();
            if extensions.iter().any(|ext| {
                if ext.contains('.') {
                    name_lower.ends_with(&format!(".{ext}"))
                } else {
                    ext_str == *ext
                }
            }) {
                tracing::info!("find_first_file: found {}", path.display());
                return Ok(path);
            }
        }
    }
    tracing::error!(
        "find_first_file: no match among {} entries in {}; tried {:?}",
        entries.len(), dir.display(), extensions
    );
    Err(SourceError::YtDlp(format!(
        "No output file found in {} ({} entries)",
        dir.display(), entries.len()
    )))
}

/// Retry wrapper for find_first_file — yt-dlp may exit before fs buffers flush.
fn find_first_file_retry(dir: &PathBuf, extensions: &[&str], max_retries: u32) -> SourceResult<PathBuf> {
    let mut last_err = None;
    for i in 0..max_retries {
        match find_first_file(dir, extensions) {
            Ok(path) => return Ok(path),
            Err(e) => {
                last_err = Some(e);
                if i + 1 < max_retries {
                    tracing::warn!("find_first_file attempt {}/{} failed, retrying...", i + 1, max_retries);
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
            }
        }
    }
    Err(last_err.unwrap())
}
