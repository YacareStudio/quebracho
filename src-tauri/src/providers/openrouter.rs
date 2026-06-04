use async_trait::async_trait;
use crate::models::{ChatMessage, ChatResponse, ModelInfo, ProviderError};
use crate::providers::Provider;
use serde_json::Value;

pub struct OpenRouterProvider;

#[async_trait]
impl Provider for OpenRouterProvider {
    fn id(&self) -> &'static str {
        "openrouter"
    }

    fn name(&self) -> &'static str {
        "OpenRouter"
    }

    fn hint(&self) -> Option<&'static str> {
        Some("Unified access to many models")
    }

    fn base_url(&self) -> String {
        "https://openrouter.ai/api/v1".to_string()
    }

    fn requires_auth_for_list(&self) -> bool {
        false
    }

    async fn list_models(&self, _api_key: Option<&str>, http: &reqwest::Client) -> Result<Vec<ModelInfo>, ProviderError> {
        let url = "https://openrouter.ai/api/v1/models";
        let resp = http.get(url).send().await?;
        let status = resp.status();
        let body: Value = resp.json().await?;

        if !status.is_success() {
            return Err(ProviderError::Http(format!("openrouter list_models failed: {body}")));
        }

        let models = body
            .get("data")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let id = item.get("id")?.as_str()?;
                        let mut info = ModelInfo::new(id);
                        info.context_length = item.get("context_length").and_then(|v| v.as_u64()).map(|n| n as u32);
                        info.pricing = item.get("pricing").cloned();
                        Some(info)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(models)
    }

    async fn chat_complete(&self, model: &str, api_key: &str, messages: &[ChatMessage], http: &reqwest::Client) -> Result<ChatResponse, ProviderError> {
        let url = format!("{}/chat/completions", self.base_url());
        let body_json = serde_json::json!({
            "model": model,
            "messages": messages,
        });

        let mut req = http.post(&url).json(&body_json);
        if !api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {api_key}"));
        }

        let resp = req.send().await?;
        let status = resp.status();
        let body: Value = resp.json().await?;

        if !status.is_success() {
            return Err(ProviderError::Http(format!("openrouter chat failed: {body}")));
        }

        let content = body
            .get("choices")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|msg| msg.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Ok(ChatResponse {
            content,
            usage: body.get("usage").cloned(),
        })
    }
}
