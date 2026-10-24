pub mod commands;
pub mod models;
pub mod providers;
pub mod state;
pub mod storage;
pub mod utils;

use once_cell::sync::Lazy;

/// Shared HTTP client for all LLM providers. Only the connection phase is
/// bounded: an unreachable host (offline, VPN down, wrong Ollama URL) would
/// otherwise leave the AI panel "thinking" forever. A total timeout would cut
/// legitimate long streams, so none is set.
pub static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});
