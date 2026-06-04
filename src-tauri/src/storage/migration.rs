use crate::storage::SecretsStore;
use serde_json::Value;
use std::path::Path;

pub fn migrate_old_config(config_path: &Path, secrets: &dyn SecretsStore) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let raw = std::fs::read_to_string(config_path).map_err(|e| format!("read config: {e}"))?;
    let mut value: Value = serde_json::from_str(&raw).map_err(|e| format!("parse config: {e}"))?;

    let Some(obj) = value.as_object_mut() else {
        return Ok(());
    };

    let ai_keys = match obj.get("aiKeys") {
        Some(Value::Null) => {
            obj.remove("aiKeys");
            let new_raw = serde_json::to_string_pretty(&value).map_err(|e| format!("serialize: {e}"))?;
            std::fs::write(config_path, new_raw).map_err(|e| format!("write config: {e}"))?;
            return Ok(());
        }
        Some(Value::Object(m)) => m.clone(),
        _ => return Ok(()),
    };

    // Migrate keys
    for (provider_id, key_value) in ai_keys {
        if let Some(key) = key_value.as_str() {
            secrets.set(&provider_id, key)?;
        }
    }

    // Remove aiKeys from config and rewrite
    obj.remove("aiKeys");
    let new_raw = serde_json::to_string_pretty(&value).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(config_path, new_raw).map_err(|e| format!("write config: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{JsonSecretsStore, SecretsStore};
    use serde_json::json;

    #[test]
    fn test_migrate_with_ai_keys() {
        let config_tmp = std::env::temp_dir().join("quebracho-test-migrate-config.json");
        let secrets_tmp = std::env::temp_dir().join("quebracho-test-migrate-secrets.json");
        let _ = std::fs::remove_file(&config_tmp);
        let _ = std::fs::remove_file(&secrets_tmp);

        let old_config = json!({
            "uiLanguage": "es",
            "aiKeys": {
                "openai": "sk-test",
                "anthropic": "sk-ant"
            }
        });
        std::fs::write(&config_tmp, old_config.to_string()).unwrap();

        let secrets = JsonSecretsStore::new(secrets_tmp.clone());
        migrate_old_config(&config_tmp, &secrets).unwrap();

        assert_eq!(secrets.get("openai").unwrap(), Some("sk-test".to_string()));
        assert_eq!(secrets.get("anthropic").unwrap(), Some("sk-ant".to_string()));

        let migrated_raw = std::fs::read_to_string(&config_tmp).unwrap();
        let migrated: Value = serde_json::from_str(&migrated_raw).unwrap();
        assert!(migrated.get("aiKeys").is_none());
        assert_eq!(migrated.get("uiLanguage").unwrap().as_str(), Some("es"));

        let _ = std::fs::remove_file(&config_tmp);
        let _ = std::fs::remove_file(&secrets_tmp);
    }

    #[test]
    fn test_migrate_without_ai_keys_is_noop() {
        let config_tmp = std::env::temp_dir().join("quebracho-test-migrate-noop.json");
        let secrets_tmp = std::env::temp_dir().join("quebracho-test-migrate-noop-secrets.json");
        let _ = std::fs::remove_file(&config_tmp);
        let _ = std::fs::remove_file(&secrets_tmp);

        let config = json!({
            "uiLanguage": "en",
            "colorTheme": "dark"
        });
        std::fs::write(&config_tmp, config.to_string()).unwrap();

        let secrets = JsonSecretsStore::new(secrets_tmp.clone());
        migrate_old_config(&config_tmp, &secrets).unwrap();

        assert_eq!(secrets.list().unwrap(), Vec::<String>::new());

        let raw = std::fs::read_to_string(&config_tmp).unwrap();
        let after: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(after, config);

        let _ = std::fs::remove_file(&config_tmp);
        let _ = std::fs::remove_file(&secrets_tmp);
    }

    #[test]
    fn test_migrate_is_idempotent() {
        let config_tmp = std::env::temp_dir().join("quebracho-test-migrate-idempotent.json");
        let secrets_tmp = std::env::temp_dir().join("quebracho-test-migrate-idempotent-secrets.json");
        let _ = std::fs::remove_file(&config_tmp);
        let _ = std::fs::remove_file(&secrets_tmp);

        let old_config = json!({
            "aiKeys": {
                "openai": "sk-test"
            }
        });
        std::fs::write(&config_tmp, old_config.to_string()).unwrap();

        let secrets = JsonSecretsStore::new(secrets_tmp.clone());

        // First migration
        migrate_old_config(&config_tmp, &secrets).unwrap();
        assert_eq!(secrets.get("openai").unwrap(), Some("sk-test".to_string()));

        // Second migration (idempotent)
        migrate_old_config(&config_tmp, &secrets).unwrap();
        assert_eq!(secrets.get("openai").unwrap(), Some("sk-test".to_string()));

        let raw = std::fs::read_to_string(&config_tmp).unwrap();
        let after: Value = serde_json::from_str(&raw).unwrap();
        assert!(after.get("aiKeys").is_none());

        let _ = std::fs::remove_file(&config_tmp);
        let _ = std::fs::remove_file(&secrets_tmp);
    }

    #[test]
    fn test_migrate_null_ai_keys() {
        let config_tmp = std::env::temp_dir().join("quebracho-test-migrate-null.json");
        let secrets_tmp = std::env::temp_dir().join("quebracho-test-migrate-null-secrets.json");
        let _ = std::fs::remove_file(&config_tmp);
        let _ = std::fs::remove_file(&secrets_tmp);

        let config = json!({
            "uiLanguage": "es",
            "aiKeys": null
        });
        std::fs::write(&config_tmp, config.to_string()).unwrap();

        let secrets = JsonSecretsStore::new(secrets_tmp.clone());
        migrate_old_config(&config_tmp, &secrets).unwrap();

        assert_eq!(secrets.list().unwrap(), Vec::<String>::new());

        let raw = std::fs::read_to_string(&config_tmp).unwrap();
        let after: Value = serde_json::from_str(&raw).unwrap();
        assert!(after.get("aiKeys").is_none());

        let _ = std::fs::remove_file(&config_tmp);
        let _ = std::fs::remove_file(&secrets_tmp);
    }
}
