//! Revideo App — Tauri entry point.

mod commands;
mod state;

use state::AppState;
use std::path::PathBuf;
use tracing::info;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "revideo=info,tauri=warn".into()),
        )
        .init();

    info!("Revideo App starting...");

    // Init state BEFORE Tauri builder
    let sidecar_dir = find_sidecar_dir();
    AppState::init(sidecar_dir).await;

    // Launch Tauri
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
}

fn find_sidecar_dir() -> PathBuf {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap().join("sidecar");
    if dev_path.exists() { dev_path } else { PathBuf::from("sidecar") }
}
