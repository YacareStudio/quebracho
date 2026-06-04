use crate::models::TerminalCreateResult;
use crate::state::{TerminalSession, TerminalState};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::json;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Clone)]
struct ShellCandidate {
    program: String,
    args: Vec<String>,
}

#[tauri::command]
pub fn terminal_create(
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
pub fn terminal_write(
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
pub fn terminal_send_command(
    terminal_state: State<'_, Mutex<TerminalState>>,
    id: String,
    command: String,
) -> Result<bool, String> {
    terminal_write(terminal_state, id, command)
}

#[tauri::command]
pub fn terminal_resize(
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
pub fn terminal_kill(
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
