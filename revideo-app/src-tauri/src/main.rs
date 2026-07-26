//! Revideo App — Tauri entry point.

mod commands;
mod state;

use state::AppState;
use std::path::PathBuf;
use tracing::info;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

#[tokio::main]
async fn main() {
    // ── Tracing 初始化：同时写 stderr + 滚动日志文件 ──
    let paths = revideo_core::AppPaths::resolve();
    let log_dir = paths.data_dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let file_appender = tracing_appender::rolling::daily(&log_dir, "revideo.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            "revideo=info,tauri=warn".into()
        }))
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .init();

    info!("Revideo App starting...");
    info!("Logs writing to {}", log_dir.display());

    // Init state BEFORE Tauri builder
    let sidecar_dir = find_sidecar_dir();
    AppState::init(sidecar_dir).await;

    // Launch Tauri.
    // `guard` 必须保活到进程退出，否则 non-blocking writer 会在 drop 时丢弃
    // 未刷新的日志。tauri::Builder::run() 是阻塞调用，进程退出前 guard 都在。
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::list_jobs,
            commands::create_job,
            commands::get_job,
            commands::delete_job,
            commands::run_full_pipeline,
            commands::retry_job,
            commands::pause_job,
            commands::resume_job,
            commands::cancel_job,
            commands::get_queue,
            commands::get_job_events,
            commands::probe_url,
            commands::get_settings,
            commands::update_settings,
            commands::get_health,
            commands::ping,
            commands::init_app,
            commands::get_platforms,
            commands::start_sidecar,
            commands::stop_sidecar,
            commands::get_browser_status,
            commands::start_browser,
            commands::stop_browser,
            commands::open_platform_login,
            commands::restart_browser,
            commands::check_platform_login,
            commands::run_step,
            commands::get_discovery_status,
            commands::run_discovery,
            commands::test_translate,
        ])
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("Failed to launch Revideo");

    // 显式 drop guard，确保退出前日志刷新
    drop(guard);
}

fn find_sidecar_dir() -> PathBuf {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap().join("sidecar");
    if dev_path.exists() { dev_path } else { PathBuf::from("sidecar") }
}
