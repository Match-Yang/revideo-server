//! OpenAI-compatible chat completions API client.
//!
//! Supports both text completions and vision requests. Used by the
//! translation, moderation, and cover-generation pipelines.

use revideo_core::LlmSettings;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, info};

#[derive(Error, Debug)]
pub enum ClientError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error: {status} — {body}")]
    Api { status: u16, body: String },
    #[error("Invalid JSON response: {0}")]
    InvalidResponse(String),
}

pub type ClientResult<T> = Result<T, ClientError>;

/// OpenAI-compatible chat completions client.
pub struct OpenAiClient {
    client: reqwest::Client,
    settings: LlmSettings,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: MessageContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Vision(Vec<VisionPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisionPart {
    #[serde(rename = "type")]
    pub part_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<ImageUrl>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrl {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct ChoiceMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    error: Option<ApiErrorBody>,
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    message: String,
}

impl OpenAiClient {
    pub fn new(settings: LlmSettings) -> Self {
        // 0 视为未设置，回退到默认 120s，避免 reqwest 零超时导致请求立即取消
        let timeout_secs = if settings.timeout_secs == 0 { 120 } else { settings.timeout_secs };
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(timeout_secs))
            .build()
            .expect("Failed to create HTTP client");

        Self { client, settings }
    }

    /// Send a plain text chat completion request. Returns the first choice content.
    pub async fn chat(
        &self,
        messages: Vec<ChatMessage>,
        temperature: Option<f64>,
    ) -> ClientResult<String> {
        let request = ChatRequest {
            model: self.settings.text_model.clone(),
            messages,
            temperature,
            response_format: None,
            max_tokens: None,
        };

        self.send(request).await
    }

    /// Send a chat completion and parse structured JSON from the response.
    pub async fn chat_json<T: for<'de> Deserialize<'de>>(
        &self,
        messages: Vec<ChatMessage>,
        temperature: Option<f64>,
        _json_schema: Option<serde_json::Value>,  // reserved for future use
    ) -> ClientResult<T> {
        let request = ChatRequest {
            model: self.settings.text_model.clone(),
            messages,
            temperature,
            response_format: Some(ResponseFormat {
                format_type: "json_object".into(),
            }),
            // json_object mode is supported by all OpenAI-compatible APIs
            // without requiring a separate json_schema field.
            // 不设 max_tokens — 硬限制会导致大批次翻译被截断，JSON 不完整
            max_tokens: None,
        };

        let raw = self.send(request).await?;
        debug!("Raw JSON response: {raw}");
        // 容错提取：模型可能返回带 markdown fence 或额外文本的 JSON
        let json_str = extract_json(&raw);
        serde_json::from_str(&json_str).map_err(|e| {
            ClientError::InvalidResponse(format!("Failed to parse structured response: {e}"))
        })
    }

    /// Vision request: sends image(s) with a text prompt.
    pub async fn vision(
        &self,
        prompt: &str,
        image_urls: &[String],
    ) -> ClientResult<String> {
        let mut parts: Vec<VisionPart> = Vec::new();
        parts.push(VisionPart {
            part_type: "text".into(),
            text: Some(prompt.to_string()),
            image_url: None,
        });
        for url in image_urls {
            parts.push(VisionPart {
                part_type: "image_url".into(),
                text: None,
                image_url: Some(ImageUrl {
                    url: url.clone(),
                    detail: Some("high".into()),
                }),
            });
        }

        let messages = vec![ChatMessage {
            role: "user".into(),
            content: MessageContent::Vision(parts),
        }];

        let request = ChatRequest {
            model: self.settings.vision_model.clone(),
            messages,
            temperature: Some(0.3),
            response_format: None,
            max_tokens: Some(1024),
        };

        self.send(request).await
    }

    // ── private ──

    async fn send(&self, request: ChatRequest) -> ClientResult<String> {
        let url = format!("{}/chat/completions", self.settings.api_base.trim_end_matches('/'));
        let api_key = &self.settings.api_key;

        info!("LLM request: model={} messages={}", request.model, request.messages.len());

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            let err_msg = serde_json::from_str::<ApiError>(&body)
                .ok()
                .and_then(|e| e.error)
                .map(|e| e.message)
                .unwrap_or_else(|| body.clone());
            return Err(ClientError::Api {
                status: status.as_u16(),
                body: err_msg,
            });
        }

        let chat: ChatResponse =
            serde_json::from_str(&body).map_err(|e| ClientError::InvalidResponse(e.to_string()))?;

        chat.choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .ok_or_else(|| ClientError::InvalidResponse("No content in response".into()))
    }
}

/// 从可能包含 markdown fence 或额外文本的响应中提取 JSON。
/// 移植自 Dashboard 的 `extractJsonPayload`。
fn extract_json(raw: &str) -> String {
    let stripped = raw.trim();
    // 去 markdown code fence (```json ... ``` 或 ``` ... ```)
    let after_prefix = stripped
        .strip_prefix("```json")
        .or_else(|| stripped.strip_prefix("```"))
        .unwrap_or(stripped);
    let stripped = after_prefix.strip_suffix("```").unwrap_or(after_prefix).trim();

    // 如果直接以 { 或 [ 开头，直接返回
    if stripped.starts_with('{') || stripped.starts_with('[') {
        return stripped.to_string();
    }
    // 否则尝试从文本中提取第一个 { 到最后一个 }（对象）
    if let (Some(start), Some(end)) = (stripped.find('{'), stripped.rfind('}')) {
        if end > start {
            return stripped[start..=end].to_string();
        }
    }
    // 或第一个 [ 到最后一个 ]（数组）
    if let (Some(start), Some(end)) = (stripped.find('['), stripped.rfind(']')) {
        if end > start {
            return stripped[start..=end].to_string();
        }
    }
    stripped.to_string()
}
