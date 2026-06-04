use async_trait::async_trait;
use crate::models::{ChatMessage, ChatResponse, ModelInfo, ProviderError};
use crate::providers::Provider;
use serde_json::Value;

pub struct OpenAiCompatibleProvider {
    pub id: &'static str,
    pub name: &'static str,
    pub hint: Option<&'static str>,
    pub base_url: &'static str,
    pub requires_auth_list: bool,
}

#[async_trait]
impl Provider for OpenAiCompatibleProvider {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn hint(&self) -> Option<&'static str> {
        self.hint
    }

    fn base_url(&self) -> &str {
        self.base_url
    }

    fn requires_auth_for_list(&self) -> bool {
        self.requires_auth_list
    }

    async fn list_models(&self, api_key: Option<&str>, http: &reqwest::Client) -> Result<Vec<ModelInfo>, ProviderError> {
        if self.requires_auth_list && api_key.is_none() {
            return Ok(vec![]);
        }

        let url = format!("{}/v1/models", self.base_url);
        let mut req = http.get(&url);
        if let Some(key) = api_key {
            req = req.header("Authorization", format!("Bearer {key}"));
        }

        let resp = req.send().await?;
        let status = resp.status();
        let body: Value = resp.json().await?;

        if !status.is_success() {
            return Err(ProviderError::Http(format!("list_models failed: {body}")));
        }

        let models = body
            .get("data")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let id = item.get("id")?.as_str()?;
                        let mut info = ModelInfo::new(id);
                        info.owned_by = item.get("owned_by").and_then(|v| v.as_str()).map(|s| s.to_string());
                        Some(info)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(models)
    }

    async fn chat_complete(&self, model: &str, api_key: &str, messages: &[ChatMessage], http: &reqwest::Client) -> Result<ChatResponse, ProviderError> {
        let url = format!("{}/v1/chat/completions", self.base_url);
        let body_json = serde_json::json!({
            "model": model,
            "messages": messages,
        });

        let resp = http
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&body_json)
            .send()
            .await?;

        let status = resp.status();
        let body: Value = resp.json().await?;

        if !status.is_success() {
            return Err(ProviderError::Http(format!("chat_complete failed: {body}")));
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

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{MockServer, Mock, ResponseTemplate};
    use wiremock::matchers::{method, path};

    #[tokio::test]
    async fn test_list_models_success() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "data": [
                        {"id": "gpt-4o", "owned_by": "openai"},
                    ]
                })),
            )
            .mount(&server)
            .await;

        let base_url: &'static str = Box::leak(server.uri().into_boxed_str());
        let provider = OpenAiCompatibleProvider {
            id: "test",
            name: "Test",
            hint: None,
            base_url,
            requires_auth_list: true,
        };

        let models = provider.list_models(Some("test-key"), &reqwest::Client::new()).await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-4o");
        assert_eq!(models[0].owned_by, Some("openai".to_string()));
    }
}
