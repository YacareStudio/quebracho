use async_trait::async_trait;
use crate::models::{ChatMessage, ChatResponse, ModelInfo, ProviderError};

#[async_trait]
pub trait Provider: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn hint(&self) -> Option<&'static str> { None }
    fn base_url(&self) -> &str;
    fn requires_auth_for_list(&self) -> bool { true }
    async fn list_models(&self, api_key: Option<&str>, http: &reqwest::Client) -> Result<Vec<ModelInfo>, ProviderError>;
    async fn chat_complete(&self, model: &str, api_key: &str, messages: &[ChatMessage], http: &reqwest::Client) -> Result<ChatResponse, ProviderError>;
}

pub mod openai_compatible;
pub mod anthropic;
pub mod google;
pub mod registry;

pub use openai_compatible::OpenAiCompatibleProvider;
pub use anthropic::AnthropicProvider;
pub use google::GoogleProvider;
pub use registry::{ProviderRegistry, default_registry};
