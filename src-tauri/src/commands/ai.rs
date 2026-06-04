use crate::models::{AiChatArgs, AiConfig, ChatMessage, ProviderInfo};
use crate::providers::{default_registry, ProviderRegistry};
use crate::state::AiState;
use crate::storage::{JsonPrefsStore, PrefsStore, SecretsStore};
use crate::utils::normalize_api_key;
use crate::HTTP_CLIENT;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use futures::StreamExt;

static REGISTRY: Lazy<ProviderRegistry> = Lazy::new(default_registry);

static FALLBACK_MODELS: Lazy<HashMap<&str, Vec<String>>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("openai", vec!["gpt-4o-mini".into(), "gpt-4.1-mini".into(), "gpt-4o".into()]);
    m.insert("anthropic", vec!["claude-3-5-sonnet-latest".into(), "claude-3-5-haiku-latest".into()]);
    m.insert("google", vec!["gemini-1.5-flash".into(), "gemini-1.5-pro".into()]);
    m.insert("deepseek", vec!["deepseek-chat".into(), "deepseek-reasoner".into()]);
    m.insert("minimax", vec!["MiniMax-M1".into(), "MiniMax-Text-01".into()]);
    m.insert("opencode", vec!["opencode-go".into()]);
    m.insert("zen", vec!["zen-pro".into(), "zen-fast".into()]);
    m.insert("qwen", vec!["qwen-plus".into(), "qwen-max".into()]);
    m.insert("kimi", vec!["moonshot-v1-8k".into(), "moonshot-v1-32k".into()]);
    m.insert("ollama", vec!["llama3.2".into(), "qwen2.5-coder".into(), "deepseek-coder-v2".into(), "codellama".into(), "mistral".into(), "gemma2".into()]);
    m.insert("openrouter", vec![]);
    m
});

#[tauri::command]
pub fn ai_list_providers() -> Result<Vec<ProviderInfo>, String> {
    Ok(REGISTRY.list())
}

#[tauri::command]
pub fn ai_get_config(
    prefs: State<'_, JsonPrefsStore>,
    secrets: State<'_, Arc<dyn SecretsStore>>,
) -> Result<AiConfig, String> {
    let cfg = prefs.load()?;
    let configured_providers = secrets.list()?;
    let keyring_status = match secrets.kind() {
        "keyring" => Some("os".to_string()),
        _ => Some("local".to_string()),
    };

    Ok(AiConfig {
        configured_providers,
        active_provider: cfg.active_provider,
        active_model: cfg.active_model,
        keyring_status,
    })
}

#[tauri::command]
pub fn ai_set_api_key(
    secrets: State<'_, Arc<dyn SecretsStore>>,
    provider: String,
    api_key: String,
) -> Result<bool, String> {
    let provider = provider.trim().to_string();
    let api_key = normalize_api_key(&api_key);
    if provider.is_empty() {
        return Err("provider is required".into());
    }
    if api_key.is_empty() {
        return Err("API key is empty".into());
    }

    secrets.set(&provider, &api_key)?;
    Ok(true)
}

#[tauri::command]
pub fn ai_remove_api_key(
    prefs: State<'_, JsonPrefsStore>,
    secrets: State<'_, Arc<dyn SecretsStore>>,
    provider: String,
) -> Result<bool, String> {
    secrets.remove(&provider)?;

    let mut cfg = prefs.load()?;
    if cfg.active_provider.as_deref() == Some(provider.as_str()) {
        cfg.active_provider = None;
        cfg.active_model = None;
        prefs.save(&cfg)?;
    }

    Ok(true)
}

#[tauri::command]
pub fn ai_set_active(
    prefs: State<'_, JsonPrefsStore>,
    provider: String,
    model: String,
) -> Result<bool, String> {
    let mut cfg = prefs.load()?;
    cfg.active_provider = if provider.is_empty() {
        None
    } else {
        Some(provider)
    };
    cfg.active_model = if model.is_empty() { None } else { Some(model) };
    prefs.save(&cfg)?;
    Ok(true)
}

