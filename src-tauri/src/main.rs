#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use mime_guess::MimeGuess;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;
use tiny_http::{Method, Response, Server, StatusCode};
use uuid::Uuid;
use walkdir::WalkDir;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const LIVE_SERVER_PORT: u16 = 5500;
const MAX_FILE_BYTES: usize = 1024 * 1024;
const MAX_SNAPSHOT_FILES: usize = 120;
const MAX_SEARCH_RESULTS: usize = 200;

fn normalize_api_key(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("Bearer ") {
        return rest.trim().to_string();
    }
    if let Some(rest) = trimmed.strip_prefix("bearer ") {
        return rest.trim().to_string();
    }
    trimmed.to_string()
}

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

#[derive(Default)]
struct WorkspaceState {
    watcher: Option<RecommendedWatcher>,
    watched_path: Option<PathBuf>,
    config_path: Option<PathBuf>,
}

struct TerminalSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    killer: Box<dyn portable_pty::ChildKiller + Send>,
}

#[derive(Default)]
struct TerminalState {
    sessions: HashMap<String, TerminalSession>,
}

struct LspSession {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<i64, Sender<Value>>>>,
    next_id: AtomicI64,
    child: Arc<Mutex<Child>>,
}

#[derive(Default)]
struct LspState {
    session: Option<LspSession>,
    workspace_path: Option<String>,
}

struct LiveServerHandle {
    stop_tx: Sender<()>,
    thread: thread::JoinHandle<()>,
}

#[derive(Default)]
struct LiveServerState {
    handle: Option<LiveServerHandle>,
    active: bool,
    root: Option<String>,
    html_file: Option<String>,
    url: Option<String>,
}

#[derive(Default)]
struct AiState {
    aborted_streams: HashSet<String>,
}

#[derive(Serialize, Clone)]
struct FsChangeEvent {
    reason: String,
    path: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
struct AppConfig {
    #[serde(rename = "lastWorkspace")]
    last_workspace: Option<String>,
    #[serde(rename = "uiLanguage", default)]
    ui_language: Option<String>,
    #[serde(rename = "terminalShell", default)]
    terminal_shell: Option<String>,
    #[serde(rename = "colorTheme", default)]
    color_theme: Option<String>,
    #[serde(rename = "fileIconTheme", default)]
    file_icon_theme: Option<String>,
    #[serde(rename = "aiKeys", default)]
    ai_keys: HashMap<String, String>,
    #[serde(rename = "activeProvider", default)]
    active_provider: Option<String>,
    #[serde(rename = "activeModel", default)]
    active_model: Option<String>,
}

#[derive(Serialize, Clone)]
struct TreeNode {
    id: String,
    name: String,
    path: String,
    #[serde(rename = "type")]
    node_type: String,
    children: Option<Vec<TreeNode>>,
}

#[derive(Serialize)]
struct TerminalCreateResult {
    id: String,
}

#[derive(Clone)]
struct ShellCandidate {
    program: String,
    args: Vec<String>,
}

#[derive(Serialize, Clone)]
struct LiveServerStatus {
    active: bool,
    port: Option<u16>,
    root: Option<String>,
    html_file: Option<String>,
    url: Option<String>,
}

#[derive(Serialize, Clone)]
struct ProviderInfo {
    id: String,
    name: String,
    hint: Option<String>,
    #[serde(rename = "staticModels")]
    static_models: Vec<String>,
}

#[derive(Serialize)]
struct AiConfig {
    #[serde(rename = "configuredProviders")]
    configured_providers: Vec<String>,
    #[serde(rename = "activeProvider")]
    active_provider: Option<String>,
    #[serde(rename = "activeModel")]
    active_model: Option<String>,
}

#[derive(Serialize)]
struct AppInfo {
    name: String,
    version: String,
}

#[derive(Serialize)]
struct AppUpdateResult {
    status: String,
    #[serde(rename = "currentVersion")]
    current_version: String,
    #[serde(rename = "latestVersion")]
    latest_version: Option<String>,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ChatRole {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct AiChatArgs {
    #[serde(rename = "streamId")]
    stream_id: String,
    provider: String,
    model: String,
    messages: Vec<ChatRole>,
}

#[derive(Deserialize)]
struct LspRequestArgs {
    method: String,
    params: Value,
}

#[derive(Deserialize)]
struct LspNotificationArgs {
    method: String,
    params: Value,
}

#[derive(Serialize)]
struct AgentReadResult {
    path: String,
    content: String,
    bytes: usize,
}

#[derive(Serialize)]
struct AgentWriteResult {
    path: String,
    existed: bool,
    bytes: usize,
}

#[derive(Serialize)]
struct AgentListEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: String,
}

#[derive(Serialize)]
struct AgentListResult {
    path: String,
    entries: Vec<AgentListEntry>,
}

#[derive(Serialize)]
struct AgentSearchMatch {
    path: String,
    line: usize,
    preview: String,
}

#[derive(Serialize)]
struct AgentSearchResult {
    query: String,
    matches: Vec<AgentSearchMatch>,
    truncated: bool,
}

#[derive(Serialize)]
struct AgentInitManifestFile {
    path: String,
    #[serde(rename = "relPath")]
    rel_path: String,
    content: String,
}

#[derive(Serialize)]
struct AgentInitResult {
    tree: String,
    #[serde(rename = "manifestFiles")]
    manifest_files: Vec<AgentInitManifestFile>,
}

#[derive(Serialize)]
struct AgentSnapshotFile {
    path: String,
    #[serde(rename = "relPath")]
    rel_path: String,
    content: String,
}

fn normalize_path(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

fn normalize_lexical(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                let _ = out.pop();
            }
            Component::Normal(segment) => out.push(segment),
        }
    }
    out
}

