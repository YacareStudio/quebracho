use crate::models::AppConfig;
use crate::utils::{load_app_config, save_app_config};
use std::path::PathBuf;

pub trait SettingsStore: Send + Sync {
    fn load(&self) -> Result<AppConfig, String>;
    fn save(&self, cfg: &AppConfig) -> Result<(), String>;
}

pub struct JsonSettingsStore {
    path: PathBuf,
}

impl JsonSettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl SettingsStore for JsonSettingsStore {
    fn load(&self) -> Result<AppConfig, String> {
        Ok(load_app_config(&self.path))
    }

    fn save(&self, cfg: &AppConfig) -> Result<(), String> {
        save_app_config(&self.path, cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_json_settings_store_round_trip() {
        let tmp = std::env::temp_dir().join("quebracho-test-settings-store.json");
        let store = JsonSettingsStore::new(tmp.clone());

        let cfg = AppConfig {
            ui_language: Some("es".into()),
            terminal_shell: Some("pwsh".into()),
            color_theme: Some("dark".into()),
            file_icon_theme: Some("material".into()),
            active_provider: Some("openai".into()),
            active_model: Some("gpt-4o".into()),
            ai_keys: {
                let mut m = HashMap::new();
                m.insert("test".into(), "sk-test".into());
                m
            },
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
        assert_eq!(loaded.ai_keys.get("test"), Some(&"sk-test".into()));

        let _ = std::fs::remove_file(&tmp);
    }
}
