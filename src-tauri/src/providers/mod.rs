use async_trait::async_trait;
use crate::models::{ChatMessage, ChatResponse, ModelInfo, ProviderError, StreamChunk};
use futures::Stream;
use std::pin::Pin;
use std::task::{Context, Poll};

#[async_trait]
pub trait Provider: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn hint(&self) -> Option<&'static str> { None }
    fn base_url(&self) -> &str;
    fn requires_auth_for_list(&self) -> bool { true }
    async fn list_models(&self, api_key: Option<&str>, http: &reqwest::Client) -> Result<Vec<ModelInfo>, ProviderError>;
    async fn chat_complete(&self, model: &str, api_key: &str, messages: &[ChatMessage], http: &reqwest::Client) -> Result<ChatResponse, ProviderError>;

    /// Default implementation: calls `chat_complete` and emits the whole
    /// content as a single chunk. Providers that support SSE should override.
    async fn chat_stream(
        &self,
        model: &str,
        api_key: &str,
        messages: &[ChatMessage],
        http: &reqwest::Client,
    ) -> Result<std::pin::Pin<Box<dyn Stream<Item = Result<StreamChunk, ProviderError>> + Send>>, ProviderError> {
        let response = self.chat_complete(model, api_key, messages, http).await?;
        let chunk = StreamChunk {
            delta: response.content,
            finish_reason: Some("stop".to_string()),
        };
        // Create a single-item stream
        let stream = futures::stream::once(async { Ok(chunk) });
        Ok(Box::pin(stream))
    }
}

pub mod openai_compatible;
pub mod anthropic;
pub mod google;
pub mod ollama;
pub mod openrouter;
pub mod registry;

pub use openai_compatible::OpenAiCompatibleProvider;
pub use anthropic::AnthropicProvider;
pub use google::GoogleProvider;
pub use ollama::OllamaProvider;
pub use openrouter::OpenRouterProvider;
pub use registry::{ProviderRegistry, default_registry};

/// Generic SSE parser that buffers bytes, splits on double-newlines,
/// and extracts `data: {...}` JSON payloads through the given extractor.
pub fn sse_parse_stream<B, F>(
    byte_stream: B,
    extract: F,
) -> impl Stream<Item = Result<StreamChunk, ProviderError>> + Send
where
    B: Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + Unpin + 'static,
    F: Fn(&serde_json::Value) -> Option<String> + Send + Unpin + 'static,
{
    struct SseStream<B, F> {
        bytes: Pin<Box<B>>,
        buffer: String,
        extract: F,
        done: bool,
    }

    impl<B, F> Stream for SseStream<B, F>
    where
        B: Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + Unpin,
        F: Fn(&serde_json::Value) -> Option<String> + Send + Unpin,
    {
        type Item = Result<StreamChunk, ProviderError>;

        fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            // Safe because SseStream is Unpin (B: Unpin).
            let this = self.get_mut();
            if this.done {
                return Poll::Ready(None);
            }

            loop {
                // Try to emit a complete event first.
                if let Some(pos) = this.buffer.find("\n\n") {
                    let event = this.buffer.split_to(pos);
                    this.buffer.split_to(2); // consume \n\n
                    for line in event.lines() {
                        let line = line.strip_prefix("data: ").unwrap_or(line);
                        if line == "[DONE]" {
                            this.done = true;
                            return Poll::Ready(None);
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                            if let Some(text) = (this.extract)(&json) {
                                return Poll::Ready(Some(Ok(StreamChunk {
                                    delta: text,
                                    finish_reason: json.get("choices")
                                        .and_then(|v| v.as_array())
                                        .and_then(|arr| arr.first())
                                        .and_then(|c| c.get("finish_reason"))
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                })));
                            }
                        }
                    }
                    continue;
                }

                // Need more bytes.
                match this.bytes.as_mut().poll_next(cx) {
                    Poll::Ready(Some(Ok(bytes))) => {
                        this.buffer.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    Poll::Ready(Some(Err(e))) => {
                        this.done = true;
                        return Poll::Ready(Some(Err(ProviderError::Http(e.to_string()))));
                    }
                    Poll::Ready(None) => {
                        this.done = true;
                        return Poll::Ready(None);
                    }
                    Poll::Pending => return Poll::Pending,
                }
            }
        }
    }

    // Helper: String extension for split_to
    trait StringSplitTo {
        fn split_to(&mut self, at: usize) -> String;
    }
    impl StringSplitTo for String {
        fn split_to(&mut self, at: usize) -> String {
            let result = self[..at].to_string();
            *self = self[at..].to_string();
            result
        }
    }

    SseStream {
        bytes: Box::pin(byte_stream),
        buffer: String::new(),
        extract,
        done: false,
    }
}
