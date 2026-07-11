use crate::models::{ChatMessage, ChatResponse, ModelInfo, ProviderError, StreamChunk};
use crate::providers::Provider;
use async_trait::async_trait;
use futures::Stream;
use serde_json::Value;

pub struct OpenAiCompatibleProvider {
    pub id: &'static str,
    pub name: &'static str,
    pub hint: Option<&'static str>,
    pub base_url: std::sync::Mutex<String>,
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

    fn base_url(&self) -> String {
        self.base_url.lock().unwrap().clone()
    }

    fn set_base_url(&self, url: String) {
        if let Ok(mut guard) = self.base_url.lock() {
            *guard = url;
        }
    }

    fn requires_auth_for_list(&self) -> bool {
        self.requires_auth_list
    }

    async fn list_models(
        &self,
        api_key: Option<&str>,
        http: &reqwest::Client,
    ) -> Result<Vec<ModelInfo>, ProviderError> {
        if self.requires_auth_list && api_key.is_none() {
            return Ok(vec![]);
        }

        let url = format!("{}/v1/models", self.base_url());
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
                        info.owned_by = item
                            .get("owned_by")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        Some(info)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(models)
    }

    async fn chat_complete(
        &self,
        model: &str,
        api_key: &str,
        messages: &[ChatMessage],
        http: &reqwest::Client,
    ) -> Result<ChatResponse, ProviderError> {
        let url = format!("{}/v1/chat/completions", self.base_url());
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

    async fn chat_stream(
        &self,
        model: &str,
        api_key: &str,
        messages: &[ChatMessage],
        http: &reqwest::Client,
    ) -> Result<
        std::pin::Pin<Box<dyn Stream<Item = Result<StreamChunk, ProviderError>> + Send>>,
        ProviderError,
    > {
        let url = format!("{}/v1/chat/completions", self.base_url());
        let body_json = serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true,
        });

        let resp = http
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Accept", "text/event-stream")
            .json(&body_json)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body: Value = resp.json().await.unwrap_or_default();
            return Err(ProviderError::Http(format!("chat_stream failed: {body}")));
        }

        let byte_stream = resp.bytes_stream();
        let stream = crate::providers::sse_parse_stream(byte_stream, |json| {
            json.get("choices")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("content"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });
        Ok(Box::pin(stream))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_list_models_success() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [
                    {"id": "gpt-4o", "owned_by": "openai"},
                ]
            })))
            .mount(&server)
            .await;

        let base_url: &'static str = Box::leak(server.uri().into_boxed_str());
        let provider = OpenAiCompatibleProvider {
            id: "test",
            name: "Test",
            hint: None,
            base_url: std::sync::Mutex::new(base_url.to_string()),
            requires_auth_list: true,
        };

        let models = provider
            .list_models(Some("test-key"), &reqwest::Client::new())
            .await
            .unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-4o");
        assert_eq!(models[0].owned_by, Some("openai".to_string()));
    }

    #[tokio::test]
    async fn test_chat_stream_sse() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" world\"},\"finish_reason\":null}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"!\"},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n",
        );

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(body),
            )
            .mount(&server)
            .await;

        let base_url: &'static str = Box::leak(server.uri().into_boxed_str());
        let provider = OpenAiCompatibleProvider {
            id: "test",
            name: "Test",
            hint: None,
            base_url: std::sync::Mutex::new(base_url.to_string()),
            requires_auth_list: true,
        };

        let messages = vec![ChatMessage {
            role: "user".into(),
            content: "hi".into(),
        }];
        let mut stream = provider
            .chat_stream("gpt-4", "key", &messages, &reqwest::Client::new())
            .await
            .unwrap();

        let mut chunks = vec![];
        while let Some(chunk) = stream.next().await {
            chunks.push(chunk.unwrap());
        }

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].delta, "Hello");
        assert_eq!(chunks[1].delta, " world");
        assert_eq!(chunks[2].delta, "!");
        assert_eq!(chunks[2].finish_reason, Some("stop".to_string()));
    }
}
