use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub trait SecretsStore: Send + Sync {
    fn get(&self, provider_id: &str) -> Result<Option<String>, String>;
    fn set(&self, provider_id: &str, key: &str) -> Result<(), String>;
    fn remove(&self, provider_id: &str) -> Result<(), String>;
    fn list(&self) -> Result<Vec<String>, String>;
    fn kind(&self) -> &'static str;
}

#[derive(Serialize, Deserialize, Default)]
struct SecretsFile {
    #[serde(default)]
    keys: HashMap<String, String>,
}

pub struct JsonSecretsStore {
    path: PathBuf,
    cache: Arc<Mutex<HashMap<String, String>>>,
    loaded: Arc<Mutex<bool>>,
}

impl JsonSecretsStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            cache: Arc::new(Mutex::new(HashMap::new())),
            loaded: Arc::new(Mutex::new(false)),
        }
    }

    fn ensure_loaded(&self) -> Result<(), String> {
        let mut loaded = self.loaded.lock().map_err(|_| "secrets loaded lock failed")?;
        if *loaded {
            return Ok(());
        }

        let cache = self.cache.lock().map_err(|_| "secrets cache lock failed")?;
        drop(cache); // drop before load to avoid deadlock

        if !self.path.exists() {
            *loaded = true;
            return Ok(());
        }

        let raw = std::fs::read_to_string(&self.path).map_err(|e| format!("read secrets: {e}"))?;
        let file: SecretsFile = serde_json::from_str(&raw).unwrap_or_default();

        let mut cache = self.cache.lock().map_err(|_| "secrets cache lock failed")?;
        for (k, v) in file.keys {
            cache.insert(k, v);
        }
        *loaded = true;
        Ok(())
    }

    fn write_through(&self) -> Result<(), String> {
        let cache = self.cache.lock().map_err(|_| "secrets cache lock failed")?;
        let file = SecretsFile {
            keys: cache.clone(),
        };
        drop(cache);

        let json = serde_json::to_string_pretty(&file).map_err(|e| format!("serialize secrets: {e}"))?;
        std::fs::write(&self.path, json).map_err(|e| format!("write secrets: {e}"))?;
        Ok(())
    }
}

impl SecretsStore for JsonSecretsStore {
    fn get(&self, provider_id: &str) -> Result<Option<String>, String> {
        self.ensure_loaded()?;
        let cache = self.cache.lock().map_err(|_| "secrets cache lock failed")?;
        Ok(cache.get(provider_id).cloned())
    }

    fn set(&self, provider_id: &str, key: &str) -> Result<(), String> {
        self.ensure_loaded()?;
        let mut cache = self.cache.lock().map_err(|_| "secrets cache lock failed")?;
        cache.insert(provider_id.to_string(), key.to_string());
        drop(cache);
        self.write_through()
    }

    fn remove(&self, provider_id: &str) -> Result<(), String> {
        self.ensure_loaded()?;
        let mut cache = self.cache.lock().map_err(|_| "secrets cache lock failed")?;
        cache.remove(provider_id);
        drop(cache);
        self.write_through()
    }

    fn list(&self) -> Result<Vec<String>, String> {
        self.ensure_loaded()?;
        let cache = self.cache.lock().map_err(|_| "secrets cache lock failed")?;
        Ok(cache.keys().cloned().collect())
    }

    fn kind(&self) -> &'static str {
        "json"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_round_trip() {
        let tmp = std::env::temp_dir().join("quebracho-test-secrets.json");
        let _ = std::fs::remove_file(&tmp);
        let store = JsonSecretsStore::new(tmp.clone());

        assert_eq!(store.get("openai").unwrap(), None);
        store.set("openai", "sk-test").unwrap();
        assert_eq!(store.get("openai").unwrap(), Some("sk-test".to_string()));
        store.remove("openai").unwrap();
        assert_eq!(store.get("openai").unwrap(), None);

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn test_list() {
        let tmp = std::env::temp_dir().join("quebracho-test-secrets-list.json");
        let _ = std::fs::remove_file(&tmp);
        let store = JsonSecretsStore::new(tmp.clone());

        store.set("a", "1").unwrap();
        store.set("b", "2").unwrap();
        let mut list = store.list().unwrap();
        list.sort();
        assert_eq!(list, vec!["a", "b"]);

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn test_missing_file_returns_empty() {
        let tmp = std::env::temp_dir().join("quebracho-test-secrets-missing.json");
        let _ = std::fs::remove_file(&tmp);
        let store = JsonSecretsStore::new(tmp.clone());
        assert_eq!(store.list().unwrap(), Vec::<String>::new());
    }

    #[test]
    fn test_malformed_json_returns_empty() {
        let tmp = std::env::temp_dir().join("quebracho-test-secrets-malformed.json");
        std::fs::write(&tmp, "not json").unwrap();
        let store = JsonSecretsStore::new(tmp.clone());
        assert_eq!(store.list().unwrap(), Vec::<String>::new());
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn test_concurrent_access() {
        let tmp = std::env::temp_dir().join("quebracho-test-secrets-concurrent.json");
        let _ = std::fs::remove_file(&tmp);
        let store = Arc::new(JsonSecretsStore::new(tmp.clone()));

        let mut handles = vec![];
        for i in 0..10 {
            let s = Arc::clone(&store);
            handles.push(thread::spawn(move || {
                s.set(&format!("provider-{i}"), &format!("key-{i}")).unwrap();
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        let list = store.list().unwrap();
        assert_eq!(list.len(), 10);

        let _ = std::fs::remove_file(&tmp);
    }
}