#[tauri::command]
pub async fn ai_list_models(
    secrets: State<'_, Arc<dyn SecretsStore>>,
    provider: String,
) -> Result<Vec<String>, String> {
    let provider_arc = REGISTRY.get(&provider)
        .ok_or_else(|| format!("unknown provider: {provider}"))?;

    let api_key = secrets.get(&provider).ok().flatten();
    let fallback = FALLBACK_MODELS.get(provider.as_str()).cloned().unwrap_or_default();

    match provider_arc.list_models(api_key.as_deref(), &HTTP_CLIENT).await {
        Ok(models) if !models.is_empty() => {
            Ok(models.into_iter().map(|m| m.id).collect())
        }
        Ok(_) => Ok(fallback),
        Err(_) => Ok(fallback),
    }
}

#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    ai_state: State<'_, Mutex<AiState>>,
    secrets: State<'_, Arc<dyn SecretsStore>>,
    args: AiChatArgs,
) -> Result<bool, String> {
    let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
        s.aborted_streams.remove(&args.stream_id);
        s.stream_cancel_flags.insert(args.stream_id.clone(), Arc::clone(&cancel_flag));
    }

    let raw_key = secrets
        .get(&args.provider)
        .ok()
        .flatten()
        .ok_or("missing API key for provider")?;
    let key = normalize_api_key(&raw_key);
    if key.is_empty() {
        return Err("stored API key is empty; please configure it again".into());
    }

    let provider_arc = REGISTRY.get(&args.provider)
        .ok_or_else(|| format!("unknown provider: {}", args.provider))?;

    let messages: Vec<ChatMessage> = args.messages.into_iter().map(|m| ChatMessage {
        role: m.role,
        content: m.content,
    }).collect();

    // Use real SSE streaming; if it fails, fall back to the old fake-chunking.
    match provider_arc.chat_stream(&args.model, &key, &messages, &HTTP_CLIENT).await {
        Ok(mut stream) => {
            while let Some(chunk_result) = stream.next().await {
                // Check cancellation every chunk.
                if cancel_flag.load(Ordering::Relaxed) {
                    let _ = app.emit(
                        "ai:stream",
                        json!({
                          "streamId": args.stream_id,
                          "event": "error",
                          "data": "aborted"
                        }),
                    );
                    // Clean up flag
                    let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
                    s.stream_cancel_flags.remove(&args.stream_id);
                    return Ok(false);
                }

                match chunk_result {
                    Ok(chunk) => {
                        let _ = app.emit(
                            "ai:stream",
                            json!({
                              "streamId": args.stream_id,
                              "event": "delta",
                              "data": chunk.delta
                            }),
                        );
                        if chunk.finish_reason.is_some() {
                            // End of stream signaled by finish_reason
                            let _ = app.emit(
                                "ai:stream",
                                json!({
                                  "streamId": args.stream_id,
                                  "event": "done",
                                  "data": Value::Null
                                }),
                            );
                            let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
                            s.stream_cancel_flags.remove(&args.stream_id);
                            return Ok(true);
                        }
                    }
                    Err(err) => {
                        let _ = app.emit(
                            "ai:stream",
                            json!({
                              "streamId": args.stream_id,
                              "event": "error",
                              "data": err.to_string()
                            }),
                        );
                        let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
                        s.stream_cancel_flags.remove(&args.stream_id);
                        return Ok(false);
                    }
                }
            }

            // Stream ended without explicit finish_reason — emit done anyway.
            let _ = app.emit(
                "ai:stream",
                json!({
                  "streamId": args.stream_id,
                  "event": "done",
                  "data": Value::Null
                }),
            );
            let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
            s.stream_cancel_flags.remove(&args.stream_id);
            Ok(true)
        }
        Err(err) => {
            // FALLBACK: if SSE streaming fails, use the old fake-chunking so
            // the UI still receives something.
            eprintln!("[quebracho] chat_stream failed, falling back to fake chunking: {err}");
            match provider_arc.chat_complete(&args.model, &key, &messages, &HTTP_CLIENT).await {
                Ok(chat_resp) => {
                    let text = chat_resp.content;
                    let chunks: Vec<String> = if text.is_empty() {
                        vec![String::new()]
                    } else {
                        text.as_bytes()
                            .chunks(256)
                            .map(|c| String::from_utf8_lossy(c).to_string())
                            .collect()
                    };

                    for chunk in chunks {
                        if cancel_flag.load(Ordering::Relaxed) {
                            let _ = app.emit(
                                "ai:stream",
                                json!({
                                  "streamId": args.stream_id,
                                  "event": "error",
                                  "data": "aborted"
                                }),
                            );
                            let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
                            s.stream_cancel_flags.remove(&args.stream_id);
                            return Ok(false);
                        }

                        let _ = app.emit(
                            "ai:stream",
                            json!({
                              "streamId": args.stream_id,
                              "event": "delta",
                              "data": chunk
                            }),
                        );
                    }

                    let _ = app.emit(
                        "ai:stream",
                        json!({
                          "streamId": args.stream_id,
                          "event": "done",
                          "data": Value::Null
                        }),
                    );
                    let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
                    s.stream_cancel_flags.remove(&args.stream_id);
                    Ok(true)
                }
                Err(err2) => {
                    let _ = app.emit(
                        "ai:stream",
                        json!({
                          "streamId": args.stream_id,
                          "event": "error",
                          "data": err2.to_string()
                        }),
                    );
                    let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
                    s.stream_cancel_flags.remove(&args.stream_id);
                    Ok(false)
                }
            }
        }
    }
}

