//! Shared application state — stored in a OnceLock for access from commands.
//! Avoids Tauri's manage/state mechanism which has race conditions with Arc.

use revideo_core::{AppPaths, EventLog, JobQueue, JobStore, SettingsStore};
use revideo_platforms::PlatformRegistry;
use revideo_sidecar::SidecarManager;
use revideo_translate::{Moderator, OpenAiClient, Translator};
use std::path::PathBuf;
use std::sync::{Mutex as StdMutex, OnceLock};
use tauri::AppHandle;
use tokio::sync::Mutex;
use tracing::{info, warn};

pub struct AppState {
    pub paths: AppPaths,
    pub job_store: JobStore,
    pub event_log: EventLog,
    pub settings: Mutex<SettingsStore>,
    pub platforms: PlatformRegistry,
    pub translator: Mutex<Option<Translator>>,
    pub sidecar: Mutex<SidecarManager>,
    pub queue: JobQueue,
    pub app_handle: StdMutex<Option<AppHandle>>,
}

static STATE: OnceLock<AppState> = OnceLock::new();

impl AppState {
    pub async fn init(sidecar_dir: PathBuf) {
        let paths = AppPaths::resolve();
        let _ = std::fs::create_dir_all(&paths.data_dir);
        let _ = std::fs::create_dir_all(&paths.jobs_dir);

        let mut settings_store = SettingsStore::load(&paths).unwrap_or_else(|e| {
            warn!("Failed to load settings, using defaults: {e}");
            SettingsStore::load_or_default(&paths)
        });

        // 修正历史脏数据：timeout_secs=0 会导致 reqwest 零超时，请求立即取消
        if settings_store.get().llm.timeout_secs == 0 {
            warn!("llm.timeout_secs is 0, resetting to 120 to avoid zero-timeout");
            let mut fixed = settings_store.get().clone();
            fixed.llm.timeout_secs = 120;
            if let Err(e) = settings_store.update(serde_json::to_value(&fixed).unwrap()) {
                warn!("Failed to persist timeout_secs fix: {e}");
            }
        }

        let llm_settings = settings_store.get().llm.clone();
        let translator = if !llm_settings.api_key.is_empty() && !llm_settings.api_base.is_empty() {
            let client = OpenAiClient::new(llm_settings.clone());
            let moderator = Moderator::new();
            info!("LLM client initialized with model {}", llm_settings.text_model);
            Some(Translator::new(client, moderator))
        } else {
            info!("No LLM configured — translation and moderation disabled");
            None
        };

        let app = Self {
            job_store: JobStore::new(paths.clone()),
            event_log: EventLog::new(paths.clone()),
            paths,
            settings: Mutex::new(settings_store),
            platforms: PlatformRegistry::new(),
            translator: Mutex::new(translator),
            sidecar: Mutex::new(SidecarManager::new(sidecar_dir)),
            queue: JobQueue::new(),
            app_handle: StdMutex::new(None),
        };

        assert!(STATE.set(app).is_ok(), "AppState already initialized");
    }

    pub fn get() -> &'static Self {
        STATE.get().expect("AppState not initialized")
    }
}
