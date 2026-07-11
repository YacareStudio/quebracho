use crate::models::{ChatMessage, ChatResponse, ModelInfo, ProviderError};
use crate::providers::Provider;
use async_trait::async_trait;
use serde_json::Value;

pub struct OllamaProvider {
    base_url: std::sync::Mutex<String>,
}

impl Default for OllamaProvider {
    fn default() -> Self {
        Self {
            base_url: std::sync::Mutex::new("http://localhost:11434".to_string()),
        }
    }
}

#[async_trait]
impl Provider for OllamaProvider {
    fn id(&self) -> &'static str {
        "ollama"
    }

    fn name(&self) -> &'static str {
        "Ollama"
    }

    fn hint(&self) -> Option<&'static str> {
        Some("Local models via Ollama")
    }

    fn base_url(&self) -> String {
        self.base_url.lock().unwrap().clone()
    }

    fn set_base_url(&self, url: String) {
        if let Ok(mut guard) = self.base_url.lock() {
            *guard = url;
        }
    }

    fn requires_auth_for_list(&self) -> bool {
        false
    }

    async fn list_models(
        &self,
        _api_key: Option<&str>,
        http: &reqwest::Client,
    ) -> Result<Vec<ModelInfo>, ProviderError> {
        let url = format!("{}/api/tags", self.base_url());
        let resp = match http.get(&url).send().await {
            Ok(r) => r,
            Err(e) if e.is_connect() => {
                return Ok(vec![]);
            }
            Err(e) => return Err(ProviderError::Http(e.to_string())),
        };

        let status = resp.status();
        let body: Value = resp.json().await?;

        if !status.is_success() {
            return Ok(vec![]);
        }

        let models = body
            .get("models")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let name = item.get("name")?.as_str()?;
                        Some(ModelInfo::new(name))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if models.is_empty() {
            return Ok(static_fallback());
        }

        Ok(models)
    }

    async fn chat_complete(
        &self,
        model: &str,
        _api_key: &str,
        messages: &[ChatMessage],
        http: &reqwest::Client,
    ) -> Result<ChatResponse, ProviderError> {
        let url = format!("{}/api/chat", self.base_url());

        let msgs: Vec<Value> = messages
            .iter()
            .map(|m| {
                serde_json::json!({
                    "role": m.role,
                    "content": m.content
                })
            })
            .collect();

        let resp = http
            .post(&url)
            .json(&serde_json::json!({
                "model": model,
                "messages": msgs,
                "stream": false
            }))
            .send()
            .await?;

        let status = resp.status();
        let body: Value = resp.json().await?;

        if !status.is_success() {
            return Err(ProviderError::Http(format!("ollama chat failed: {body}")));
        }

        let content = body
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Ok(ChatResponse {
            content,
            usage: body.get("prompt_eval_count").cloned(),
        })
    }
}

fn static_fallback() -> Vec<ModelInfo> {
    vec![
        ModelInfo::new("llama3.2"),
        ModelInfo::new("qwen2.5-coder"),
        ModelInfo::new("deepseek-coder-v2"),
        ModelInfo::new("codellama"),
        ModelInfo::new("mistral"),
        ModelInfo::new("gemma2"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ollama_tags() {
        let body = serde_json::json!({
            "models": [
                {"name": "llama3.2:latest", "model": "llama3.2:latest", "modified_at": "2024-01-01T00:00:00Z", "size": 1234},
                {"name": "mistral", "model": "mistral", "modified_at": "2024-01-01T00:00:00Z", "size": 5678},
            ]
        });

        let models = body
            .get("models")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let name = item.get("name")?.as_str()?;
                        Some(ModelInfo::new(name))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "llama3.2:latest");
        assert_eq!(models[1].id, "mistral");
    }

    #[test]
    fn test_static_fallback() {
        let fallback = static_fallback();
        assert_eq!(fallback.len(), 6);
        assert_eq!(fallback[0].id, "llama3.2");
        assert_eq!(fallback[5].id, "gemma2");
    }
}
