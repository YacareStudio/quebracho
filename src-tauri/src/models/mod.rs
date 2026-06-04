use serde::{Deserialize, Serialize};

pub mod provider;
pub use provider::*;

#[derive(Serialize, Clone)]
pub struct FsChangeEvent {
    pub reason: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct AppConfig {
    #[serde(rename = "lastWorkspace")]
    pub last_workspace: Option<String>,
    #[serde(rename = "uiLanguage", default)]
    pub ui_language: Option<String>,
    #[serde(rename = "terminalShell", default)]
    pub terminal_shell: Option<String>,
    #[serde(rename = "colorTheme", default)]
    pub color_theme: Option<String>,
    #[serde(rename = "fileIconTheme", default)]
    pub file_icon_theme: Option<String>,
    #[serde(rename = "activeProvider", default)]
    pub active_provider: Option<String>,
    #[serde(rename = "activeModel", default)]
    pub active_model: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TreeNode {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub children: Option<Vec<TreeNode>>,
}

#[derive(Serialize)]
pub struct TerminalCreateResult {
    pub id: String,
}

#[derive(Serialize, Clone)]
pub struct LiveServerStatus {
    pub active: bool,
    pub port: Option<u16>,
    pub root: Option<String>,
    pub html_file: Option<String>,
    pub url: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub hint: Option<String>,
    #[serde(rename = "staticModels")]
    pub static_models: Vec<String>,
}

#[derive(Serialize)]
pub struct AiConfig {
    #[serde(rename = "configuredProviders")]
    pub configured_providers: Vec<String>,
    #[serde(rename = "activeProvider")]
    pub active_provider: Option<String>,
    #[serde(rename = "activeModel")]
    pub active_model: Option<String>,
    #[serde(rename = "keyringStatus")]
    pub keyring_status: Option<String>,
}

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[derive(Serialize)]
pub struct AppUpdateResult {
    pub status: String,
    #[serde(rename = "currentVersion")]
    pub current_version: String,
    #[serde(rename = "latestVersion")]
    pub latest_version: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatRole {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct AiChatArgs {
    #[serde(rename = "streamId")]
    pub stream_id: String,
    pub provider: String,
    pub model: String,
    pub messages: Vec<ChatRole>,
}

#[derive(Deserialize)]
pub struct LspRequestArgs {
    pub method: String,
    pub params: serde_json::Value,
}

#[derive(Deserialize)]
pub struct LspNotificationArgs {
    pub method: String,
    pub params: serde_json::Value,
}

#[derive(Serialize)]
pub struct AgentReadResult {
    pub path: String,
    pub content: String,
    pub bytes: usize,
}

#[derive(Serialize)]
pub struct AgentWriteResult {
    pub path: String,
    pub existed: bool,
    pub bytes: usize,
}

#[derive(Serialize)]
pub struct AgentListEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: String,
}

#[derive(Serialize)]
pub struct AgentListResult {
    pub path: String,
    pub entries: Vec<AgentListEntry>,
}

#[derive(Serialize)]
pub struct AgentSearchMatch {
    pub path: String,
    pub line: usize,
    pub preview: String,
}

#[derive(Serialize)]
pub struct AgentSearchResult {
    pub query: String,
    pub matches: Vec<AgentSearchMatch>,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct AgentInitManifestFile {
    pub path: String,
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct AgentInitResult {
    pub tree: String,
    #[serde(rename = "manifestFiles")]
    pub manifest_files: Vec<AgentInitManifestFile>,
}

#[derive(Serialize)]
pub struct AgentSnapshotFile {
    pub path: String,
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub content: String,
}