fn is_path_within(base: &Path, target: &Path) -> bool {
    let base_norm = normalize_path(&normalize_lexical(base));
    let target_norm = normalize_path(&normalize_lexical(target));

    if cfg!(windows) {
        let base_l = base_norm.to_lowercase();
        let target_l = target_norm.to_lowercase();
        if target_l == base_l {
            return true;
        }
        let prefix = format!("{}\\", base_l.trim_end_matches(['\\', '/']));
        target_l.starts_with(&prefix)
    } else {
        if target_norm == base_norm {
            return true;
        }
        let prefix = format!("{}/", base_norm.trim_end_matches('/'));
        target_norm.starts_with(&prefix)
    }
}

fn resolve_user_path_in_workspace(
    state: &State<'_, Mutex<WorkspaceState>>,
    path_input: &str,
) -> Result<PathBuf, String> {
    let watched_root = {
        let s = state.lock().map_err(|_| "workspace state lock failed")?;
        s.watched_path.clone()
    };

    let mut candidate = PathBuf::from(path_input);
    if candidate.is_relative() {
        if let Some(root) = &watched_root {
            candidate = root.join(candidate);
        } else {
            return Err("relative path requires an active workspace".into());
        }
    }

    let normalized = normalize_lexical(&candidate);

    if let Some(root) = watched_root {
        let root_norm = normalize_lexical(&root);
        if !is_path_within(&root_norm, &normalized) {
            return Err("path outside active workspace".into());
        }
    }

    Ok(normalized)
}

fn app_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let p = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir error: {e}"))?;
    fs::create_dir_all(&p).map_err(|e| format!("mkdir config dir error: {e}"))?;
    Ok(p.join("quebracho-config.json"))
}

fn load_app_config(path: &Path) -> AppConfig {
    if !path.exists() {
        let legacy_path = path.with_file_name("forge-config.json");
        if legacy_path.exists() {
            return match fs::read_to_string(legacy_path) {
                Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
                Err(_) => AppConfig::default(),
            };
        }
    }

    if !path.exists() {
        return AppConfig::default();
    }
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

fn save_app_config(path: &Path, cfg: &AppConfig) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize config error: {e}"))?;
    fs::write(path, json).map_err(|e| format!("write config error: {e}"))
}

fn read_directory_recursive(dir_path: &Path, depth: usize) -> Vec<TreeNode> {
    if depth > 10 {
        return vec![];
    }

    let entries = match fs::read_dir(dir_path) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let mut items: Vec<_> = entries.filter_map(Result::ok).collect();
    items.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase()),
        }
    });

    let mut nodes = Vec::new();

    for entry in items {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name == "node_modules" || name == "dist" || name == "target" || name == ".git" {
            continue;
        }

        let is_dir = path.is_dir();
        let children = if is_dir {
            Some(read_directory_recursive(&path, depth + 1))
        } else {
            None
        };

        nodes.push(TreeNode {
            id: normalize_path(&path),
            name,
            path: normalize_path(&path),
            node_type: if is_dir {
                "directory".into()
            } else {
                "file".into()
            },
            children,
        });
    }

    nodes
}

fn resolve_within_workspace(workspace_path: &str, ruta: &str) -> Result<PathBuf, String> {
    let workspace = normalize_lexical(&PathBuf::from(workspace_path));
    if !workspace.exists() {
        return Err("workspace does not exist".into());
    }

    let candidate = {
        let p = PathBuf::from(ruta);
        if p.is_absolute() {
            p
        } else {
            workspace.join(p)
        }
    };

    let norm = normalize_lexical(&candidate);

    if !is_path_within(&workspace, &norm) {
        return Err("path escapes workspace".into());
    }

    Ok(norm)
}

fn read_text_file_safe(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() as usize > MAX_FILE_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn emit_live_status(app: &AppHandle, state: &LiveServerState) {
    let payload = LiveServerStatus {
        active: state.active,
        port: if state.active {
            Some(LIVE_SERVER_PORT)
        } else {
            None
        },
        root: state.root.clone(),
        html_file: state.html_file.clone(),
        url: state.url.clone(),
    };
    let _ = app.emit("live-server:status", payload);
}

fn lsp_write_message(stdin: &Arc<Mutex<ChildStdin>>, value: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|e| format!("lsp serialize error: {e}"))?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut w = stdin.lock().map_err(|_| "lsp stdin lock failed")?;
    w.write_all(header.as_bytes())
        .and_then(|_| w.write_all(&body))
        .and_then(|_| w.flush())
        .map_err(|e| format!("lsp write failed: {e}"))
}

fn lsp_read_message(reader: &mut BufReader<ChildStdout>) -> Option<Value> {
    let mut content_length = None::<usize>;

    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            content_length = rest.trim().parse::<usize>().ok();
        }
    }

    let len = content_length?;
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).ok()?;
    serde_json::from_slice::<Value>(&buf).ok()
}

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
fn read_directory(
    state: State<'_, Mutex<WorkspaceState>>,
    dir_path: String,
) -> Result<Vec<TreeNode>, String> {
    let safe_dir = resolve_user_path_in_workspace(&state, &dir_path)?;
    Ok(read_directory_recursive(&safe_dir, 0))
}

