//! Identifies which rtl_airband build a binary is: `rtl_airband -v` prints
//! `RTLSDR-Airband version <git describe>` and exits. The jschmall fork
//! (v6.5.0+) adds a `Features: fork control_socket ...` line, which is how
//! a fork build is told from a stock one now that both use v6.x versions.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use ts_rs::TS;

pub fn parse_version_output(output: &str) -> Option<String> {
    output.lines().find_map(|l| l.trim().strip_prefix("RTLSDR-Airband version ")).map(|v| v.trim().to_string())
}

/// What `rtl_airband -v` printed.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BinaryInfo {
    pub version: Option<String>,
    /// The fork's `Features:` line, if any.
    pub features: Option<Vec<String>>,
}

pub fn parse_binary_output(output: &str) -> BinaryInfo {
    BinaryInfo {
        version: parse_version_output(output),
        features: output
            .lines()
            .find_map(|l| l.trim().strip_prefix("Features:"))
            .map(|f| f.split_whitespace().map(String::from).collect()),
    }
}

/// Runs `<binary> -v`. None when it can't run or doesn't look like
/// rtl_airband. Starts nothing (prints and exits), so it's safe on a live system.
pub async fn binary_info(binary: &Path) -> Option<BinaryInfo> {
    let run = Command::new(binary).arg("-v").stdin(Stdio::null()).kill_on_drop(true).output();
    let out = tokio::time::timeout(Duration::from_secs(5), run).await.ok()?.ok()?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let info = parse_binary_output(&text);
    (info.version.is_some() || info.features.is_some()).then_some(info)
}

pub async fn binary_version(binary: &Path) -> Option<String> {
    binary_info(binary).await?.version
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum AirbandKind {
    /// The jschmall/RTLSDR-Airband fork the panel is developed against.
    Fork,
    /// A build without the fork's features (upstream, or another fork).
    Stock,
    /// Couldn't tell (binary missing, not runnable, or an ambiguous
    /// version): nothing is locked.
    Unknown,
}

/// Fork releases from before `-v` printed a Features line. Upstream has
/// no tags in this range yet; every later fork release prints the line.
pub const LEGACY_FORK_TAGS: &[&str] = &["v6.3.0", "v6.3.1", "v6.4.0"];

/// What a fork build without a Features line supports (v6.4.0 adds
/// `device_status`, its control-socket `status` command).
pub const LEGACY_FORK_FEATURES: &[&str] = &[
    "fork",
    "control_socket",
    "reserve",
    "mixer_remote",
    "send_tx_tags",
    "stats_http",
    "json_log",
    "post_write_script",
    "rdio_scanner",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classification {
    pub kind: AirbandKind,
    pub features: Vec<String>,
    /// How it was decided: "features-line", "fork-release", "stock-release",
    /// "unrecognised-version" or "not-runnable".
    pub basis: &'static str,
}

/// Splits `git describe` output into its tag and whether commits follow it:
/// `v6.2.0-45-gabc1234-dirty` -> ("v6.2.0", true).
fn describe_base(version: &str) -> (&str, bool) {
    let v = version.strip_suffix("-dirty").unwrap_or(version);
    let mut parts = v.rsplitn(3, '-');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(hash), Some(count), Some(tag))
            if hash.starts_with('g') && hash.len() > 1 && count.bytes().all(|b| b.is_ascii_digit()) =>
        {
            (tag, true)
        }
        _ => (v, v.len() != version.len()),
    }
}

