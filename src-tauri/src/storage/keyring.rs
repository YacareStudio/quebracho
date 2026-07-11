use crate::storage::SecretsStore;

const SERVICE: &str = "com.yacarestudio.quebracho";

pub struct KeyringSecretsStore;

impl KeyringSecretsStore {
    pub fn new() -> Result<Self, String> {
        // keyring 4.1 (feature `v1`, the default) registers the OS-native
        // credential store automatically on the first `Entry::new()` call.
        // Probe the OS keychain by creating a dummy entry; if the backend is
        // unavailable the caller falls back to the JSON secrets file.
        let probe = keyring::Entry::new(SERVICE, "__probe__")
            .map_err(|e| format!("keychain entry creation failed: {e}"))?;
        match probe.set_password("probe") {
            Ok(_) => {
                let _ = probe.delete_credential();
                Ok(Self)
            }
            Err(e) => Err(format!("keychain probe failed: {e}")),
        }
    }
}

impl SecretsStore for KeyringSecretsStore {
    fn get(&self, provider_id: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(SERVICE, provider_id).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, provider_id: &str, key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, provider_id).map_err(|e| e.to_string())?;
        entry.set_password(key).map_err(|e| e.to_string())
    }

    fn remove(&self, provider_id: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SERVICE, provider_id).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    fn list(&self) -> Result<Vec<String>, String> {
        // Best-effort: we cannot enumerate the OS keychain generically.
        // Return an empty list; the UI should treat "configured" as any
        // provider for which `get` returns Some(...).
        Ok(vec![])
    }

    fn kind(&self) -> &'static str {
        "keyring"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_env_var_forces_json_fallback() {
        std::env::set_var("QUEBRACHO_FORCE_JSON_SECRETS", "1");

        let tmp = std::env::temp_dir().join("quebracho-test-env-fallback.json");
        let _ = std::fs::remove_file(&tmp);

        // This should return JsonSecretsStore when the env var is set
        let store = crate::storage::build_secrets_store(tmp.clone());
        assert_eq!(store.kind(), "json");

        // Verify it actually works
        store.set("test", "value").unwrap();
        assert_eq!(store.get("test").unwrap(), Some("value".to_string()));

        let _ = std::fs::remove_file(&tmp);
        std::env::remove_var("QUEBRACHO_FORCE_JSON_SECRETS");
    }

    #[test]
    fn test_keyring_probe_skipped_in_ci() {
        if std::env::var("CI").is_ok() {
            // Skip in CI where no keychain is available
            return;
        }

        // On local dev machines, try to create a keyring store.
        // This may fail if the OS keychain is locked or unavailable;
        // we just verify it doesn't panic.
        let _ = KeyringSecretsStore::new();
    }
}
