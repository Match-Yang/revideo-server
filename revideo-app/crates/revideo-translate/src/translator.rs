//! Batch translation pipeline for comments and subtitles.
//!
//! Splits large lists into manageable batches, sends them to the LLM
//! for translation, and aggregates results.

use crate::client::{ChatMessage, MessageContent, OpenAiClient};
use crate::moderation::{ModerationResult, Moderator};
use revideo_core::{SensitiveContentMode, TranslationMode};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, warn};

#[derive(Error, Debug)]
pub enum TranslateError {
    #[error("Client error: {0}")]
    Client(#[from] crate::client::ClientError),
    #[error("Batch failed after {attempts} attempts: {message}")]
    BatchFailed { attempts: u32, message: String },
}

pub type TranslateResult<T> = Result<T, TranslateError>;

const BATCH_SIZE: usize = 50;
const MAX_RETRIES: u32 = 3;

pub struct Translator {
    client: OpenAiClient,
    moderator: Moderator,
}

/// Input item for translation.
#[derive(Debug, Clone)]
pub struct TranslateItem {
    pub id: String,
    pub text: String,
    pub author: Option<String>,
}

/// Translation output for a single item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslatedItem {
    pub id: String,
    pub original: String,
    pub translated: String,
    pub moderated: Option<String>,
}

/// Batch translation request.
#[derive(Debug, Serialize)]
struct BatchRequest {
    items: Vec<BatchItem>,
}

#[derive(Debug, Serialize)]
struct BatchItem {
    id: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BatchResponse {
    translations: Vec<BatchTranslation>,
}

#[derive(Debug, Deserialize)]
struct BatchTranslation {
    id: String,
    translated: String,
}

// ── System prompts ───────────────────────────────────────────────────

const COMMENT_TRANSLATION_PROMPT: &str = r#"You are a professional translator. Translate the following comments to Chinese.
For each comment, provide the translated version that preserves the original tone and meaning.
Respond with a JSON object: {"translations": [{"id": "...", "translated": "..."}]}"#;

const SUBTITLE_TRANSLATION_PROMPT: &str = r#"You are a professional subtitle translator. Translate the following subtitles to Chinese.
Maintain timing-friendly brevity — each line should be short enough to read quickly.
Preserve the original meaning and conversational tone.
Respond with a JSON object: {"translations": [{"id": "...", "translated": "..."}]}"#;

impl Translator {
    pub fn new(client: OpenAiClient, moderator: Moderator) -> Self {
        Self { client, moderator }
    }

    /// Check if translation is needed based on mode.
    pub fn should_translate(mode: TranslationMode) -> bool {
        matches!(mode, TranslationMode::Always | TranslationMode::Auto)
    }

    /// Translate a batch of comments.
    pub async fn translate_comments(
        &self,
        items: &[TranslateItem],
        target_lang: &str,
    ) -> TranslateResult<Vec<TranslatedItem>> {
        info!("Translating {} comments to {target_lang}", items.len());
        self.translate_batches(items, target_lang, COMMENT_TRANSLATION_PROMPT, 10)
            .await
    }

    /// Translate a batch of subtitles.
    pub async fn translate_subtitles(
        &self,
        items: &[TranslateItem],
        target_lang: &str,
    ) -> TranslateResult<Vec<TranslatedItem>> {
        info!("Translating {} subtitle cues to {target_lang}", items.len());
        // Subtitles use larger batches (100) and higher concurrency
        self.translate_batches(items, target_lang, SUBTITLE_TRANSLATION_PROMPT, 10)
            .await
    }

    /// Run moderation on translated items.
    pub fn moderate(
        &self,
        items: &[TranslatedItem],
        mode: SensitiveContentMode,
    ) -> Vec<(String, ModerationResult)> {
        let texts: Vec<String> = items.iter().map(|i| i.translated.clone()).collect();
        let results = self.moderator.batch_check(&texts, mode);
        items
            .iter()
            .zip(results)
            .map(|(item, result)| (item.id.clone(), result))
            .collect()
    }

    // ── private ──

