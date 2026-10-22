//! On-disk state under the instances directory, in the same formats the
//! TypeScript backend used (so the Rust panel can take over an existing
//! directory): `<name>.conf`, `.backups/<name>/`, `.pending-restarts.json`,
//! `.instance-options.json`. New: `.running/`, the config each running
//! process was started with and currently has applied (live-apply planning).

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use airband_config::{ConfigError, RtlAirbandConfig, parse_config_file, serialize_config_file};
use airband_supervisor::instance::name_from_conf_filename;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Parse(#[from] ConfigError),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

/// Short content hash used as an optimistic-concurrency version (ETag), not for security.
pub fn hash_config_text(raw: &str) -> String {
    let digest = Sha256::digest(raw.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// Approximates JavaScript's `localeCompare` (ICU root collation) for the
/// instance-name charset: '_' < '-' < digits < letters, letters compared
/// case-insensitively first, lowercase before uppercase as a tiebreak.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    fn primary(c: char) -> (u8, char) {
        match c {
            '_' => (0, c),
            '-' => (1, c),
            '0'..='9' => (2, c),
            c if c.is_ascii_alphabetic() => (3, c.to_ascii_lowercase()),
            c => (4, c),
        }
    }
    let pa = a.chars().map(primary);
    let pb = b.chars().map(primary);
    pa.cmp(pb).then_with(|| {
        let tertiary = |s: &str| s.chars().map(|c| c.is_ascii_uppercase()).collect::<Vec<_>>();
        tertiary(a).cmp(&tertiary(b))
    })
}

/// Unique-enough suffix for temp/backup files (two overlapping writes must never collide).
fn unique_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{}-{nanos}-{}", std::process::id(), COUNTER.fetch_add(1, AtomicOrdering::Relaxed))
}

/// Writes via a temp file + rename so a crash can never leave a truncated file.
async fn write_atomic(target: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = PathBuf::from(format!("{}.tmp-{}", target.display(), unique_suffix()));
    tokio::fs::write(&tmp, contents).await?;
    if let Err(e) = tokio::fs::rename(&tmp, target).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    Ok(())
}

fn utc_stamp() -> String {
    let secs = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default();
    let (days, rem) = (secs.as_secs() / 86_400, secs.as_secs() % 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}-{:02}-{:02}-{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        secs.subsec_millis()
    )
}

/// Days since 1970-01-01 -> (year, month, day), proleptic Gregorian.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

// ----------------------------------------------------------------- configs

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceFileInfo {
    pub name: String,
    pub conf_path: String,
}

#[derive(Clone)]
pub struct CachedConfig {
    pub raw: Arc<String>,
    pub config: Arc<RtlAirbandConfig>,
    pub version: String,
}

struct CacheEntry {
    mtime: Option<SystemTime>,
    size: u64,
    value: Result<CachedConfig, String>,
}

const BACKUP_DIR_NAME: &str = ".backups";
const MAX_BACKUPS_PER_INSTANCE: usize = 10;

/// File I/O over the .conf directory, with parses cached by mtime + size.
pub struct ConfigStore {
    dir: PathBuf,
    cache: Mutex<HashMap<String, CacheEntry>>,
}

