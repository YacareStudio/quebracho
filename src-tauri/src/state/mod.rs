use notify::RecommendedWatcher;
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, ChildStdin};
use std::sync::atomic::AtomicI64;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct WorkspaceState {
    pub watcher: Option<RecommendedWatcher>,
    pub watched_path: Option<PathBuf>,
    pub config_path: Option<PathBuf>,
}

pub struct TerminalSession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub killer: Box<dyn portable_pty::ChildKiller + Send>,
}

#[derive(Default)]
pub struct TerminalState {
    pub sessions: HashMap<String, TerminalSession>,
}

pub struct LspSession {
    pub stdin: Arc<Mutex<ChildStdin>>,
    pub pending: Arc<Mutex<HashMap<i64, Sender<serde_json::Value>>>>,
    pub next_id: AtomicI64,
    pub child: Arc<Mutex<Child>>,
}

#[derive(Default)]
pub struct LspState {
    pub session: Option<LspSession>,
    pub workspace_path: Option<String>,
}

pub struct LiveServerHandle {
    pub stop_tx: Sender<()>,
    pub thread: std::thread::JoinHandle<()>,
}

#[derive(Default)]
pub struct LiveServerState {
    pub handle: Option<LiveServerHandle>,
    pub active: bool,
    pub root: Option<String>,
    pub html_file: Option<String>,
    pub url: Option<String>,
}

#[derive(Default)]
pub struct AiState {
    pub aborted_streams: std::collections::HashSet<String>,
}