    async fn translate_batches(
        &self,
        items: &[TranslateItem],
        target_lang: &str,
        system_prompt: &str,
        concurrency: usize,
    ) -> TranslateResult<Vec<TranslatedItem>> {
        let batches: Vec<&[TranslateItem]> = items.chunks(BATCH_SIZE).collect();
        let mut all_results: Vec<TranslatedItem> = Vec::with_capacity(items.len());

        // Process batches with limited concurrency.
        for batch_chunk in batches.chunks(concurrency) {
            let mut tasks = Vec::new();
            for batch in batch_chunk {
                let batch_items: Vec<BatchItem> = batch
                    .iter()
                    .map(|item| BatchItem {
                        id: item.id.clone(),
                        text: item.text.clone(),
                        author: item.author.clone(),
                    })
                    .collect();
                let request = BatchRequest { items: batch_items };
                let messages = build_messages(system_prompt, &request, target_lang);

                let client = &self.client;
                let batch_slice = batch.to_vec();
                tasks.push(async move {
                    translate_batch_with_fallback(client, &messages, &batch_slice, system_prompt, target_lang).await
                });
            }

            let results = futures::future::join_all(tasks).await;
            for result in results {
                match result {
                    Ok(translations) => all_results.extend(translations),
                    Err(e) => warn!("Batch translation failed: {e}"),
                }
            }
        }

        Ok(all_results)
    }
}

fn build_messages(
    system_prompt: &str,
    request: &BatchRequest,
    _target_lang: &str,
) -> Vec<ChatMessage> {
    let user_content = serde_json::to_string_pretty(request).unwrap_or_default();
    vec![
        ChatMessage {
            role: "system".into(),
            content: MessageContent::Text(system_prompt.into()),
        },
        ChatMessage {
            role: "user".into(),
            content: MessageContent::Text(user_content),
        },
    ]
}

/// 翻译一个批次，失败后对半拆分递归重试（移植自 Dashboard 的 splitBatch 逻辑）。
/// 单条仍失败则跳过（返回空），不阻塞整体翻译。
fn translate_batch_with_fallback<'a>(
    client: &'a OpenAiClient,
    messages: &'a [ChatMessage],
    items: &'a [TranslateItem],
    system_prompt: &'a str,
    target_lang: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = TranslateResult<Vec<TranslatedItem>>> + Send + 'a>> {
    Box::pin(async move {
        // 先尝试整批重试 MAX_RETRIES 次
        match translate_with_retry(client, messages).await {
            Ok(results) => Ok(results),
            Err(e) => {
                // 单条无法再拆，跳过
                if items.len() <= 1 {
                    warn!("Single item translation failed, skipping id={}: {e}", items[0].id);
                    return Ok(Vec::new());
                }
                // 对半拆分递归
                warn!("Batch of {} items failed after retries, splitting in half: {e}", items.len());
                let mid = items.len() / 2;
                let (left, right) = items.split_at(mid);

                let left_items: Vec<BatchItem> = left.iter().map(|item| BatchItem {
                    id: item.id.clone(),
                    text: item.text.clone(),
                    author: item.author.clone(),
                }).collect();
                let right_items: Vec<BatchItem> = right.iter().map(|item| BatchItem {
                    id: item.id.clone(),
                    text: item.text.clone(),
                    author: item.author.clone(),
                }).collect();

                let left_msgs = build_messages(system_prompt, &BatchRequest { items: left_items }, target_lang);
                let right_msgs = build_messages(system_prompt, &BatchRequest { items: right_items }, target_lang);

                let left_results = translate_batch_with_fallback(client, &left_msgs, left, system_prompt, target_lang).await?;
                let right_results = translate_batch_with_fallback(client, &right_msgs, right, system_prompt, target_lang).await?;

                Ok([left_results, right_results].concat())
            }
        }
    })
}

async fn translate_with_retry(
    client: &OpenAiClient,
    messages: &[ChatMessage],
) -> TranslateResult<Vec<TranslatedItem>> {
    let mut last_err = String::new();
    for attempt in 1..=MAX_RETRIES {
        match client.chat_json::<BatchResponse>(messages.to_vec(), Some(0.3), None).await {
            Ok(response) => {
                return Ok(response
                    .translations
                    .into_iter()
                    .map(|t| TranslatedItem {
                        id: t.id,
                        original: String::new(), // filled later
                        translated: t.translated,
                        moderated: None,
                    })
                    .collect());
            }
            Err(e) => {
                last_err = e.to_string();
                warn!("Translation attempt {attempt}/{MAX_RETRIES} failed: {last_err}");
                if attempt < MAX_RETRIES {
                    tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(attempt))).await;
                }
            }
        }
    }
    Err(TranslateError::BatchFailed {
        attempts: MAX_RETRIES,
        message: last_err,
    })
}
