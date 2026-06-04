use crate::state::WorkspaceState;
use crate::utils::{app_config_path, load_app_config, save_app_config};
use std::sync::Mutex;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn ui_get_language(
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
pub fn ui_set_language(
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
pub fn ui_get_terminal_shell(
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
pub fn ui_set_terminal_shell(
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
pub fn ui_get_color_theme(
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
pub fn ui_set_color_theme(
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
pub fn ui_get_file_icon_theme(
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
pub fn ui_set_file_icon_theme(
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
