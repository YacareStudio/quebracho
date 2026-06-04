use crate::models::AppConfig;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const MAX_FILE_BYTES: usize = 1024 * 1024;

pub fn normalize_api_key(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("Bearer ") {
        return rest.trim().to_string();
    }
    if let Some(rest) = trimmed.strip_prefix("bearer ") {
        return rest.trim().to_string();
    }
    trimmed.to_string()
}

pub fn normalize_path(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

pub fn normalize_lexical(path: &Path) -> PathBuf {
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

pub fn is_path_within(base: &Path, target: &Path) -> bool {
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

pub fn resolve_user_path_in_workspace(
    state: &tauri::State<'_, std::sync::Mutex<crate::state::WorkspaceState>>,
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

pub fn app_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let p = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir error: {e}"))?;
    fs::create_dir_all(&p).map_err(|e| format!("mkdir config dir error: {e}"))?;
    Ok(p.join("quebracho-config.json"))
}

pub fn load_app_config(path: &Path) -> AppConfig {
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

pub fn save_app_config(path: &Path, cfg: &AppConfig) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize config error: {e}"))?;
    fs::write(path, json).map_err(|e| format!("write config error: {e}"))
}

pub fn read_text_file_safe(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() as usize > MAX_FILE_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

pub fn resolve_within_workspace(workspace_path: &str, ruta: &str) -> Result<PathBuf, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_lexical() {
        assert_eq!(
            normalize_lexical(Path::new("./foo/bar")),
            PathBuf::from("foo/bar")
        );
        assert_eq!(
            normalize_lexical(Path::new("foo/../bar")),
            PathBuf::from("bar")
        );
        assert_eq!(
            normalize_lexical(Path::new("foo//bar")),
            PathBuf::from("foo/bar")
        );
        assert_eq!(
            normalize_lexical(Path::new("foo/bar/")),
            PathBuf::from("foo/bar")
        );
    }

    #[test]
    fn test_is_path_within() {
        let base = Path::new("/workspace");
        assert!(is_path_within(base, Path::new("/workspace")));
        assert!(is_path_within(base, Path::new("/workspace/src")));
        assert!(!is_path_within(base, Path::new("/workspace/../etc")));
        assert!(!is_path_within(base, Path::new("/other")));
    }

    #[test]
    fn test_resolve_user_path_in_workspace() {
        // We can't easily test the Tauri State variant here without mocking,
        // so we test resolve_within_workspace which uses the same logic.
        let tmp = std::env::temp_dir().join("quebracho-test-resolve");
        let _ = fs::create_dir_all(&tmp);
        let tmp_str = tmp.to_string_lossy().to_string();

        // relative path
        let r = resolve_within_workspace(&tmp_str, "src/main.rs");
        assert!(r.is_ok());
        let path = r.unwrap().to_string_lossy().to_string();
        assert!(path.ends_with("src\\main.rs") || path.ends_with("src/main.rs"), "path: {}", path);

        // absolute path inside workspace
        let abs = tmp.join(" Cargo.toml").to_string_lossy().to_string();
        let r = resolve_within_workspace(&tmp_str, &abs);
        assert!(r.is_ok());

        // absolute path outside workspace
        let r = resolve_within_workspace(&tmp_str, "/etc/passwd");
        assert!(r.is_err());

        // non-existent relative is still resolved
        let r = resolve_within_workspace(&tmp_str, "does-not-exist.txt");
        assert!(r.is_ok());
    }
}
