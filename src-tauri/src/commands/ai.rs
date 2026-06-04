use crate::models::{AiChatArgs, AiConfig, ChatMessage, ProviderInfo};
use crate::providers::{default_registry, ProviderRegistry};
use crate::state::{AiState, WorkspaceState};
use crate::utils::{app_config_path, load_app_config, normalize_api_key, save_app_config};
use crate::HTTP_CLIENT;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

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
    m
});

#[tauri::command]
pub fn ai_list_providers() -> Result<Vec<ProviderInfo>, String> {
    Ok(REGISTRY.list())
}

#[tauri::command]
pub fn ai_get_config(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
) -> Result<AiConfig, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let cfg = load_app_config(&config_path);
    let configured_providers = cfg.ai_keys.keys().cloned().collect::<Vec<_>>();

    Ok(AiConfig {
        configured_providers,
        active_provider: cfg.active_provider,
        active_model: cfg.active_model,
    })
}

#[tauri::command]
pub fn ai_set_api_key(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
    provider: String,
    api_key: String,
) -> Result<bool, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let provider = provider.trim().to_string();
    let api_key = normalize_api_key(&api_key);
    if provider.is_empty() {
        return Err("provider is required".into());
    }
    if api_key.is_empty() {
        return Err("API key is empty".into());
    }

    let mut cfg = load_app_config(&config_path);
    cfg.ai_keys.insert(provider, api_key);
    save_app_config(&config_path, &cfg)?;
    Ok(true)
}

#[tauri::command]
pub fn ai_remove_api_key(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
    provider: String,
) -> Result<bool, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let mut cfg = load_app_config(&config_path);
    cfg.ai_keys.remove(&provider);
    if cfg.active_provider.as_deref() == Some(provider.as_str()) {
        cfg.active_provider = None;
        cfg.active_model = None;
    }
    save_app_config(&config_path, &cfg)?;
    Ok(true)
}

#[tauri::command]
pub fn ai_set_active(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
    provider: String,
    model: String,
) -> Result<bool, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let mut cfg = load_app_config(&config_path);
    cfg.active_provider = if provider.is_empty() {
        None
    } else {
        Some(provider)
    };
    cfg.active_model = if model.is_empty() { None } else { Some(model) };
    save_app_config(&config_path, &cfg)?;
    Ok(true)
}

#[tauri::command]
pub async fn ai_list_models(provider: String) -> Result<Vec<String>, String> {
    let provider_arc = REGISTRY.get(&provider)
        .ok_or_else(|| format!("unknown provider: {provider}"))?;

    let fallback = FALLBACK_MODELS.get(provider.as_str()).cloned().unwrap_or_default();

    match provider_arc.list_models(None, &HTTP_CLIENT).await {
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
    workspace_state: State<'_, Mutex<WorkspaceState>>,
    ai_state: State<'_, Mutex<AiState>>,
    args: AiChatArgs,
) -> Result<bool, String> {
    {
        let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
        s.aborted_streams.remove(&args.stream_id);
    }

    let config_path = {
        let mut s = workspace_state
            .lock()
            .map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let cfg = load_app_config(&config_path);
    let raw_key = cfg
        .ai_keys
        .get(&args.provider)
        .cloned()
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

    let response = provider_arc.chat_complete(&args.model, &key, &messages, &HTTP_CLIENT).await;

    match response {
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
                let aborted = {
                    let s = ai_state.lock().map_err(|_| "ai state lock failed")?;
                    s.aborted_streams.contains(&args.stream_id)
                };
                if aborted {
                    let _ = app.emit(
                        "ai:stream",
                        json!({
                          "streamId": args.stream_id,
                          "event": "error",
                          "data": "aborted"
                        }),
                    );
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
            Ok(true)
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
            Ok(false)
        }
    }
}

#[tauri::command]
pub fn ai_abort_stream(ai_state: State<'_, Mutex<AiState>>, stream_id: String) -> Result<bool, String> {
    let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
    s.aborted_streams.insert(stream_id);
    Ok(true)
}

#[tauri::command]
pub fn forge_read_history(workspace_path: String) -> Result<Option<Vec<Value>>, String> {
    let history_path = std::path::PathBuf::from(&workspace_path)
        .join(".forge")
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
    let forge_dir = std::path::PathBuf::from(&workspace_path).join(".forge");
    std::fs::create_dir_all(&forge_dir).map_err(|e| format!("ensure forge dir failed: {e}"))?;
    let history_path = forge_dir.join("history.json");
    let body = serde_json::to_string_pretty(&messages)
        .map_err(|e| format!("serialize history failed: {e}"))?;
    std::fs::write(history_path, body).map_err(|e| format!("write history failed: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn forge_ensure_forge_dir(workspace_path: String) -> Result<bool, String> {
    let forge_dir = std::path::PathBuf::from(&workspace_path).join(".forge");
    std::fs::create_dir_all(&forge_dir).map_err(|e| format!("ensure forge dir failed: {e}"))?;
    let history_path = forge_dir.join("history.json");
    if !history_path.exists() {
        std::fs::write(&history_path, "[]").map_err(|e| format!("create history failed: {e}"))?;
    }
    Ok(true)
}

#[tauri::command]
pub fn forge_has_history(workspace_path: String) -> Result<bool, String> {
    let history_path = std::path::PathBuf::from(&workspace_path)
        .join(".forge")
        .join("history.json");
    Ok(history_path.exists())
}