#[tauri::command]
fn read_file(state: State<'_, Mutex<WorkspaceState>>, file_path: String) -> Result<String, String> {
    let safe_file = resolve_user_path_in_workspace(&state, &file_path)?;
    fs::read_to_string(&safe_file).map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
fn read_image_data_url(
    state: State<'_, Mutex<WorkspaceState>>,
    file_path: String,
) -> Result<HashMap<String, Value>, String> {
    let safe_file = resolve_user_path_in_workspace(&state, &file_path)?;
    let bytes = fs::read(&safe_file).map_err(|e| format!("Failed to read image: {e}"))?;
    let mime = match Path::new(&safe_file)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };
    let data_url = format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(bytes.clone())
    );
    let mut out = HashMap::new();
    out.insert("dataUrl".to_string(), Value::String(data_url));
    out.insert(
        "size".to_string(),
        Value::Number((bytes.len() as u64).into()),
    );
    Ok(out)
}

#[tauri::command]
fn write_file(
    state: State<'_, Mutex<WorkspaceState>>,
    file_path: String,
    content: String,
) -> Result<bool, String> {
    let safe_file = resolve_user_path_in_workspace(&state, &file_path)?;
    if let Some(parent) = safe_file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to prepare parent dirs: {e}"))?;
    }
    fs::write(safe_file, content).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(true)
}

#[tauri::command]
fn create_file(state: State<'_, Mutex<WorkspaceState>>, file_path: String) -> Result<bool, String> {
    let safe_file = resolve_user_path_in_workspace(&state, &file_path)?;
    if safe_file.exists() {
        return Err("File already exists".into());
    }
    fs::write(safe_file, "").map_err(|e| format!("Failed to create file: {e}"))?;
    Ok(true)
}

#[tauri::command]
fn create_directory(
    state: State<'_, Mutex<WorkspaceState>>,
    dir_path: String,
) -> Result<bool, String> {
    let safe_dir = resolve_user_path_in_workspace(&state, &dir_path)?;
    fs::create_dir_all(safe_dir).map_err(|e| format!("Failed to create directory: {e}"))?;
    Ok(true)
}

#[tauri::command]
fn delete_item(state: State<'_, Mutex<WorkspaceState>>, item_path: String) -> Result<bool, String> {
    let p = resolve_user_path_in_workspace(&state, &item_path)?;
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("Failed to delete directory: {e}"))?;
    } else {
        fs::remove_file(&p).map_err(|e| format!("Failed to delete file: {e}"))?;
    }
    Ok(true)
}

#[tauri::command]
fn rename_item(
    state: State<'_, Mutex<WorkspaceState>>,
    old_path: String,
    new_path: String,
) -> Result<bool, String> {
    let old_safe = resolve_user_path_in_workspace(&state, &old_path)?;
    let new_safe = resolve_user_path_in_workspace(&state, &new_path)?;
    fs::rename(old_safe, new_safe).map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(true)
}

#[tauri::command]
fn watch_workspace(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
    dir_path: String,
) -> Result<bool, String> {
    let watch_path = normalize_lexical(&PathBuf::from(dir_path.clone()));
    if !watch_path.is_dir() {
        return Err("watch path is not a directory".into());
    }

    let app_clone = app.clone();
    let (event_tx, event_rx) = mpsc::channel::<FsChangeEvent>();

    thread::spawn(move || loop {
        let mut latest = match event_rx.recv() {
            Ok(evt) => evt,
            Err(_) => break,
        };

        while let Ok(next_evt) = event_rx.recv_timeout(Duration::from_millis(120)) {
            latest = next_evt;
        }

        let _ = app_clone.emit("fs:changed", latest);
    });

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let reason = format!("{:?}", event.kind);
            if let Some(path) = event.paths.first() {
                let _ = event_tx.send(FsChangeEvent {
                    reason,
                    path: normalize_path(path),
                });
            }
        }
    })
    .map_err(|e| format!("watcher create failed: {e}"))?;

    watcher
        .watch(&watch_path, RecursiveMode::Recursive)
        .map_err(|e| format!("watcher start failed: {e}"))?;

    let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
    s.watched_path = Some(watch_path);
    s.watcher = Some(watcher);
    Ok(true)
}

#[tauri::command]
fn unwatch_workspace(state: State<'_, Mutex<WorkspaceState>>) -> Result<bool, String> {
    let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
    s.watcher = None;
    s.watched_path = None;
    Ok(true)
}

#[tauri::command]
fn remember_workspace(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
    workspace_path: String,
) -> Result<bool, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let mut cfg = load_app_config(&config_path);
    cfg.last_workspace = Some(workspace_path);
    save_app_config(&config_path, &cfg)?;
    Ok(true)
}

#[tauri::command]
fn get_last_workspace(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
) -> Result<Option<String>, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let cfg = load_app_config(&config_path);
    Ok(cfg.last_workspace)
}

#[tauri::command]
fn ui_get_language(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
) -> Result<Option<String>, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let cfg = load_app_config(&config_path);
    Ok(cfg.ui_language)
}

#[tauri::command]
fn ui_set_language(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
    language: String,
) -> Result<bool, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let mut cfg = load_app_config(&config_path);
    cfg.ui_language = Some(language);
    save_app_config(&config_path, &cfg)?;
    Ok(true)
}

#[tauri::command]
fn ui_get_terminal_shell(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
) -> Result<Option<String>, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let cfg = load_app_config(&config_path);
    Ok(cfg.terminal_shell)
}

