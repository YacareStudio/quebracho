use crate::models::LiveServerStatus;
use crate::state::{LiveServerHandle, LiveServerState};
use crate::utils::{is_path_within, normalize_lexical, normalize_path};
use mime_guess::MimeGuess;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Method, Response, Server, StatusCode};

const LIVE_SERVER_PORT: u16 = 5500;

/// Translates a raw HTTP request target into a file path inside `root`.
///
/// Strips the query string / fragment, percent-decodes the path and rejects
/// anything that would escape the served directory (`..`, absolute paths,
/// Windows drive prefixes). Returns `None` when the request must be refused.
fn resolve_request_path(root: &Path, url: &str, index_file: &str) -> Option<PathBuf> {
    let path_part = url.split(['?', '#']).next().unwrap_or("");
    let decoded = urlencoding::decode(path_part).ok()?;

    let mut resolved = root.to_path_buf();
    for segment in decoded.split(['/', '\\']) {
        match segment {
            "" | "." => continue,
            ".." => return None,
            _ => {}
        }
        // Drive letters (`c:`) and NTFS alternate data streams never belong in
        // a served path.
        if segment.contains(':') {
            return None;
        }
        resolved.push(segment);
    }

    if resolved.as_path() == root {
        resolved.push(index_file);
    }

    let normalized = normalize_lexical(&resolved);
    if !is_path_within(&normalize_lexical(root), &normalized) {
        return None;
    }

    Some(normalized)
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

#[tauri::command]
pub fn live_server_start(
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

                let full = match resolve_request_path(&root_clone, request.url(), &html_clone) {
                    Some(p) => p,
                    None => {
                        let _ = request.respond(Response::empty(StatusCode(403)));
                        continue;
                    }
                };

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
pub fn live_server_stop(
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
pub fn live_server_status(
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

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        PathBuf::from("/srv/site")
    }

    #[test]
    fn serves_index_for_root_request() {
        let resolved = resolve_request_path(&root(), "/", "index.html").unwrap();
        assert_eq!(resolved, normalize_lexical(&root().join("index.html")));
    }

    #[test]
    fn strips_query_string_and_fragment() {
        let resolved = resolve_request_path(&root(), "/app.css?v=3", "index.html").unwrap();
        assert_eq!(resolved, normalize_lexical(&root().join("app.css")));

        let resolved = resolve_request_path(&root(), "/?v=3", "index.html").unwrap();
        assert_eq!(resolved, normalize_lexical(&root().join("index.html")));
    }

    #[test]
    fn percent_decodes_the_path() {
        let resolved = resolve_request_path(&root(), "/my%20file.css", "index.html").unwrap();
        assert_eq!(resolved, normalize_lexical(&root().join("my file.css")));
    }

    #[test]
    fn rejects_directory_traversal() {
        assert!(resolve_request_path(&root(), "/../../etc/passwd", "index.html").is_none());
        assert!(resolve_request_path(&root(), "/assets/../../secret", "index.html").is_none());
        assert!(resolve_request_path(&root(), "/%2e%2e/secret", "index.html").is_none());
        assert!(resolve_request_path(&root(), "/..\\secret", "index.html").is_none());
        assert!(resolve_request_path(&root(), "/C:/Windows/win.ini", "index.html").is_none());
    }

    #[test]
    fn keeps_nested_paths_inside_the_root() {
        let resolved = resolve_request_path(&root(), "/assets/js/app.js", "index.html").unwrap();
        assert_eq!(
            resolved,
            normalize_lexical(&root().join("assets").join("js").join("app.js"))
        );
    }
}
