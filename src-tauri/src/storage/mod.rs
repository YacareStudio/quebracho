use crate::models::AppConfig;
use crate::utils::{load_app_config, save_app_config};
use std::path::PathBuf;

pub trait PrefsStore: Send + Sync {
    fn load(&self) -> Result<AppConfig, String>;
    fn save(&self, cfg: &AppConfig) -> Result<(), String>;
}

pub struct JsonPrefsStore {
    path: PathBuf,
}

impl JsonPrefsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl PrefsStore for JsonPrefsStore {
    fn load(&self) -> Result<AppConfig, String> {
        Ok(load_app_config(&self.path))
    }

    fn save(&self, cfg: &AppConfig) -> Result<(), String> {
        save_app_config(&self.path, cfg)
    }
}

pub mod secrets;
pub mod keyring;
pub mod migration;

pub use secrets::{SecretsStore, JsonSecretsStore};
pub use keyring::KeyringSecretsStore;
pub use migration::migrate_old_config;

use std::sync::Arc;

pub fn build_secrets_store(fallback_path: std::path::PathBuf) -> Arc<dyn SecretsStore> {
    match std::env::var("QUEBRACHO_FORCE_JSON_SECRETS") {
        Ok(v) if v == "1" || v == "true" => {
            eprintln!("[quebracho] QUEBRACHO_FORCE_JSON_SECRETS set; using JSON secrets file");
            return Arc::new(JsonSecretsStore::new(fallback_path));
        }
        _ => {}
    }

    match KeyringSecretsStore::new() {
        Ok(s) => {
            eprintln!("[quebracho] Using OS keychain for secrets");
            Arc::new(s)
        }
        Err(e) => {
            eprintln!("[quebracho] OS keychain unavailable ({e}), falling back to JSON secrets file");
            if let Some(parent) = fallback_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            Arc::new(JsonSecretsStore::new(fallback_path))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_prefs_store_round_trip() {
        let tmp = std::env::temp_dir().join("quebracho-test-prefs-store.json");
        let store = JsonPrefsStore::new(tmp.clone());

        let cfg = AppConfig {
            ui_language: Some("es".into()),
            terminal_shell: Some("pwsh".into()),
            color_theme: Some("dark".into()),
            file_icon_theme: Some("material".into()),
            active_provider: Some("openai".into()),
            active_model: Some("gpt-4o".into()),
            ..Default::default()
        };

        store.save(&cfg).unwrap();
        let loaded = store.load().unwrap();

        assert_eq!(loaded.ui_language, Some("es".into()));
        assert_eq!(loaded.terminal_shell, Some("pwsh".into()));
        assert_eq!(loaded.color_theme, Some("dark".into()));
        assert_eq!(loaded.file_icon_theme, Some("material".into()));
        assert_eq!(loaded.active_provider, Some("openai".into()));
        assert_eq!(loaded.active_model, Some("gpt-4o".into()));

        let _ = std::fs::remove_file(&tmp);
    }
}