#[tauri::command]
fn ui_set_terminal_shell(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
    shell: Option<String>,
) -> Result<bool, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let mut cfg = load_app_config(&config_path);
    cfg.terminal_shell = shell.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    save_app_config(&config_path, &cfg)?;
    Ok(true)
}

#[tauri::command]
fn ui_get_color_theme(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
) -> Result<Option<String>, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let cfg = load_app_config(&config_path);
    Ok(cfg.color_theme)
}

#[tauri::command]
fn ui_set_color_theme(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
    theme: Option<String>,
) -> Result<bool, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let mut cfg = load_app_config(&config_path);
    cfg.color_theme = theme.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    save_app_config(&config_path, &cfg)?;
    Ok(true)
}

#[tauri::command]
fn ui_get_file_icon_theme(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
) -> Result<Option<String>, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let cfg = load_app_config(&config_path);
    Ok(cfg.file_icon_theme)
}

#[tauri::command]
fn ui_set_file_icon_theme(
    app: AppHandle,
    state: State<'_, Mutex<WorkspaceState>>,
    theme: Option<String>,
) -> Result<bool, String> {
    let config_path = {
        let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
        if s.config_path.is_none() {
            s.config_path = Some(app_config_path(&app)?);
        }
        s.config_path.clone().ok_or("missing config path")?
    };

    let mut cfg = load_app_config(&config_path);
    cfg.file_icon_theme = theme.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    save_app_config(&config_path, &cfg)?;
    Ok(true)
}

#[tauri::command]
fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
async fn app_check_for_updates(app: AppHandle) -> Result<AppUpdateResult, String> {
    let current_version = app.package_info().version.to_string();

    let updater = app
        .updater()
        .map_err(|e| format!("updater is not available: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("failed to check for updates: {e}"))?;

    let Some(update) = update else {
        return Ok(AppUpdateResult {
            status: "up_to_date".into(),
            current_version,
            latest_version: None,
            message: "Ya tienes la ultima version instalada.".into(),
        });
    };

    let latest_version = update.version.to_string();

    update
        .download_and_install(|_chunk_length, _content_length| {}, || {})
        .await
        .map_err(|e| format!("failed to download/install update: {e}"))?;

    Ok(AppUpdateResult {
        status: "updated".into(),
        current_version,
        latest_version: Some(latest_version.clone()),
        message: format!(
            "Actualizacion {latest_version} instalada. Reinicia la app para completar el proceso."
        ),
    })
}

#[tauri::command]
fn terminal_create(
    app: AppHandle,
    terminal_state: State<'_, Mutex<TerminalState>>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    shell: Option<String>,
) -> Result<TerminalCreateResult, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("open pty failed: {e}"))?;

    let requested = shell
        .as_deref()
        .map(str::trim)
        .map(str::to_lowercase)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "auto".to_string());

    let mut shell_candidates: Vec<ShellCandidate> = Vec::new();
    let mut push_candidate = |program: &str, args: &[&str]| {
        if program.trim().is_empty() {
            return;
        }
        let program_owned = program.to_string();
        let args_owned = args.iter().map(|v| (*v).to_string()).collect::<Vec<_>>();
        let exists = shell_candidates
            .iter()
            .any(|c| c.program.eq_ignore_ascii_case(&program_owned) && c.args == args_owned);
        if !exists {
            shell_candidates.push(ShellCandidate {
                program: program_owned,
                args: args_owned,
            });
        }
    };

    #[cfg(windows)]
    {
        match requested.as_str() {
            "pwsh" => {
                push_candidate("pwsh.exe", &[]);
            }
            "powershell" => {
                push_candidate("powershell.exe", &[]);
            }
            "cmd" => {
                if let Ok(comspec) = std::env::var("ComSpec") {
                    if !comspec.trim().is_empty() {
                        push_candidate(comspec.trim(), &[]);
                    }
                }
                push_candidate("cmd.exe", &[]);
            }
            "git-bash" => {
                push_candidate("C:\\Program Files\\Git\\bin\\bash.exe", &["--login", "-i"]);
                push_candidate(
                    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
                    &["--login", "-i"],
                );
                push_candidate("bash.exe", &["--login", "-i"]);
            }
            _ => {}
        }

        push_candidate("pwsh.exe", &[]);
        push_candidate("powershell.exe", &[]);
        if let Ok(comspec) = std::env::var("ComSpec") {
            if !comspec.trim().is_empty() {
                push_candidate(comspec.trim(), &[]);
            }
        }
        push_candidate("cmd.exe", &[]);
        push_candidate("C:\\Program Files\\Git\\bin\\bash.exe", &["--login", "-i"]);
        push_candidate(
            "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
            &["--login", "-i"],
        );
        push_candidate("bash.exe", &["--login", "-i"]);
    }

    #[cfg(not(windows))]
    {
        match requested.as_str() {
            "zsh" => push_candidate("zsh", &[]),
            "bash" => push_candidate("bash", &[]),
            "sh" => push_candidate("sh", &[]),
            "fish" => push_candidate("fish", &[]),
            _ => {}
        }

        if let Ok(shell_env) = std::env::var("SHELL") {
            if !shell_env.trim().is_empty() {
                push_candidate(shell_env.trim(), &[]);
            }
        }
        #[cfg(target_os = "macos")]
        {
            push_candidate("zsh", &[]);
            push_candidate("bash", &[]);
            push_candidate("sh", &[]);
            push_candidate("fish", &[]);
        }
        #[cfg(not(target_os = "macos"))]
        {
            push_candidate("bash", &[]);
            push_candidate("zsh", &[]);
            push_candidate("sh", &[]);
            push_candidate("fish", &[]);
        }
    }

    let mut last_err: Option<String> = None;
    let mut child_opt = None;

    for candidate in shell_candidates {
        let mut cmd = CommandBuilder::new(candidate.program);
        for arg in candidate.args {
            cmd.arg(arg);
        }
        if let Some(ref cwd) = cwd {
            cmd.cwd(cwd);
        }
        match pair.slave.spawn_command(cmd) {
            Ok(child) => {
                child_opt = Some(child);
                break;
            }
            Err(err) => {
                last_err = Some(err.to_string());
            }
        }
    }

    let mut child = child_opt.ok_or_else(|| {
        format!(
            "spawn terminal failed: {}",
            last_err.unwrap_or_else(|| "no shell candidate succeeded".to_string())
        )
    })?;

    let killer = child.clone_killer();

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    let id = Uuid::new_v4().to_string();
    let app_for_read = app.clone();
    let id_for_read = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_for_read
                        .emit("terminal:data", json!({ "id": id_for_read, "data": data }));
                }
                Err(_) => break,
            }
        }
    });

    let app_for_wait = app.clone();
    let id_for_wait = id.clone();
    thread::spawn(move || {
        let code = child
            .wait()
            .ok()
            .map(|s| i32::try_from(s.exit_code()).unwrap_or(-1))
            .unwrap_or(-1);
        let _ = app_for_wait.emit("terminal:exit", json!({ "id": id_for_wait, "code": code }));
    });

    let mut s = terminal_state
        .lock()
        .map_err(|_| "terminal state lock failed")?;
    s.sessions.insert(
        id.clone(),
        TerminalSession {
            writer,
            master: pair.master,
            killer,
        },
    );

    Ok(TerminalCreateResult { id })
}

