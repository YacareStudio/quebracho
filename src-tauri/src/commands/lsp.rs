use crate::models::{LspNotificationArgs, LspRequestArgs};
use crate::state::{LspSession, LspState};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

#[tauri::command]
pub fn lsp_start(
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
pub fn lsp_stop(lsp_state: State<'_, Mutex<LspState>>) -> Result<bool, String> {
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
pub fn lsp_request(
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
pub fn lsp_notification(
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