fn is_release_version(tag: &str) -> bool {
    let nums: Vec<&str> = tag.strip_prefix('v').unwrap_or(tag).split('.').collect();
    (2..=3).contains(&nums.len()) && nums.iter().all(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

pub fn legacy_fork_features(tag: &str) -> Vec<String> {
    let mut features: Vec<String> = LEGACY_FORK_FEATURES.iter().map(|s| s.to_string()).collect();
    if tag == "v6.4.0" {
        features.push("device_status".into());
    }
    features
}

/// Decides what a binary is from its `-v` output (None: it couldn't be run).
/// Errs towards Unknown, which locks nothing: a build of some commit after
/// an upstream tag could be a fork build from before the Features line.
pub fn classify(info: Option<&BinaryInfo>) -> Classification {
    let Some(info) = info else {
        return Classification { kind: AirbandKind::Unknown, features: Vec::new(), basis: "not-runnable" };
    };
    if let Some(features) = info.features.as_ref().filter(|f| f.iter().any(|x| x == "fork")) {
        return Classification { kind: AirbandKind::Fork, features: features.clone(), basis: "features-line" };
    }
    let Some(version) = info.version.as_deref() else {
        return Classification { kind: AirbandKind::Unknown, features: Vec::new(), basis: "unrecognised-version" };
    };
    let (tag, after_tag) = describe_base(version);
    if LEGACY_FORK_TAGS.contains(&tag) {
        return Classification { kind: AirbandKind::Fork, features: legacy_fork_features(tag), basis: "fork-release" };
    }
    if !after_tag && is_release_version(tag) {
        return Classification { kind: AirbandKind::Stock, features: Vec::new(), basis: "stock-release" };
    }
    Classification { kind: AirbandKind::Unknown, features: Vec::new(), basis: "unrecognised-version" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_git_describe_versions() {
        assert_eq!(parse_version_output("RTLSDR-Airband version v6.3.0\n").as_deref(), Some("v6.3.0"));
        assert_eq!(
            parse_version_output("RTLSDR-Airband version v6.3.0-3-g12f1834-dirty\n").as_deref(),
            Some("v6.3.0-3-g12f1834-dirty")
        );
        assert_eq!(parse_version_output("rtl_airband: invalid option\n"), None);
    }

    #[tokio::test]
    async fn missing_binary_has_no_version() {
        assert_eq!(binary_version(Path::new("/nonexistent/rtl_airband")).await, None);
        assert_eq!(binary_info(Path::new("/nonexistent/rtl_airband")).await, None);
    }

    fn info(version: Option<&str>, features: Option<&str>) -> BinaryInfo {
        BinaryInfo {
            version: version.map(String::from),
            features: features.map(|f| f.split_whitespace().map(String::from).collect()),
        }
    }

    #[test]
    fn parses_the_features_line() {
        let out = "RTLSDR-Airband version v6.5.0\nFeatures: fork control_socket nfm\n";
        assert_eq!(parse_binary_output(out), info(Some("v6.5.0"), Some("fork control_socket nfm")));
        assert_eq!(parse_binary_output("RTLSDR-Airband version 5.1.1\n").features, None);
    }

    #[test]
    fn features_line_marks_the_fork() {
        let c = classify(Some(&info(Some("v6.5.0-2-gabcdef0"), Some("fork control_socket device_status"))));
        assert_eq!((c.kind, c.basis), (AirbandKind::Fork, "features-line"));
        assert!(c.features.contains(&"device_status".to_string()));
    }

    #[test]
    fn legacy_fork_releases_are_recognised_by_tag() {
        let c = classify(Some(&info(Some("v6.4.0"), None)));
        assert_eq!((c.kind, c.basis), (AirbandKind::Fork, "fork-release"));
        assert!(c.features.contains(&"device_status".to_string()));
        let c = classify(Some(&info(Some("v6.3.1-4-g1234abc-dirty"), None)));
        assert_eq!(c.kind, AirbandKind::Fork);
        assert!(!c.features.contains(&"device_status".to_string()));
    }

    #[test]
    fn plain_release_versions_without_features_are_stock() {
        for v in ["v6.2.0", "5.1.1", "v5.4.5", "v7.0"] {
            let c = classify(Some(&info(Some(v), None)));
            assert_eq!((c.kind, c.basis), (AirbandKind::Stock, "stock-release"), "{v}");
            assert!(c.features.is_empty());
        }
    }

    #[test]
    fn ambiguous_builds_are_unknown() {
        // A fork built from source before v6.3.0 describes against an upstream tag.
        for v in ["v6.2.0-45-g12f1834", "v6.2.0-dirty", "unknown", "abc1234"] {
            assert_eq!(classify(Some(&info(Some(v), None))).kind, AirbandKind::Unknown, "{v}");
        }
        assert_eq!(classify(None).basis, "not-runnable");
        assert_eq!(classify(Some(&info(None, Some("control_socket")))).kind, AirbandKind::Unknown);
    }
}