#[tauri::command]
fn terminal_write(
    terminal_state: State<'_, Mutex<TerminalState>>,
    id: String,
    data: String,
) -> Result<bool, String> {
    let mut s = terminal_state
        .lock()
        .map_err(|_| "terminal state lock failed")?;
    let session = s
        .sessions
        .get_mut(&id)
        .ok_or("terminal session not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|e| format!("terminal write failed: {e}"))?;
    Ok(true)
}

#[tauri::command]
fn terminal_send_command(
    terminal_state: State<'_, Mutex<TerminalState>>,
    id: String,
    command: String,
) -> Result<bool, String> {
    terminal_write(terminal_state, id, command)
}

#[tauri::command]
fn terminal_resize(
    terminal_state: State<'_, Mutex<TerminalState>>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<bool, String> {
    let mut s = terminal_state
        .lock()
        .map_err(|_| "terminal state lock failed")?;
    let session = s
        .sessions
        .get_mut(&id)
        .ok_or("terminal session not found")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("terminal resize failed: {e}"))?;
    Ok(true)
}

#[tauri::command]
fn terminal_kill(
    terminal_state: State<'_, Mutex<TerminalState>>,
    id: String,
) -> Result<bool, String> {
    let mut s = terminal_state
        .lock()
        .map_err(|_| "terminal state lock failed")?;
    if let Some(mut session) = s.sessions.remove(&id) {
        let _ = session.killer.kill();
    }
    Ok(true)
}

#[tauri::command]
fn live_server_start(
    app: AppHandle,
    live_state: State<'_, Mutex<LiveServerState>>,
    html_path: String,
) -> Result<LiveServerStatus, String> {
    let html = PathBuf::from(html_path.clone());
    if !html.exists() {
        return Err("html file does not exist".into());
    }
    let root = html.parent().ok_or("html has no parent")?.to_path_buf();
    let html_file = html
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("invalid html filename")?;

    {
        let mut s = live_state
            .lock()
            .map_err(|_| "live server state lock failed")?;
        if let Some(handle) = s.handle.take() {
            let _ = handle.stop_tx.send(());
            let _ = handle.thread.join();
        }
        s.active = false;
        s.root = None;
        s.html_file = None;
        s.url = None;
        emit_live_status(&app, &s);
    }

    let server = Server::http(("127.0.0.1", LIVE_SERVER_PORT))
        .map_err(|e| format!("live server bind failed: {e}"))?;
    let (tx, rx): (Sender<()>, Receiver<()>) = mpsc::channel();
    let root_clone = root.clone();
    let html_clone = html_file.clone();

    let handle = thread::spawn(move || loop {
        if rx.try_recv().is_ok() {
            break;
        }

        match server.recv_timeout(Duration::from_millis(150)) {
            Ok(Some(request)) => {
                if request.method() != &Method::Get {
                    let _ = request.respond(Response::empty(StatusCode(405)));
                    continue;
                }

                let rel = request.url().trim_start_matches('/');
                let target = if rel.is_empty() {
                    html_clone.clone()
                } else {
                    rel.to_string()
                };
                let full = root_clone.join(target);

                if !full.exists() || !full.is_file() {
                    let _ = request.respond(Response::empty(StatusCode(404)));
                    continue;
                }

                match fs::read(&full) {
                    Ok(bytes) => {
                        let mime = MimeGuess::from_path(&full).first_or_octet_stream();
                        let mut response = Response::from_data(bytes);
                        if let Ok(header) =
                            tiny_http::Header::from_bytes("Content-Type", mime.to_string())
                        {
                            response = response.with_header(header);
                        }
                        let _ = request.respond(response);
                    }
                    Err(_) => {
                        let _ = request.respond(Response::empty(StatusCode(500)));
                    }
                }
            }
            Ok(None) => {}
            Err(_) => break,
        }
    });

    let mut s = live_state
        .lock()
        .map_err(|_| "live server state lock failed")?;
    s.active = true;
    s.root = Some(normalize_path(&root));
    s.html_file = Some(html_file);
    s.url = Some(format!("http://127.0.0.1:{}/", LIVE_SERVER_PORT));
    s.handle = Some(LiveServerHandle {
        stop_tx: tx,
        thread: handle,
    });
    emit_live_status(&app, &s);

    Ok(LiveServerStatus {
        active: s.active,
        port: Some(LIVE_SERVER_PORT),
        root: s.root.clone(),
        html_file: s.html_file.clone(),
        url: s.url.clone(),
    })
}

