use crate::models::{FsChangeEvent, TreeNode};
use crate::state::WorkspaceState;
use crate::storage::{JsonPrefsStore, PrefsStore};
use crate::utils::{
    normalize_lexical, normalize_path,
    resolve_user_path_in_workspace,
};
use notify::{Event, RecursiveMode, Watcher};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

fn read_directory_recursive(dir_path: &std::path::Path, depth: usize) -> Vec<TreeNode> {
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
            node_type: if is_dir { "directory".into() } else { "file".into() },
            children,
        });
    }

    nodes
}

#[tauri::command]
pub fn read_directory(
    state: State<'_, Mutex<WorkspaceState>>,
    dir_path: String,
) -> Result<Vec<TreeNode>, String> {
    let safe_dir = resolve_user_path_in_workspace(&state, &dir_path)?;
    Ok(read_directory_recursive(&safe_dir, 0))
}

#[tauri::command]
pub fn read_file(state: State<'_, Mutex<WorkspaceState>>, file_path: String) -> Result<String, String> {
    let safe_file = resolve_user_path_in_workspace(&state, &file_path)?;
    fs::read_to_string(&safe_file).map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
pub fn read_image_data_url(
    state: State<'_, Mutex<WorkspaceState>>,
    file_path: String,
) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    use base64::{engine::general_purpose, Engine as _};
    use std::path::Path;

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
    let mut out = std::collections::HashMap::new();
    out.insert("dataUrl".to_string(), serde_json::Value::String(data_url));
    out.insert(
        "size".to_string(),
        serde_json::Value::Number((bytes.len() as u64).into()),
    );
    Ok(out)
}

#[tauri::command]
pub fn write_file(
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
pub fn create_file(state: State<'_, Mutex<WorkspaceState>>, file_path: String) -> Result<bool, String> {
    let safe_file = resolve_user_path_in_workspace(&state, &file_path)?;
    if safe_file.exists() {
        return Err("File already exists".into());
    }
    fs::write(safe_file, "").map_err(|e| format!("Failed to create file: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn create_directory(
    state: State<'_, Mutex<WorkspaceState>>,
    dir_path: String,
) -> Result<bool, String> {
    let safe_dir = resolve_user_path_in_workspace(&state, &dir_path)?;
    fs::create_dir_all(safe_dir).map_err(|e| format!("Failed to create directory: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn delete_item(state: State<'_, Mutex<WorkspaceState>>, item_path: String) -> Result<bool, String> {
    let p = resolve_user_path_in_workspace(&state, &item_path)?;
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("Failed to delete directory: {e}"))?;
    } else {
        fs::remove_file(&p).map_err(|e| format!("Failed to delete file: {e}"))?;
    }
    Ok(true)
}

#[tauri::command]
pub fn rename_item(
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
pub fn watch_workspace(
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

    thread::spawn(move || {
        while let Ok(mut latest) = event_rx.recv() {
            while let Ok(next_evt) = event_rx.recv_timeout(Duration::from_millis(120)) {
                latest = next_evt;
            }
            let _ = app_clone.emit("fs:changed", latest);
        }
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
pub fn unwatch_workspace(state: State<'_, Mutex<WorkspaceState>>) -> Result<bool, String> {
    let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
    s.watcher = None;
    s.watched_path = None;
    Ok(true)
}

#[tauri::command]
pub fn remember_workspace(
    prefs: State<'_, JsonPrefsStore>,
    workspace_path: String,
) -> Result<bool, String> {
    let mut cfg = prefs.load()?;
    cfg.last_workspace = Some(workspace_path);
    prefs.save(&cfg)?;
    Ok(true)
}

#[tauri::command]
pub fn get_last_workspace(
    prefs: State<'_, JsonPrefsStore>,
) -> Result<Option<String>, String> {
    let cfg = prefs.load()?;
    Ok(cfg.last_workspace)
}

#[cfg(test)]
mod tests {
    use crate::utils::resolve_within_workspace;

    #[test]
    fn test_resolve_within_workspace_relative() {
        let tmp = std::env::temp_dir().join("quebracho-test-resolve-relative");
        let _ = std::fs::create_dir_all(&tmp);
        let tmp_str = tmp.to_string_lossy().to_string();
        let r = resolve_within_workspace(&tmp_str, "src/main.rs").unwrap();
        let path = r.to_string_lossy().to_string();
        assert!(path.ends_with("src\\main.rs") || path.ends_with("src/main.rs"), "path: {}", path);
    }

    #[test]
    fn test_resolve_within_workspace_absolute() {
        let tmp = std::env::temp_dir().join("quebracho-test-resolve-abs");
        let _ = std::fs::create_dir_all(&tmp);
        let tmp_str = tmp.to_string_lossy().to_string();
        let abs = tmp.join("Cargo.toml").to_string_lossy().to_string();
        let r = resolve_within_workspace(&tmp_str, &abs).unwrap();
        assert!(r.to_string_lossy().contains("Cargo.toml"));
    }

    #[test]
    fn test_resolve_within_workspace_traversal_rejected() {
        let tmp = std::env::temp_dir().join("quebracho-test-resolve-traversal");
        let _ = std::fs::create_dir_all(&tmp);
        let tmp_str = tmp.to_string_lossy().to_string();
        let r = resolve_within_workspace(&tmp_str, "../outside");
        assert!(r.is_err());
    }

    #[test]
    fn test_resolve_within_workspace_symlink_like() {
        let tmp = std::env::temp_dir().join("quebracho-test-resolve-symlink");
        let _ = std::fs::create_dir_all(&tmp);
        let tmp_str = tmp.to_string_lossy().to_string();
        let r = resolve_within_workspace(&tmp_str, "foo/./bar");
        assert!(r.is_ok());
    }
}
