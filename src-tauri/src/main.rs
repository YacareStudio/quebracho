#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use quebracho_lib::commands::agent::*;
use quebracho_lib::commands::ai::*;
use quebracho_lib::commands::app::*;
use quebracho_lib::commands::database::*;
use quebracho_lib::commands::fs::*;
use quebracho_lib::commands::live_server::*;
use quebracho_lib::commands::lsp::*;
use quebracho_lib::commands::search::*;
use quebracho_lib::commands::settings::*;
use quebracho_lib::commands::terminal::*;
use quebracho_lib::state::{AiState, LiveServerState, LspState, TerminalState, WorkspaceState};
use quebracho_lib::storage::{JsonPrefsStore, build_secrets_store, migrate_old_config};
use quebracho_lib::utils::app_config_path;
use std::sync::Mutex;
use tauri::Manager;

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Mutex::new(WorkspaceState::default()))
        .manage(Mutex::new(TerminalState::default()))
        .manage(Mutex::new(LspState::default()))
        .manage(Mutex::new(LiveServerState::default()))
        .manage(Mutex::new(AiState::default()))
        .invoke_handler(tauri::generate_handler![
            read_directory,
            read_file,
            read_image_data_url,
            write_file,
            create_file,
            create_directory,
            delete_item,
            rename_item,
            watch_workspace,
            unwatch_workspace,
            remember_workspace,
            get_last_workspace,
            ui_get_language,
            ui_set_language,
            ui_get_terminal_shell,
            ui_set_terminal_shell,
            ui_get_color_theme,
            ui_set_color_theme,
            ui_get_file_icon_theme,
            ui_set_file_icon_theme,
            app_info,
            app_check_for_updates,
            terminal_create,
            terminal_write,
            terminal_send_command,
            terminal_resize,
            terminal_kill,
            live_server_start,
            live_server_stop,
            live_server_status,
            lsp_start,
            lsp_stop,
            lsp_request,
            lsp_notification,
            ai_list_providers,
            ai_get_config,
            ai_set_api_key,
            ai_remove_api_key,
            ai_set_active,
            ai_list_models,
            ai_set_provider_base_url,
            ai_chat_stream,
            ai_abort_stream,
            forge_read_history,
            forge_write_history,
            forge_ensure_forge_dir,
            forge_has_history,
            agent_leer_archivo,
            agent_escribir_archivo,
            agent_listar_carpeta,
            agent_buscar_en_proyecto,
            workspace_search,
            workspace_replace,
            db_save_connections,
            db_load_connections,
            db_list_sqlite_tables,
            db_list_tables,
            db_test_connection,
            db_execute_query,
            agent_init_context,
            agent_snapshot_folder,
            agent_file_exists,
            agent_read_file_safe
        ])
        .setup(|app| {
            // Register sqlx's runtime drivers so `AnyConnection` (used by the
            // database panel for SQLite/MySQL/PostgreSQL) can resolve URL schemes.
            // Without this, every Any-based connection fails at runtime.
            sqlx::any::install_default_drivers();

            let config_path = app_config_path(app.handle())?;
            let secrets_path = config_path.with_file_name("quebracho-secrets.json");

            // Initialize secrets store (OS keychain preferred, JSON fallback)
            let secrets = build_secrets_store(secrets_path.clone());

            // Run one-time migration: move ai_keys from config to secrets store
            let _ = migrate_old_config(&config_path, secrets.as_ref());

            // Initialize prefs store
            let prefs = JsonPrefsStore::new(config_path.clone());

            // Set config path in workspace state for backward compat
            let state = app.state::<Mutex<WorkspaceState>>();
            let mut s = state.lock().map_err(|_| "workspace state lock failed")?;
            s.config_path = Some(config_path);

            // Manage both stores as Tauri state
            app.manage(prefs);
            app.manage(secrets);

            Ok(())
        });

    if let Err(e) = builder.run(tauri::generate_context!()) {
        eprintln!("Failed to start Quebracho: {e}");
        std::process::exit(1);
    }
}