impl ConfigStore {
    pub fn new(dir: impl Into<PathBuf>) -> ConfigStore {
        ConfigStore { dir: dir.into(), cache: Mutex::new(HashMap::new()) }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn conf_path(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{name}.conf"))
    }

    pub async fn list(&self) -> Result<Vec<InstanceFileInfo>, StoreError> {
        let mut entries = match tokio::fs::read_dir(&self.dir).await {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut infos = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if let Some(name) = name_from_conf_filename(&file_name) {
                infos.push(InstanceFileInfo {
                    name: name.to_string(),
                    conf_path: self.dir.join(&file_name).display().to_string(),
                });
            }
        }
        infos.sort_by(|a, b| locale_compare(&a.name, &b.name));
        Ok(infos)
    }

    pub async fn exists(&self, name: &str) -> bool {
        tokio::fs::metadata(self.conf_path(name)).await.is_ok()
    }

    /// The parsed config, re-read only when the file's mtime/size changed.
    pub async fn read(&self, name: &str) -> Result<CachedConfig, StoreError> {
        let path = self.conf_path(name);
        let meta = tokio::fs::metadata(&path).await?;
        let (mtime, size) = (meta.modified().ok(), meta.len());
        if let Some(entry) = self.cache.lock().unwrap().get(name)
            && entry.mtime.is_some()
            && entry.mtime == mtime
            && entry.size == size
        {
            return entry
                .value
                .clone()
                .map_err(|e| StoreError::Parse(ConfigError::Domain { message: e, path: "$".into() }));
        }
        let raw = tokio::fs::read_to_string(&path).await?;
        let parsed = parse_config_file(&raw);
        let value = parsed.as_ref().map_err(|e| e.to_string()).map(|config| CachedConfig {
            version: hash_config_text(&raw),
            raw: Arc::new(raw.clone()),
            config: Arc::new(config.clone()),
        });
        self.cache.lock().unwrap().insert(name.to_string(), CacheEntry { mtime, size, value: value.clone() });
        match parsed {
            Ok(_) => Ok(value.expect("parsed ok")),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn read_raw(&self, name: &str) -> Result<String, StoreError> {
        Ok(tokio::fs::read_to_string(self.conf_path(name)).await?)
    }

    /// Backs up the current file, then writes atomically. Returns the new version.
    pub async fn write(&self, name: &str, config: &RtlAirbandConfig) -> Result<(String, String), StoreError> {
        self.backup_before_overwrite(name).await?;
        let text = serialize_config_file(config);
        write_atomic(&self.conf_path(name), &text).await?;
        self.cache.lock().unwrap().remove(name);
        Ok((hash_config_text(&text), text))
    }

    pub async fn remove(&self, name: &str) -> Result<(), StoreError> {
        match tokio::fs::remove_file(self.conf_path(name)).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        self.cache.lock().unwrap().remove(name);
        Ok(())
    }

    async fn backup_before_overwrite(&self, name: &str) -> Result<(), StoreError> {
        let existing = match self.read_raw(name).await {
            Ok(text) => text,
            Err(StoreError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e),
        };
        let backup_dir = self.dir.join(BACKUP_DIR_NAME).join(name);
        tokio::fs::create_dir_all(&backup_dir).await?;
        let file = backup_dir.join(format!("{}-{}.conf", utc_stamp(), unique_suffix()));
        tokio::fs::write(&file, existing).await?;

        let mut names = Vec::new();
        let mut entries = tokio::fs::read_dir(&backup_dir).await?;
        while let Some(e) = entries.next_entry().await? {
            let n = e.file_name().to_string_lossy().to_string();
            if n.ends_with(".conf") {
                names.push(n);
            }
        }
        names.sort();
        let excess = names.len().saturating_sub(MAX_BACKUPS_PER_INSTANCE);
        for n in &names[..excess] {
            let _ = tokio::fs::remove_file(backup_dir.join(n)).await;
        }
        Ok(())
    }
}

// ---------------------------------------------------------- pending restart

/// Instances whose .conf on disk is ahead of what their process has loaded.
pub struct PendingRestartStore {
    path: PathBuf,
    state: AsyncMutex<Option<HashSet<String>>>,
}

impl PendingRestartStore {
    pub fn new(dir: &Path) -> PendingRestartStore {
        PendingRestartStore { path: dir.join(".pending-restarts.json"), state: AsyncMutex::new(None) }
    }

    async fn loaded<'a>(
        &self,
        guard: &'a mut tokio::sync::MutexGuard<'_, Option<HashSet<String>>>,
    ) -> Result<&'a mut HashSet<String>, StoreError> {
        if guard.is_none() {
            let set = match tokio::fs::read_to_string(&self.path).await {
                Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw)? {
                    serde_json::Value::Array(items) => {
                        items.into_iter().filter_map(|v| v.as_str().map(str::to_string)).collect()
                    }
                    _ => HashSet::new(),
                },
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashSet::new(),
                Err(e) => return Err(e.into()),
            };
            **guard = Some(set);
        }
        Ok(guard.as_mut().unwrap())
    }

