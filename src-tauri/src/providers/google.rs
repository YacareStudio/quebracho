use async_trait::async_trait;
use crate::models::{ChatMessage, ChatResponse, ModelInfo, ProviderError};
use crate::providers::Provider;
use serde_json::Value;

pub struct GoogleProvider;

#[async_trait]
impl Provider for GoogleProvider {
    fn id(&self) -> &'static str {
        "google"
    }

    fn name(&self) -> &'static str {
        "Google Gemini"
    }

    fn base_url(&self) -> &str {
        "https://generativelanguage.googleapis.com"
    }

    fn requires_auth_for_list(&self) -> bool {
        true
    }

    async fn list_models(&self, api_key: Option<&str>, http: &reqwest::Client) -> Result<Vec<ModelInfo>, ProviderError> {
        let key = api_key.ok_or(ProviderError::Auth)?;
        let url = format!("{}/v1beta/models?key={}", self.base_url(), key);

        let resp = http.get(&url).send().await?;
        let status = resp.status();
        let body: Value = resp.json().await?;

        if !status.is_success() {
            return Err(ProviderError::Http(format!("google list_models failed: {body}")));
        }

        let models = body
            .get("models")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let name = item.get("name")?.as_str()?;
                        let id = name.strip_prefix("models/").unwrap_or(name);
                        Some(ModelInfo::new(id))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(models)
    }

    async fn chat_complete(&self, model: &str, api_key: &str, messages: &[ChatMessage], http: &reqwest::Client) -> Result<ChatResponse, ProviderError> {
        let url = format!("{}/v1beta/models/{}:generateContent?key={}", self.base_url(), model, api_key);

        let contents: Vec<Value> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| {
                serde_json::json!({
                    "role": if m.role == "assistant" { "model" } else { "user" },
                    "parts": [{ "text": m.content }]
                })
            })
            .collect();

        let resp = http
            .post(&url)
            .json(&serde_json::json!({ "contents": contents }))
            .send()
            .await?;

        let status = resp.status();
        let body: Value = resp.json().await?;

        if !status.is_success() {
            return Err(ProviderError::Http(format!("google chat failed: {body}")));
        }

        let content = body
            .get("candidates")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|p| p.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Ok(ChatResponse {
            content,
            usage: body.get("usageMetadata").cloned(),
        })
    }
}
