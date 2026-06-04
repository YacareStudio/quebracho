use crate::models::ProviderInfo;
use crate::providers::{AnthropicProvider, GoogleProvider, OllamaProvider, OpenAiCompatibleProvider, OpenRouterProvider, Provider};
use std::collections::HashMap;
use std::sync::Arc;

pub struct ProviderRegistry {
    providers: HashMap<String, Arc<dyn Provider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
        }
    }

    pub fn register(&mut self, provider: Arc<dyn Provider>) {
        self.providers.insert(provider.id().to_string(), provider);
    }

    pub fn list(&self) -> Vec<ProviderInfo> {
        let mut list: Vec<ProviderInfo> = self.providers.values().map(|p| {
            ProviderInfo {
                id: p.id().to_string(),
                name: p.name().to_string(),
                hint: p.hint().map(|s| s.to_string()),
                static_models: vec![],
            }
        }).collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn Provider>> {
        self.providers.get(id).cloned()
    }
}

pub fn default_registry() -> ProviderRegistry {
    let mut registry = ProviderRegistry::new();

    registry.register(Arc::new(OpenAiCompatibleProvider {
        id: "openai",
        name: "OpenAI",
        hint: Some("Uses OpenAI Chat Completions API"),
        base_url: "https://api.openai.com",
        requires_auth_list: true,
    }));

    registry.register(Arc::new(AnthropicProvider));

    registry.register(Arc::new(GoogleProvider));

    registry.register(Arc::new(OpenAiCompatibleProvider {
        id: "deepseek",
        name: "DeepSeek",
        hint: Some("OpenAI-compatible API"),
        base_url: "https://api.deepseek.com",
        requires_auth_list: true,
    }));

    registry.register(Arc::new(OpenAiCompatibleProvider {
        id: "minimax",
        name: "MiniMax",
        hint: Some("OpenAI-compatible API"),
        base_url: "https://api.minimax.chat",
        requires_auth_list: true,
    }));

    registry.register(Arc::new(OpenAiCompatibleProvider {
        id: "opencode",
        name: "OpenCode Go",
        hint: Some("OpenAI-compatible API"),
        base_url: "https://api.opencode.ai",
        requires_auth_list: true,
    }));

    registry.register(Arc::new(OpenAiCompatibleProvider {
        id: "zen",
        name: "Zen",
        hint: Some("OpenAI-compatible API"),
        base_url: "https://api.zenai.run",
        requires_auth_list: true,
    }));

    registry.register(Arc::new(OpenAiCompatibleProvider {
        id: "qwen",
        name: "Qwen",
        hint: Some("OpenAI-compatible API"),
        base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode",
        requires_auth_list: true,
    }));

    registry.register(Arc::new(OpenAiCompatibleProvider {
        id: "kimi",
        name: "Kimi",
        hint: Some("OpenAI-compatible API"),
        base_url: "https://api.moonshot.cn",
        requires_auth_list: true,
    }));

    registry.register(Arc::new(OllamaProvider));
    registry.register(Arc::new(OpenRouterProvider));

    registry
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        default_registry()
    }
}