    pub async fn has(&self, name: &str) -> Result<bool, StoreError> {
        let mut g = self.state.lock().await;
        Ok(self.loaded(&mut g).await?.contains(name))
    }

    pub async fn mark(&self, name: &str) -> Result<(), StoreError> {
        let mut g = self.state.lock().await;
        let set = self.loaded(&mut g).await?;
        if set.insert(name.to_string()) {
            self.persist(set).await?;
        }
        Ok(())
    }

    pub async fn clear(&self, name: &str) -> Result<(), StoreError> {
        let mut g = self.state.lock().await;
        let set = self.loaded(&mut g).await?;
        if set.remove(name) {
            self.persist(set).await?;
        }
        Ok(())
    }

    async fn persist(&self, set: &HashSet<String>) -> Result<(), StoreError> {
        let mut names: Vec<&String> = set.iter().collect();
        names.sort_by(|a, b| locale_compare(a, b));
        Ok(write_atomic(&self.path, &serde_json::to_string(&names)?).await?)
    }
}

// --------------------------------------------------------- instance options

/// Panel-only per-instance settings that shape the generated unit file.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceOptions {
    /// Adds `-j` (JSON logs) to ExecStart.
    pub json_logging: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_group: Option<String>,
}

/// A PATCH: `Some(None)` clears an account back to unset.
#[derive(Debug, Clone, Default)]
pub struct InstanceOptionsPatch {
    pub json_logging: Option<bool>,
    pub service_user: Option<Option<String>>,
    pub service_group: Option<Option<String>>,
}

pub struct InstanceOptionsStore {
    path: PathBuf,
    state: AsyncMutex<Option<HashMap<String, InstanceOptions>>>,
}

impl InstanceOptionsStore {
    pub fn new(dir: &Path) -> InstanceOptionsStore {
        InstanceOptionsStore { path: dir.join(".instance-options.json"), state: AsyncMutex::new(None) }
    }

