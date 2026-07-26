//! Node.js sidecar lifecycle manager.
//!
//! Manages a Node.js child process that runs Puppeteer for browser automation
//! publishing. Communicates via HTTP on a local random port.

use rand::Rng;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use thiserror::Error;
use tokio::process::{Child, Command};
use tracing::{info, warn};

#[derive(Error, Debug)]
pub enum SidecarError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Sidecar not running")]
    NotRunning,
    #[error("Health check failed after {attempts} attempts")]
    HealthCheckFailed { attempts: u32 },
    #[error("Invalid port: {0}")]
    InvalidPort(String),
}

pub type SidecarResult<T> = Result<T, SidecarError>;

const HEALTH_CHECK_INTERVAL_MS: u64 = 500;
const HEALTH_CHECK_MAX_ATTEMPTS: u32 = 40; // 20s total
const PORT_RANGE_START: u16 = 12000;
const PORT_RANGE_END: u16 = 12999;

/// Manages the lifecycle of the Node.js Puppeteer sidecar.
pub struct SidecarManager {
    child: Option<Child>,
    port: u16,
    cdp_port: u16,
    base_url: String,
    sidecar_dir: PathBuf,
    browser_profile_dir: PathBuf,
}

impl SidecarManager {
    /// Create a new manager pointing at the sidecar directory.
    pub fn new(sidecar_dir: PathBuf) -> Self {
        let port = find_available_port();
        let cdp_port = find_available_port_in_range(19222, 19299);
        let browser_profile_dir = sidecar_dir.join("browser-profile");
        Self {
            child: None,
            port,
            cdp_port,
            base_url: format!("http://127.0.0.1:{port}"),
            sidecar_dir,
            browser_profile_dir,
        }
    }

    /// Get the CDP port for the persistent browser.
    pub fn cdp_port(&self) -> u16 {
        self.cdp_port
    }

    /// Get the browser WebSocket endpoint (available after sidecar starts).
    pub fn browser_ws_endpoint(&self) -> String {
        format!("http://127.0.0.1:{}", self.cdp_port)
    }

    /// Get the base URL for communicating with the sidecar.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Start the sidecar process and wait for it to become healthy.
    pub async fn start(&mut self) -> SidecarResult<()> {
        if self.child.is_some() {
            warn!("Sidecar already running");
            return Ok(());
        }

        info!(
            "Starting Node.js sidecar in {} on port {}",
            self.sidecar_dir.display(),
            self.port
        );

        // Install dependencies if needed
        let node_modules = self.sidecar_dir.join("node_modules");
        if !node_modules.exists() {
            info!("Installing sidecar dependencies...");
            let status = Command::new("npm")
                .arg("install")
                .current_dir(&self.sidecar_dir)
                .status()
                .await?;
            if !status.success() {
                return Err(SidecarError::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "npm install failed",
                )));
            }
        }

        let mut child = Command::new("node")
            .arg("server.js")
            .env("PORT", self.port.to_string())
            .env("CDP_PORT", self.cdp_port.to_string())
            .env("BROWSER_PROFILE_DIR", self.browser_profile_dir.to_string_lossy().to_string())
            .current_dir(&self.sidecar_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        // 转发 sidecar stdout/stderr 到 tracing，避免日志被吞
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    info!("[sidecar] {line}");
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    warn!("[sidecar] {line}");
                }
            });
        }

        self.child = Some(child);

        // Wait for health check
        self.wait_for_healthy(HEALTH_CHECK_MAX_ATTEMPTS).await?;

        info!("Sidecar healthy at {}", self.base_url);
        Ok(())
    }

    /// Check if the sidecar is healthy (with short timeout).
    pub async fn health_check(&self) -> bool {
        let url = format!("{}/health", self.base_url);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .unwrap_or_default();
        match client.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    /// Gracefully stop the sidecar.
    pub async fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            info!("Stopping sidecar...");
            let _ = child.kill().await;
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            info!("Sidecar stopped");
        }
    }

    /// Restart the sidecar (stop + start).
    pub async fn restart(&mut self) -> SidecarResult<()> {
        self.stop().await;
        self.port = find_available_port();
        self.cdp_port = find_available_port_in_range(19222, 19299);
        self.base_url = format!("http://127.0.0.1:{}", self.port);
        self.start().await
    }

    // ── private ──

    async fn wait_for_healthy(&self, max_attempts: u32) -> SidecarResult<()> {
        for attempt in 1..=max_attempts {
            if self.health_check().await {
                return Ok(());
            }
            if attempt == 1 {
                info!("Waiting for sidecar to become healthy...");
            }
            tokio::time::sleep(Duration::from_millis(HEALTH_CHECK_INTERVAL_MS)).await;
        }
        Err(SidecarError::HealthCheckFailed {
            attempts: max_attempts,
        })
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        // Best-effort: child is killed_on_drop, so the process will be
        // terminated when this struct is dropped.
    }
}

/// Find an available TCP port in the configured range.
fn find_available_port() -> u16 {
    let mut rng = rand::thread_rng();
    for _ in 0..100 {
        let port = rng.gen_range(PORT_RANGE_START..PORT_RANGE_END);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    // Fallback — let OS assign
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr().map(|a| a.port()))
        .unwrap_or(12000)
}

/// Find an available TCP port in a specific range (for CDP).
fn find_available_port_in_range(start: u16, end: u16) -> u16 {
    let mut rng = rand::thread_rng();
    for _ in 0..50 {
        let port = rng.gen_range(start..end);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    // Fallback
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr().map(|a| a.port()))
        .unwrap_or(start)
}
