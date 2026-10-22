//! Instance naming: `<name>.conf` <-> `<name>.service`, exact basename match.
//! Port of v0.4.110's backend/api/src/instance-name.ts.

use thiserror::Error;

/// Route keywords that would shadow `/instances/:name` if used as a name.
pub const RESERVED_NAMES: [&str; 5] = ["export", "import", "restart-pending", "health", "stats-summary"];

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error(
    "Invalid instance name '{0}': must match /^[A-Za-z0-9_-]{{1,64}}$/ and not be a reserved name (export, import, restart-pending, health, stats-summary)"
)]
pub struct InvalidInstanceName(pub String);

/// Names become filenames and unit names; restrict to a safe slug.
pub fn is_safe_name(name: &str) -> bool {
    (1..=64).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn validate_instance_name(name: &str) -> Result<(), InvalidInstanceName> {
    if is_safe_name(name) && !RESERVED_NAMES.contains(&name) {
        Ok(())
    } else {
        Err(InvalidInstanceName(name.to_string()))
    }
}

pub fn unit_name(instance: &str) -> String {
    format!("{instance}.service")
}

pub fn name_from_conf_filename(filename: &str) -> Option<&str> {
    filename.strip_suffix(".conf").filter(|n| is_safe_name(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(validate_instance_name("rtl_151780").is_ok());
        assert!(validate_instance_name("a-b_C9").is_ok());
        for bad in ["", "a.b", "a/b", "../x", "health", &"x".repeat(65), "é"] {
            assert!(validate_instance_name(bad).is_err(), "{bad:?}");
        }
        assert_eq!(unit_name("rtl_151"), "rtl_151.service");
        assert_eq!(name_from_conf_filename("rtl_151.conf"), Some("rtl_151"));
        assert_eq!(name_from_conf_filename("rtl 151.conf"), None);
        assert_eq!(name_from_conf_filename("rtl_151.txt"), None);
    }
}
