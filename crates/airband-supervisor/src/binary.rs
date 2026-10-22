//! Identifies which rtl_airband build a binary is: `rtl_airband -v` prints
//! `RTLSDR-Airband version <git describe>` and exits.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

pub fn parse_version_output(output: &str) -> Option<String> {
    output.lines().find_map(|l| l.trim().strip_prefix("RTLSDR-Airband version ")).map(|v| v.trim().to_string())
}

/// Runs `<binary> -v`. Starts nothing (prints and exits), so it's safe on a live system.
pub async fn binary_version(binary: &Path) -> Option<String> {
    let run = Command::new(binary).arg("-v").stdin(Stdio::null()).kill_on_drop(true).output();
    let out = tokio::time::timeout(Duration::from_secs(5), run).await.ok()?.ok()?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    parse_version_output(&text)
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
    }
}
