//! OS keychain key store backend.
//!
//! Each record is one keychain entry, so macOS Keychain / Windows Credential
//! Manager / Linux Secret Service protect the bytes at rest. The keyring crate
//! cannot enumerate entries, so a small JSON index is kept under a reserved
//! entry to support `KeyStore.keys()`.

use std::sync::Mutex;

use keyring::Entry;

/// Service name every Aulora entry is stored under.
const SERVICE: &str = "app.aulora.desktop";
/// Reserved entry holding the JSON array of stored keys.
const INDEX_KEY: &str = "__aulora_index__";

pub struct KeychainState {
    service: String,
    lock: Mutex<()>,
}

impl KeychainState {
    pub fn new() -> Self {
        Self {
            service: SERVICE.to_string(),
            lock: Mutex::new(()),
        }
    }

    fn entry(&self, key: &str) -> keyring::Result<Entry> {
        Entry::new(&self.service, key)
    }

    pub fn get(&self, key: &str) -> keyring::Result<Option<String>> {
        match self.entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn set(&self, key: &str, value: &str) -> keyring::Result<()> {
        let _guard = self.lock();
        self.entry(key)?.set_password(value)?;
        let mut index = self.read_index();
        if !index.iter().any(|existing| existing == key) {
            index.push(key.to_string());
            self.write_index(&index)?;
        }
        Ok(())
    }

    pub fn delete(&self, key: &str) -> keyring::Result<()> {
        let _guard = self.lock();
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(error),
        }
        let mut index = self.read_index();
        index.retain(|existing| existing != key);
        self.write_index(&index)?;
        Ok(())
    }

    pub fn list(&self, prefix: Option<&str>) -> keyring::Result<Vec<String>> {
        let _guard = self.lock();
        let mut keys = self.read_index();
        keys.retain(|key| prefix.map_or(true, |prefix| key.starts_with(prefix)));
        keys.sort();
        Ok(keys)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(|poison| poison.into_inner())
    }

    fn read_index(&self) -> Vec<String> {
        let Ok(entry) = self.entry(INDEX_KEY) else {
            return Vec::new();
        };
        let Ok(raw) = entry.get_password() else {
            return Vec::new();
        };
        serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
    }

    fn write_index(&self, keys: &[String]) -> keyring::Result<()> {
        let encoded = serde_json::to_string(keys).unwrap_or_else(|_| String::from("[]"));
        self.entry(INDEX_KEY)?.set_password(&encoded)
    }
}

impl Default for KeychainState {
    fn default() -> Self {
        Self::new()
    }
}
