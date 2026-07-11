use crate::storage::{JsonPrefsStore, PrefsStore};
use tauri::State;

#[tauri::command]
pub fn ui_get_language(prefs: State<'_, JsonPrefsStore>) -> Result<Option<String>, String> {
    let cfg = prefs.load()?;
    Ok(cfg.ui_language)
}

#[tauri::command]
pub fn ui_set_language(prefs: State<'_, JsonPrefsStore>, language: String) -> Result<bool, String> {
    let mut cfg = prefs.load()?;
    cfg.ui_language = Some(language);
    prefs.save(&cfg)?;
    Ok(true)
}

#[tauri::command]
pub fn ui_get_terminal_shell(prefs: State<'_, JsonPrefsStore>) -> Result<Option<String>, String> {
    let cfg = prefs.load()?;
    Ok(cfg.terminal_shell)
}

#[tauri::command]
pub fn ui_set_terminal_shell(
    prefs: State<'_, JsonPrefsStore>,
    shell: Option<String>,
) -> Result<bool, String> {
    let mut cfg = prefs.load()?;
    cfg.terminal_shell = shell.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    prefs.save(&cfg)?;
    Ok(true)
}

#[tauri::command]
pub fn ui_get_color_theme(prefs: State<'_, JsonPrefsStore>) -> Result<Option<String>, String> {
    let cfg = prefs.load()?;
    Ok(cfg.color_theme)
}

#[tauri::command]
pub fn ui_set_color_theme(
    prefs: State<'_, JsonPrefsStore>,
    theme: Option<String>,
) -> Result<bool, String> {
    let mut cfg = prefs.load()?;
    cfg.color_theme = theme.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    prefs.save(&cfg)?;
    Ok(true)
}

#[tauri::command]
pub fn ui_get_file_icon_theme(prefs: State<'_, JsonPrefsStore>) -> Result<Option<String>, String> {
    let cfg = prefs.load()?;
    Ok(cfg.file_icon_theme)
}

#[tauri::command]
pub fn ui_set_file_icon_theme(
    prefs: State<'_, JsonPrefsStore>,
    theme: Option<String>,
) -> Result<bool, String> {
    let mut cfg = prefs.load()?;
    cfg.file_icon_theme = theme.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    prefs.save(&cfg)?;
    Ok(true)
}
