//! Serializes operations per instance (two overlapping saves, a save racing
//! a restart) while letting different instances proceed concurrently.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

#[derive(Default, Clone)]
pub struct KeyedMutex {
    locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
}

impl KeyedMutex {
    /// Waits for, then holds, `key`'s lock until the guard is dropped.
    pub async fn lock(&self, key: &str) -> OwnedMutexGuard<()> {
        let lock = {
            let mut locks = self.locks.lock().unwrap();
            // Drop entries nobody holds or waits on, so the map doesn't grow forever.
            locks.retain(|_, l| Arc::strong_count(l) > 1);
            locks.entry(key.to_string()).or_default().clone()
        };
        lock.lock_owned().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn same_key_serializes_other_keys_do_not() {
        let m = KeyedMutex::default();
        let held = m.lock("a").await;
        // A different key is free.
        let _b = tokio::time::timeout(Duration::from_millis(50), m.lock("b")).await.expect("other key not blocked");
        // The same key waits until the first guard drops.
        assert!(tokio::time::timeout(Duration::from_millis(50), m.lock("a")).await.is_err());
        drop(held);
        let _a = tokio::time::timeout(Duration::from_millis(50), m.lock("a")).await.expect("released");
    }
}
