use crate::models::{AiChatArgs, AiConfig, ChatRole, ProviderInfo};
use crate::state::{AiState, WorkspaceState};
use crate::utils::{app_config_path, load_app_config, normalize_api_key, save_app_config};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

static PROVIDERS: Lazy<Vec<ProviderInfo>> = Lazy::new(|| {
    vec![
        ProviderInfo {
            id: "openai".into(),
            name: "OpenAI".into(),
            hint: Some("Uses OpenAI Chat Completions API".into()),
            static_models: vec!["gpt-4o-mini".into(), "gpt-4.1-mini".into(), "gpt-4o".into()],
        },
        ProviderInfo {
            id: "anthropic".into(),
            name: "Anthropic".into(),
            hint: Some("Uses Anthropic Messages API".into()),
            static_models: vec![
                "claude-3-5-sonnet-latest".into(),
                "claude-3-5-haiku-latest".into(),
            ],
        },
        ProviderInfo {
            id: "google".into(),
            name: "Google".into(),
            hint: Some("Uses Gemini Generate Content API".into()),
            static_models: vec!["gemini-1.5-flash".into(), "gemini-1.5-pro".into()],
        },
        ProviderInfo {
            id: "deepseek".into(),
            name: "DeepSeek".into(),
            hint: Some("OpenAI-compatible API".into()),
            static_models: vec!["deepseek-chat".into(), "deepseek-reasoner".into()],
        },
        ProviderInfo {
            id: "minimax".into(),
            name: "MiniMax".into(),
            hint: Some("OpenAI-compatible API".into()),
            static_models: vec!["MiniMax-M1".into(), "MiniMax-Text-01".into()],
        },
        ProviderInfo {
            id: "opencode".into(),
            name: "OpenCode Go".into(),
            hint: Some("OpenAI-compatible API".into()),
            static_models: vec!["opencode-go".into()],
        },
        ProviderInfo {
            id: "zen".into(),
            name: "Zen".into(),
            hint: Some("OpenAI-compatible API".into()),
            static_models: vec!["zen-pro".into(), "zen-fast".into()],
        },
        ProviderInfo {
            id: "qwen".into(),
            name: "Qwen".into(),
            hint: Some("OpenAI-compatible API".into()),
            static_models: vec!["qwen-plus".into(), "qwen-max".into()],
        },
        ProviderInfo {
            id: "kimi".into(),
            name: "Kimi".into(),
            hint: Some("OpenAI-compatible API".into()),
            static_models: vec!["moonshot-v1-8k".into(), "moonshot-v1-32k".into()],
        },
    ]
});

async fn ai_complete(
    provider: &str,
    model: &str,
    key: &str,
    messages: &[ChatRole],
) -> Result<String, String> {
    let client = Client::new();

    match provider {
        "anthropic" => {
            let system = messages
                .iter()
                .find(|m| m.role == "system")
                .map(|m| m.content.clone())
                .unwrap_or_default();
            let user_messages: Vec<Value> = messages
                .iter()
                .filter(|m| m.role != "system")
                .map(|m| {
                    json!({
                      "role": if m.role == "assistant" { "assistant" } else { "user" },
                      "content": m.content
                    })
                })
                .collect();

            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                  "model": model,
                  "max_tokens": 2048,
                  "system": system,
                  "messages": user_messages
                }))
                .send()
                .await
                .map_err(|e| format!("anthropic request failed: {e}"))?;

            let status = resp.status();
            let body: Value = resp
                .json()
                .await
                .map_err(|e| format!("anthropic parse failed: {e}"))?;
            if !status.is_success() {
                return Err(format!("anthropic error: {}", body));
            }

            let text = body
                .get("content")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|item| item.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Ok(text)
        }
        "google" => {
            let parts: Vec<Value> = messages
                .iter()
                .filter(|m| m.role != "system")
                .map(|m| {
                    json!({
                      "role": if m.role == "assistant" { "model" } else { "user" },
                      "parts": [{ "text": m.content }]
                    })
                })
                .collect();
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, key
            );
            let resp = client
                .post(url)
                .json(&json!({ "contents": parts }))
                .send()
                .await
                .map_err(|e| format!("google request failed: {e}"))?;
            let status = resp.status();
            let body: Value = resp
                .json()
                .await
                .map_err(|e| format!("google parse failed: {e}"))?;
            if !status.is_success() {
                return Err(format!("google error: {}", body));
            }
            let text = body
                .get("candidates")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|c| c.get("content"))
                .and_then(|c| c.get("parts"))
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|p| p.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Ok(text)
        }
        _ => {
            let base = match provider {
                "openai" => "https://api.openai.com/v1/chat/completions",
                "deepseek" => "https://api.deepseek.com/v1/chat/completions",
                "minimax" => "https://api.minimax.chat/v1/chat/completions",
                "opencode" => "https://api.opencode.ai/v1/chat/completions",
                "zen" => "https://api.zenai.run/v1/chat/completions",
                "qwen" => "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
                "kimi" => "https://api.moonshot.cn/v1/chat/completions",
                _ => return Err("unsupported provider".into()),
            };

            let resp = client
                .post(base)
                .header("Authorization", format!("Bearer {key}"))
                .json(&json!({
                  "model": model,
                  "messages": messages,
                  "stream": false
                }))
                .send()
                .await
                .map_err(|e| format!("provider request failed: {e}"))?;

            let status = resp.status();
            let body: Value = resp
                .json()
                .await
                .map_err(|e| format!("provider parse failed: {e}"))?;
            if !status.is_success() {
                let api_message = body
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown provider error");
                let api_type = body
                    .get("error")
                    .and_then(|e| e.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                if status.as_u16() == 401
                    || api_type.eq_ignore_ascii_case("invalid_authentication_error")
                    || api_type.eq_ignore_ascii_case("invalid_api_key")
                {
                    return Err(format!(
            "authentication failed for provider '{provider}': {api_message}. Verify that the API key belongs to this provider and does not include a 'Bearer ' prefix."
          ));
                }

                return Err(format!("provider '{provider}' error: {api_message}"));
            }

            let text = body
                .get("choices")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|msg| msg.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Ok(text)
        }
    }
}

#[tauri::command]
pub fn ai_list_providers() -> Result<Vec<ProviderInfo>, String> {
    Ok(PROVIDERS.clone())
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
pub fn ai_list_models(provider: String) -> Result<Vec<String>, String> {
    let models = PROVIDERS
        .iter()
        .find(|p| p.id == provider)
        .map(|p| p.static_models.clone())
        .unwrap_or_default();
    Ok(models)
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

    let response = ai_complete(&args.provider, &args.model, &key, &args.messages).await;

    match response {
        Ok(text) => {
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
                  "data": err
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
