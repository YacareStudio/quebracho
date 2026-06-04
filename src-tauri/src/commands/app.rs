use crate::models::{AppInfo, AppUpdateResult};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
pub fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub async fn app_check_for_updates(app: AppHandle) -> Result<AppUpdateResult, String> {
    let current_version = app.package_info().version.to_string();

    let updater = app
        .updater()
        .map_err(|e| format!("updater is not available: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("failed to check for updates: {e}"))?;

    let Some(update) = update else {
        return Ok(AppUpdateResult {
            status: "up_to_date".into(),
            current_version,
            latest_version: None,
            message: "Ya tienes la ultima version instalada.".into(),
        });
    };

    let latest_version = update.version.to_string();

    update
        .download_and_install(|_chunk_length, _content_length| {}, || {})
        .await
        .map_err(|e| format!("failed to download/install update: {e}"))?;

    Ok(AppUpdateResult {
        status: "updated".into(),
        current_version,
        latest_version: Some(latest_version.clone()),
        message: format!(
            "Actualizacion {latest_version} instalada. Reinicia la app para completar el proceso."
        ),
    })
}
