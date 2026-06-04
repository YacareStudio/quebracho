use async_trait::async_trait;
use crate::models::{ChatMessage, ChatResponse, ModelInfo, ProviderError, StreamChunk};
use crate::providers::Provider;
use futures::Stream;
use serde_json::Value;

pub struct AnthropicProvider;

#[async_trait]
impl Provider for AnthropicProvider {
    fn id(&self) -> &'static str {
        "anthropic"
    }

    fn name(&self) -> &'static str {
        "Anthropic"
    }

    fn base_url(&self) -> &str {
        "https://api.anthropic.com"
    }

    fn requires_auth_for_list(&self) -> bool {
        false
    }

    async fn list_models(&self, _api_key: Option<&str>, _http: &reqwest::Client) -> Result<Vec<ModelInfo>, ProviderError> {
        Ok(vec![
            ModelInfo::new("claude-3-5-sonnet-latest"),
            ModelInfo::new("claude-3-5-haiku-latest"),
        ])
    }

    async fn chat_complete(&self, model: &str, api_key: &str, messages: &[ChatMessage], http: &reqwest::Client) -> Result<ChatResponse, ProviderError> {
        let url = format!("{}/v1/messages", self.base_url());

        let user_messages: Vec<Value> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| {
                serde_json::json!({
                    "role": if m.role == "assistant" { "assistant" } else { "user" },
                    "content": m.content
                })
            })
            .collect();

        let system_message = messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.clone())
            .unwrap_or_default();

        let mut body = serde_json::json!({
            "model": model,
            "messages": user_messages,
            "max_tokens": 4096,
        });

        if !system_message.is_empty() {
            body["system"] = serde_json::json!(system_message);
        }

        let resp = http
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let body: Value = resp.json().await?;

        if !status.is_success() {
            return Err(ProviderError::Http(format!("anthropic chat failed: {body}")));
        }

        let content = body
            .get("content")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Ok(ChatResponse {
            content,
            usage: body.get("usage").cloned(),
        })
    }

    async fn chat_stream(
        &self,
        model: &str,
        api_key: &str,
        messages: &[ChatMessage],
        http: &reqwest::Client,
    ) -> Result<std::pin::Pin<Box<dyn Stream<Item = Result<StreamChunk, ProviderError>> + Send>>, ProviderError> {
        let url = format!("{}/v1/messages", self.base_url());

        let user_messages: Vec<Value> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| {
                serde_json::json!({
                    "role": if m.role == "assistant" { "assistant" } else { "user" },
                    "content": m.content
                })
            })
            .collect();

        let system_message = messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.clone())
            .unwrap_or_default();

        let mut body = serde_json::json!({
            "model": model,
            "messages": user_messages,
            "max_tokens": 4096,
            "stream": true,
        });

        if !system_message.is_empty() {
            body["system"] = serde_json::json!(system_message);
        }

        let resp = http
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Accept", "text/event-stream")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body: Value = resp.json().await.unwrap_or_default();
            return Err(ProviderError::Http(format!("anthropic chat_stream failed: {body}")));
        }

        let byte_stream = resp.bytes_stream();
        let stream = crate::providers::sse_parse_stream(byte_stream, |json| {
            // Anthropic format: delta.text
            json.get("delta")
                .and_then(|delta| delta.get("text"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });
        Ok(Box::pin(stream))
    }
}
