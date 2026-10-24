//! Environment for child processes (LSP server, integrated terminal).
//!
//! GUI launches on Linux and macOS get a minimal environment: apps started from
//! the Dock/Finder or a desktop menu don't read `.zprofile`/`.bashrc`, so tools
//! installed through Homebrew, nvm, fnm, volta or asdf are missing from `PATH`,
//! and `TERM`/`LANG` may be unset. AppImage launches additionally leak bundle
//! variables (`APPDIR`, `GTK_PATH`, ...) that break GUI tools started from the
//! integrated terminal.

use once_cell::sync::OnceCell;
use portable_pty::CommandBuilder;
use std::process::Command;

static LOGIN_SHELL_PATH: OnceCell<Option<String>> = OnceCell::new();

/// Variables set by the AppImage runtime that must not reach child processes.
const APPIMAGE_VARS: [&str; 10] = [
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "GDK_PIXBUF_MODULE_FILE",
    "GIO_MODULE_DIR",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
];

fn is_appimage() -> bool {
    std::env::var_os("APPIMAGE").is_some()
}

/// Resolve the login shell `PATH` in the background so commands that run on the
/// main thread never wait on the user's shell startup files.
pub fn warm_up() {
    #[cfg(unix)]
    std::thread::spawn(|| {
        let _ = LOGIN_SHELL_PATH.get_or_init(read_login_shell_path);
    });
}

/// `PATH` for child processes: login-shell entries first, then the current
/// process entries, without duplicates. `None` until `warm_up` has finished or
/// when nothing would change.
pub fn child_path() -> Option<String> {
    let login = LOGIN_SHELL_PATH.get()?.as_deref()?;
    let current = std::env::var("PATH").unwrap_or_default();
    Some(merge_paths(login, &current))
}

fn merge_paths(first: &str, second: &str) -> String {
    let mut seen = Vec::<&str>::new();
    for entry in first.split(':').chain(second.split(':')) {
        if !entry.is_empty() && !seen.contains(&entry) {
            seen.push(entry);
        }
    }
    seen.join(":")
}

#[cfg(unix)]
fn read_login_shell_path() -> Option<String> {
    use std::io::Read;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    const MARKER: &str = "__QUEBRACHO_PATH__";
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string());

    let mut child = Command::new(shell)
        .arg("-l")
        .arg("-c")
        .arg(format!("printf '{MARKER}%s{MARKER}' \"$PATH\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // A broken profile must not hang the app: give up after a few seconds.
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }

    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let path = out.split(MARKER).nth(1)?.trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// Apply the child environment to a `std::process::Command` (LSP server).
pub fn configure_command(cmd: &mut Command) {
    if let Some(path) = child_path() {
        cmd.env("PATH", path);
    }
    if is_appimage() {
        for var in APPIMAGE_VARS {
            cmd.env_remove(var);
        }
    }
}

/// Apply the child environment to a PTY shell.
pub fn configure_pty_command(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Quebracho");
    #[cfg(unix)]
    if std::env::var_os("LANG").is_none() && std::env::var_os("LC_ALL").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    if let Some(path) = child_path() {
        cmd.env("PATH", path);
    }
    if is_appimage() {
        for var in APPIMAGE_VARS {
            cmd.env_remove(var);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_paths_keeps_order_and_dedupes() {
        assert_eq!(
            merge_paths(
                "/opt/homebrew/bin:/usr/bin",
                "/usr/bin:/bin::/opt/homebrew/bin"
            ),
            "/opt/homebrew/bin:/usr/bin:/bin"
        );
    }
}