    async fn loaded<'a>(
        &self,
        guard: &'a mut tokio::sync::MutexGuard<'_, Option<HashMap<String, InstanceOptions>>>,
    ) -> Result<&'a mut HashMap<String, InstanceOptions>, StoreError> {
        if guard.is_none() {
            let mut map = HashMap::new();
            match tokio::fs::read_to_string(&self.path).await {
                Ok(raw) => {
                    if let serde_json::Value::Object(obj) = serde_json::from_str::<serde_json::Value>(&raw)? {
                        for (name, v) in obj {
                            let s = |k: &str| {
                                v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(str::to_string)
                            };
                            map.insert(
                                name,
                                InstanceOptions {
                                    json_logging: v.get("jsonLogging").and_then(|x| x.as_bool()) == Some(true),
                                    service_user: s("serviceUser"),
                                    service_group: s("serviceGroup"),
                                },
                            );
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
            **guard = Some(map);
        }
        Ok(guard.as_mut().unwrap())
    }

    pub async fn get(&self, name: &str) -> Result<InstanceOptions, StoreError> {
        let mut g = self.state.lock().await;
        Ok(self.loaded(&mut g).await?.get(name).cloned().unwrap_or_default())
    }

    pub async fn set(&self, name: &str, patch: InstanceOptionsPatch) -> Result<InstanceOptions, StoreError> {
        let mut g = self.state.lock().await;
        let map = self.loaded(&mut g).await?;
        let mut merged = map.get(name).cloned().unwrap_or_default();
        if let Some(j) = patch.json_logging {
            merged.json_logging = j;
        }
        if let Some(u) = patch.service_user {
            merged.service_user = u;
        }
        if let Some(gr) = patch.service_group {
            merged.service_group = gr;
        }
        map.insert(name.to_string(), merged.clone());
        self.persist(map).await?;
        Ok(merged)
    }

    pub async fn remove(&self, name: &str) -> Result<(), StoreError> {
        let mut g = self.state.lock().await;
        let map = self.loaded(&mut g).await?;
        if map.remove(name).is_some() {
            self.persist(map).await?;
        }
        Ok(())
    }

    pub async fn rename(&self, name: &str, new_name: &str) -> Result<(), StoreError> {
        let mut g = self.state.lock().await;
        let map = self.loaded(&mut g).await?;
        if let Some(existing) = map.remove(name) {
            map.insert(new_name.to_string(), existing);
            self.persist(map).await?;
        }
        Ok(())
    }

    async fn persist(&self, map: &HashMap<String, InstanceOptions>) -> Result<(), StoreError> {
        let mut names: Vec<&String> = map.keys().collect();
        names.sort_by(|a, b| locale_compare(a, b));
        // serde_json::Map keeps insertion order only with preserve_order; build the text directly.
        let body: Vec<String> = names
            .iter()
            .map(|n| Ok(format!("{}:{}", serde_json::to_string(n)?, serde_json::to_string(&map[*n])?)))
            .collect::<Result<_, serde_json::Error>>()?;
        Ok(write_atomic(&self.path, &format!("{{{}}}", body.join(","))).await?)
    }
}

// ---------------------------------------------------------------- baselines

/// What a running instance's process has loaded, for live-apply planning:
/// the config text it was (re)started with, and the text after any live
/// applies since.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Baseline {
    pub started: String,
    pub applied: String,
}

pub struct BaselineStore {
    dir: PathBuf,
}

impl BaselineStore {
    pub fn new(instances_dir: &Path) -> BaselineStore {
        BaselineStore { dir: instances_dir.join(".running") }
    }

    fn path(&self, name: &str, which: &str) -> PathBuf {
        self.dir.join(format!("{name}.{which}.conf"))
    }

    pub async fn get(&self, name: &str) -> Option<Baseline> {
        let started = tokio::fs::read_to_string(self.path(name, "started")).await.ok()?;
        let applied = tokio::fs::read_to_string(self.path(name, "applied")).await.unwrap_or_else(|_| started.clone());
        Some(Baseline { started, applied })
    }

    /// The process was just (re)started with `text`.
    pub async fn set_started(&self, name: &str, text: &str) -> Result<(), StoreError> {
        tokio::fs::create_dir_all(&self.dir).await?;
        write_atomic(&self.path(name, "started"), text).await?;
        write_atomic(&self.path(name, "applied"), text).await?;
        Ok(())
    }

    /// A live apply fully brought the process up to `text`.
    pub async fn set_applied(&self, name: &str, text: &str) -> Result<(), StoreError> {
        tokio::fs::create_dir_all(&self.dir).await?;
        Ok(write_atomic(&self.path(name, "applied"), text).await?)
    }

    pub async fn remove(&self, name: &str) {
        let _ = tokio::fs::remove_file(self.path(name, "started")).await;
        let _ = tokio::fs::remove_file(self.path(name, "applied")).await;
    }
}

/// Deterministic JSON object text with keys sorted (for label sets).
pub fn canonical_labels(labels: &BTreeMap<String, String>) -> String {
    serde_json::to_string(labels).expect("string map serializes")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_order_matches_icu_for_instance_names() {
        let mut names = vec!["rtl_b", "RTL_a", "rtl_a", "rtl-a", "rtl_1", "rtl_10", "rtl_2", "Zed", "abc"];
        names.sort_by(|a, b| locale_compare(a, b));
        // Verified against Node's Array.prototype.sort((a, b) => a.localeCompare(b)).
        assert_eq!(names, ["abc", "rtl_1", "rtl_10", "rtl_2", "rtl_a", "RTL_a", "rtl_b", "rtl-a", "Zed"]);
    }

    #[test]
    fn version_hash_matches_ts() {
        // Node: createHash("sha256").update("hello\n").digest("hex").slice(0, 16)
        assert_eq!(hash_config_text("hello\n"), "5891b5b522d5df08");
    }

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_748), (2026, 10, 22));
    }
}