#[tauri::command]
fn live_server_stop(
    app: AppHandle,
    live_state: State<'_, Mutex<LiveServerState>>,
) -> Result<bool, String> {
    let mut s = live_state
        .lock()
        .map_err(|_| "live server state lock failed")?;
    if let Some(handle) = s.handle.take() {
        let _ = handle.stop_tx.send(());
        let _ = handle.thread.join();
    }
    s.active = false;
    s.root = None;
    s.html_file = None;
    s.url = None;
    emit_live_status(&app, &s);
    Ok(true)
}

#[tauri::command]
fn live_server_status(
    live_state: State<'_, Mutex<LiveServerState>>,
) -> Result<LiveServerStatus, String> {
    let s = live_state
        .lock()
        .map_err(|_| "live server state lock failed")?;
    Ok(LiveServerStatus {
        active: s.active,
        port: if s.active {
            Some(LIVE_SERVER_PORT)
        } else {
            None
        },
        root: s.root.clone(),
        html_file: s.html_file.clone(),
        url: s.url.clone(),
    })
}

#[tauri::command]
fn lsp_start(
    app: AppHandle,
    lsp_state: State<'_, Mutex<LspState>>,
    workspace_path: String,
) -> Result<bool, String> {
    lsp_stop(lsp_state.clone())?;

    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("npx.cmd");
        c.arg("typescript-language-server").arg("--stdio");
        c
    } else {
        let mut c = Command::new("npx");
        c.arg("typescript-language-server").arg("--stdio");
        c
    };

    cmd.current_dir(&workspace_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        // The app is a GUI subsystem process; without this flag Windows may spawn
        // a visible console window for cmd-based child processes (npx.cmd).
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("lsp spawn failed: {e}"))?;
    let stdin = child.stdin.take().ok_or("lsp stdin not available")?;
    let stdout = child.stdout.take().ok_or("lsp stdout not available")?;

    let stdin_arc = Arc::new(Mutex::new(stdin));
    let pending: Arc<Mutex<HashMap<i64, Sender<Value>>>> = Arc::new(Mutex::new(HashMap::new()));
    let pending_reader = pending.clone();
    let app_reader = app.clone();

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Some(msg) = lsp_read_message(&mut reader) {
            if let Some(id) = msg.get("id").and_then(|v| v.as_i64()) {
                if let Ok(mut p) = pending_reader.lock() {
                    if let Some(tx) = p.remove(&id) {
                        let _ = tx.send(msg);
                    }
                }
                continue;
            }

            if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                if method == "textDocument/publishDiagnostics" {
                    let _ = app_reader.emit("lsp:diagnostics", params);
                } else {
                    let _ = app_reader.emit(
                        "lsp:notification",
                        json!({
                          "method": method,
                          "params": params
                        }),
                    );
                }
            }
        }
    });

    let session = LspSession {
        stdin: stdin_arc,
        pending,
        next_id: AtomicI64::new(1),
        child: Arc::new(Mutex::new(child)),
    };

    {
        let mut s = lsp_state.lock().map_err(|_| "lsp state lock failed")?;
        s.workspace_path = Some(workspace_path.clone());
        s.session = Some(session);
    }

    // initialize must be a request in LSP, then follow with initialized notification.
    let _ = lsp_request(
        lsp_state.clone(),
        LspRequestArgs {
            method: "initialize".into(),
            params: json!({
              "processId": std::process::id(),
              "rootUri": format!("file:///{}", workspace_path.replace('\\', "/")),
              "capabilities": {},
              "initializationOptions": {}
            }),
        },
    )?;
    lsp_notification(
        lsp_state,
        LspNotificationArgs {
            method: "initialized".into(),
            params: json!({}),
        },
    )?;

    Ok(true)
}

#[tauri::command]
fn lsp_stop(lsp_state: State<'_, Mutex<LspState>>) -> Result<bool, String> {
    let mut s = lsp_state.lock().map_err(|_| "lsp state lock failed")?;
    if let Some(sess) = &s.session {
        if let Ok(mut child) = sess.child.lock() {
            let _ = child.kill();
        }
    }
    s.session = None;
    s.workspace_path = None;
    Ok(true)
}

