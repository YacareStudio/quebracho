use crate::models::LiveServerStatus;
use crate::state::{LiveServerHandle, LiveServerState};
use crate::utils::normalize_path;
use mime_guess::MimeGuess;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Method, Response, Server, StatusCode};

const LIVE_SERVER_PORT: u16 = 5500;

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