#[tauri::command]
pub fn ai_set_provider_base_url(provider: String, url: String) -> Result<bool, String> {
    let registry = REGISTRY.get(&provider)
        .ok_or_else(|| format!("unknown provider: {provider}"))?;
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".into());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("URL must start with http:// or https://".into());
    }
    if trimmed.len() > 2048 {
        return Err("URL too long".into());
    }
    registry.set_base_url(trimmed.to_string());
    Ok(true)
}

#[cfg(test)]
mod url_validation_tests {
    use super::*;
    #[test]
    fn rejects_javascript_scheme() {
        let r = ai_set_provider_base_url("ollama".into(), "javascript:alert(1)".into());
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("http"));
    }
    #[test]
    fn rejects_file_scheme() {
        let r = ai_set_provider_base_url("ollama".into(), "file:///etc/passwd".into());
        assert!(r.is_err());
    }
    #[test]
    fn rejects_empty() {
        let r = ai_set_provider_base_url("ollama".into(), "   ".into());
        assert!(r.is_err());
    }
    #[test]
    fn rejects_unknown_provider() {
        let r = ai_set_provider_base_url("nope".into(), "http://localhost:1234".into());
        assert!(r.is_err());
    }
}

#[tauri::command]
pub fn ai_abort_stream(ai_state: State<'_, Mutex<AiState>>, stream_id: String) -> Result<bool, String> {
    let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
    s.aborted_streams.insert(stream_id.clone());
    if let Some(flag) = s.stream_cancel_flags.get(&stream_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(true)
}

#[tauri::command]
pub fn forge_read_history(workspace_path: String) -> Result<Option<Vec<Value>>, String> {
    let history_path = std::path::PathBuf::from(&workspace_path)
        .join(".quebracho")
        .join("history.json");
    if !history_path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(history_path).map_err(|e| format!("read history failed: {e}"))?;
    let parsed = serde_json::from_str::<Vec<Value>>(&raw)
        .map_err(|e| format!("parse history failed: {e}"))?;
    Ok(Some(parsed))
}

#[tauri::command]
pub fn forge_write_history(workspace_path: String, messages: Vec<Value>) -> Result<bool, String> {
    let forge_dir = std::path::PathBuf::from(&workspace_path).join(".quebracho");
    std::fs::create_dir_all(&forge_dir).map_err(|e| format!("ensure quebracho dir failed: {e}"))?;
    let history_path = forge_dir.join("history.json");
    let body = serde_json::to_string_pretty(&messages)
        .map_err(|e| format!("serialize history failed: {e}"))?;
    std::fs::write(history_path, body).map_err(|e| format!("write history failed: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn forge_ensure_forge_dir(workspace_path: String) -> Result<bool, String> {
    let forge_dir = std::path::PathBuf::from(&workspace_path).join(".quebracho");
    std::fs::create_dir_all(&forge_dir).map_err(|e| format!("ensure quebracho dir failed: {e}"))?;
    let history_path = forge_dir.join("history.json");
    if !history_path.exists() {
        std::fs::write(&history_path, "[]").map_err(|e| format!("create history failed: {e}"))?;
    }
    Ok(true)
}

#[tauri::command]
pub fn forge_has_history(workspace_path: String) -> Result<bool, String> {
    let history_path = std::path::PathBuf::from(&workspace_path)
        .join(".quebracho")
        .join("history.json");
    Ok(history_path.exists())
}