#[tauri::command]
fn lsp_request(
    lsp_state: State<'_, Mutex<LspState>>,
    args: LspRequestArgs,
) -> Result<Value, String> {
    let s = lsp_state.lock().map_err(|_| "lsp state lock failed")?;
    let sess = s.session.as_ref().ok_or("lsp not started")?;
    let id = sess.next_id.fetch_add(1, Ordering::SeqCst);

    let (tx, rx) = mpsc::channel();
    {
        let mut p = sess.pending.lock().map_err(|_| "lsp pending lock failed")?;
        p.insert(id, tx);
    }

    let msg = json!({
      "jsonrpc": "2.0",
      "id": id,
      "method": args.method,
      "params": args.params,
    });
    lsp_write_message(&sess.stdin, &msg)?;

    let response = rx
        .recv_timeout(Duration::from_secs(12))
        .map_err(|_| "lsp request timeout")?;

    if let Some(err) = response.get("error") {
        return Err(format!("lsp error: {err}"));
    }

    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

#[tauri::command]
fn lsp_notification(
    lsp_state: State<'_, Mutex<LspState>>,
    args: LspNotificationArgs,
) -> Result<bool, String> {
    let s = lsp_state.lock().map_err(|_| "lsp state lock failed")?;
    let sess = s.session.as_ref().ok_or("lsp not started")?;
    let msg = json!({
      "jsonrpc": "2.0",
      "method": args.method,
      "params": args.params,
    });
    lsp_write_message(&sess.stdin, &msg)?;
    Ok(true)
}

#[tauri::command]
fn ai_list_providers() -> Result<Vec<ProviderInfo>, String> {
    Ok(PROVIDERS.clone())
}

#[tauri::command]
fn ai_get_config(
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
fn ai_set_api_key(
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
fn ai_remove_api_key(
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
fn ai_set_active(
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
fn ai_list_models(provider: String) -> Result<Vec<String>, String> {
    let models = PROVIDERS
        .iter()
        .find(|p| p.id == provider)
        .map(|p| p.static_models.clone())
        .unwrap_or_default();
    Ok(models)
}

#[tauri::command]
async fn ai_chat_stream(
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
fn ai_abort_stream(ai_state: State<'_, Mutex<AiState>>, stream_id: String) -> Result<bool, String> {
    let mut s = ai_state.lock().map_err(|_| "ai state lock failed")?;
    s.aborted_streams.insert(stream_id);
    Ok(true)
}

#[tauri::command]
fn forge_read_history(workspace_path: String) -> Result<Option<Vec<Value>>, String> {
    let history_path = PathBuf::from(&workspace_path)
        .join(".forge")
        .join("history.json");
    if !history_path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(history_path).map_err(|e| format!("read history failed: {e}"))?;
    let parsed = serde_json::from_str::<Vec<Value>>(&raw)
        .map_err(|e| format!("parse history failed: {e}"))?;
    Ok(Some(parsed))
}

#[tauri::command]
fn forge_write_history(workspace_path: String, messages: Vec<Value>) -> Result<bool, String> {
    let forge_dir = PathBuf::from(&workspace_path).join(".forge");
    fs::create_dir_all(&forge_dir).map_err(|e| format!("ensure forge dir failed: {e}"))?;
    let history_path = forge_dir.join("history.json");
    let body = serde_json::to_string_pretty(&messages)
        .map_err(|e| format!("serialize history failed: {e}"))?;
    fs::write(history_path, body).map_err(|e| format!("write history failed: {e}"))?;
    Ok(true)
}

#[tauri::command]
fn forge_ensure_forge_dir(workspace_path: String) -> Result<bool, String> {
    let forge_dir = PathBuf::from(&workspace_path).join(".forge");
    fs::create_dir_all(&forge_dir).map_err(|e| format!("ensure forge dir failed: {e}"))?;
    let history_path = forge_dir.join("history.json");
    if !history_path.exists() {
        fs::write(&history_path, "[]").map_err(|e| format!("create history failed: {e}"))?;
    }
    Ok(true)
}

#[tauri::command]
fn forge_has_history(workspace_path: String) -> Result<bool, String> {
    let history_path = PathBuf::from(&workspace_path)
        .join(".forge")
        .join("history.json");
    Ok(history_path.exists())
}

#[tauri::command]
fn agent_leer_archivo(workspace_path: String, ruta: String) -> Result<AgentReadResult, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    let content = fs::read_to_string(&full).map_err(|e| format!("read file failed: {e}"))?;
    Ok(AgentReadResult {
        path: normalize_path(&full),
        bytes: content.len(),
        content,
    })
}

#[tauri::command]
fn agent_escribir_archivo(
    workspace_path: String,
    ruta: String,
    contenido: String,
) -> Result<AgentWriteResult, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    let existed = full.exists();
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent failed: {e}"))?;
    }
    fs::write(&full, contenido.as_bytes()).map_err(|e| format!("write file failed: {e}"))?;
    Ok(AgentWriteResult {
        path: normalize_path(&full),
        existed,
        bytes: contenido.len(),
    })
}

#[tauri::command]
fn agent_listar_carpeta(workspace_path: String, ruta: String) -> Result<AgentListResult, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    let entries = fs::read_dir(&full)
        .map_err(|e| format!("read dir failed: {e}"))?
        .filter_map(Result::ok)
        .map(|e| {
            let kind = if e.path().is_dir() {
                "directory"
            } else {
                "file"
            };
            AgentListEntry {
                name: e.file_name().to_string_lossy().to_string(),
                entry_type: kind.into(),
            }
        })
        .collect::<Vec<_>>();

    Ok(AgentListResult {
        path: normalize_path(&full),
        entries,
    })
}

#[tauri::command]
fn agent_buscar_en_proyecto(
    workspace_path: String,
    texto: String,
) -> Result<AgentSearchResult, String> {
    if texto.trim().is_empty() {
        return Err("texto is required".into());
    }

    let workspace = PathBuf::from(&workspace_path);
    let mut matches = Vec::new();
    let mut truncated = false;

    for entry in WalkDir::new(&workspace).into_iter().filter_map(Result::ok) {
        if matches.len() >= MAX_SEARCH_RESULTS {
            truncated = true;
            break;
        }

        let path = entry.path();
        let file_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if file_name == "node_modules"
            || file_name == "dist"
            || file_name == "target"
            || file_name == ".git"
        {
            continue;
        }

        if !path.is_file() {
            continue;
        }

        if let Some(content) = read_text_file_safe(path) {
            for (idx, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&texto.to_lowercase()) {
                    matches.push(AgentSearchMatch {
                        path: normalize_path(path),
                        line: idx + 1,
                        preview: line.trim().to_string(),
                    });
                    if matches.len() >= MAX_SEARCH_RESULTS {
                        truncated = true;
                        break;
                    }
                }
            }
        }
    }

    Ok(AgentSearchResult {
        query: texto,
        matches,
        truncated,
    })
}

#[tauri::command]
fn agent_init_context(workspace_path: String) -> Result<AgentInitResult, String> {
    let ws = PathBuf::from(&workspace_path);
    if !ws.exists() {
        return Err("workspace does not exist".into());
    }

    let mut tree_lines = Vec::new();
    for entry in WalkDir::new(&ws)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
    {
        let p = entry.path();
        let rel = p.strip_prefix(&ws).unwrap_or(p);
        if rel.as_os_str().is_empty() {
            continue;
        }
        let level = rel.components().count().saturating_sub(1);
        let prefix = "  ".repeat(level);
        let name = rel
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if name == "node_modules" || name == "dist" || name == "target" || name == ".git" {
            continue;
        }
        tree_lines.push(format!("{}{}", prefix, name));
    }

    let manifests = vec![
        "package.json",
        "tsconfig.json",
        "tailwind.config.js",
        "vite.config.ts",
        "src-tauri/Cargo.toml",
        "src-tauri/tauri.conf.json",
    ];

    let mut manifest_files = Vec::new();
    for rel in manifests {
        let p = ws.join(rel);
        if let Some(content) = read_text_file_safe(&p) {
            manifest_files.push(AgentInitManifestFile {
                path: normalize_path(&p),
                rel_path: rel.to_string(),
                content,
            });
        }
    }

    Ok(AgentInitResult {
        tree: tree_lines.join("\n"),
        manifest_files,
    })
}

#[tauri::command]
fn agent_snapshot_folder(
    workspace_path: String,
    folder_path: String,
) -> Result<Vec<AgentSnapshotFile>, String> {
    let folder = resolve_within_workspace(&workspace_path, &folder_path)?;
    if !folder.exists() {
        return Err("folder does not exist".into());
    }

    let ws = PathBuf::from(&workspace_path);
    let mut out = Vec::new();

    for entry in WalkDir::new(&folder)
        .max_depth(6)
        .into_iter()
        .filter_map(Result::ok)
    {
        if out.len() >= MAX_SNAPSHOT_FILES {
            break;
        }
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        if let Some(content) = read_text_file_safe(p) {
            let rel = p
                .strip_prefix(&ws)
                .unwrap_or(p)
                .to_string_lossy()
                .to_string();
            out.push(AgentSnapshotFile {
                path: normalize_path(p),
                rel_path: rel,
                content,
            });
        }
    }

    Ok(out)
}

#[tauri::command]
fn agent_file_exists(workspace_path: String, ruta: String) -> Result<bool, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    Ok(full.exists())
}

