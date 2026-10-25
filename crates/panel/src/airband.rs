//! Which rtl_airband build an instance runs, so the UI and validation can
//! soft-lock fork-only features on a stock build. Read from the binary its
//! unit's `ExecStart=` runs (`rtl_airband -v`), cached per binary until the
//! file changes; a running instance whose control socket answers is the
//! fork whatever its version says.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

use airband_supervisor::{AirbandKind, BinaryInfo, binary_info};
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AirbandBuild {
    pub kind: AirbandKind,
    /// What `rtl_airband -v` reported.
    pub version: Option<String>,
    /// Fork capabilities and optional components, e.g. "control_socket",
    /// "device_status", "rdio_scanner". Empty for stock and unknown builds.
    pub features: Vec<String>,
    /// The binary checked: the unit's ExecStart, else the panel's
    /// RTL_PANEL_RTL_AIRBAND_BIN (what a new unit would run).
    pub binary: String,
    /// How `kind` was decided: "features-line", "fork-release",
    /// "control-socket", "stock-release", "unrecognised-version" or "not-runnable".
    pub basis: String,
}

impl AirbandBuild {
    pub fn has(&self, feature: &str) -> bool {
        self.features.iter().any(|f| f == feature)
    }

    /// The features validation holds the config to; None (check nothing)
    /// when the build couldn't be identified.
    pub fn validation_features(&self) -> Option<&[String]> {
        (self.kind != AirbandKind::Unknown).then_some(self.features.as_slice())
    }
}

type CacheKey = (Option<SystemTime>, u64);

/// `-v` output per binary path, re-read when the file's mtime or size changes.
#[derive(Default)]
pub struct BinaryCache {
    entries: Mutex<HashMap<String, (CacheKey, Option<BinaryInfo>)>>,
}

impl BinaryCache {
    pub async fn info(&self, binary: &str) -> Option<BinaryInfo> {
        let meta = tokio::fs::metadata(binary).await.ok()?;
        let key = (meta.modified().ok(), meta.len());
        if let Some((k, info)) = self.entries.lock().unwrap().get(binary)
            && *k == key
        {
            return info.clone();
        }
        let info = binary_info(Path::new(binary)).await;
        self.entries.lock().unwrap().insert(binary.to_string(), (key, info.clone()));
        info
    }
}