#[tauri::command]
fn agent_read_file_safe(workspace_path: String, ruta: String) -> Result<Option<String>, String> {
    let full = resolve_within_workspace(&workspace_path, &ruta)?;
    Ok(read_text_file_safe(&full))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(WorkspaceState::default()))
        .manage(Mutex::new(TerminalState::default()))
        .manage(Mutex::new(LspState::default()))
        .manage(Mutex::new(LiveServerState::default()))
        .manage(Mutex::new(AiState::default()))
        .invoke_handler(tauri::generate_handler![
            read_directory,
            read_file,
            read_image_data_url,
            write_file,
            create_file,
            create_directory,
            delete_item,
            rename_item,
            watch_workspace,
            unwatch_workspace,
            remember_workspace,
            get_last_workspace,
            ui_get_language,
            ui_set_language,
            ui_get_terminal_shell,
            ui_set_terminal_shell,
            ui_get_color_theme,
            ui_set_color_theme,
            ui_get_file_icon_theme,
            ui_set_file_icon_theme,
            app_info,
            app_check_for_updates,
            terminal_create,
            terminal_write,
            terminal_send_command,
            terminal_resize,
            terminal_kill,
            live_server_start,
            live_server_stop,
            live_server_status,
            lsp_start,
            lsp_stop,
            lsp_request,
            lsp_notification,
            ai_list_providers,
            ai_get_config,
            ai_set_api_key,
            ai_remove_api_key,
            ai_set_active,
            ai_list_models,
            ai_chat_stream,
            ai_abort_stream,
            forge_read_history,
            forge_write_history,
            forge_ensure_forge_dir,
            forge_has_history,
            agent_leer_archivo,
            agent_escribir_archivo,
            agent_listar_carpeta,
            agent_buscar_en_proyecto,
            agent_init_context,
            agent_snapshot_folder,
            agent_file_exists,
            agent_read_file_safe
        ])
        .setup(|app| {
            let cfg = app_config_path(app.handle())?;
            let state = app.state::<Mutex<WorkspaceState>>();
            let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
            s.config_path = Some(cfg);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
