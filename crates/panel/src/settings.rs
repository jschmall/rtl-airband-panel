//! Panel settings. Every option is a CLI flag and an `RTL_PANEL_*`
//! environment variable (also loadable from a .env file), mirroring
//! v0.4.110's backend/api's config.ts/cli.ts. Precedence, highest first: flags, real
//! environment variables, the .env file, defaults.

use std::net::IpAddr;
use std::path::PathBuf;

use clap::{Parser, ValueEnum};

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum SystemdMode {
    /// Simulates systemd actions without touching the system.
    Mock,
    /// Runs `sudo -n systemctl ...` for real (see deploy/rtl-airband-panel.sudoers).
    Sudo,
}

#[derive(Debug, Clone, Parser)]
#[command(name = "rtl-airband-panel", version, about = "Web control panel for RTLSDR-Airband instances")]
pub struct Settings {
    /// Directory containing per-instance .conf files.
    #[arg(long, env = "RTL_PANEL_INSTANCES_DIR", default_value = "/etc/rtl-airband-panel/instances")]
    pub instances_dir: PathBuf,

    /// Where systemd unit files are installed.
    #[arg(long, env = "RTL_PANEL_UNIT_DIR", default_value = "/etc/systemd/system")]
    pub unit_dir: String,

    /// rtl_airband binary referenced by generated unit files.
    #[arg(long = "rtl-airband-bin", env = "RTL_PANEL_RTL_AIRBAND_BIN", default_value = "/usr/local/bin/rtl_airband")]
    pub rtl_airband_bin: String,

    /// mock (no real systemctl calls) or sudo.
    #[arg(long, env = "RTL_PANEL_SYSTEMD_MODE", value_enum, default_value = "mock", ignore_case = true)]
    pub systemd_mode: SystemdMode,

    /// In sudo mode, only act on units named <prefix>*.service.
    #[arg(long, env = "RTL_PANEL_SUDO_UNIT_PREFIX", default_value = "")]
    pub sudo_unit_prefix: String,

    /// Account generated unit files run instances as (User=/Group=) when an
    /// instance has no per-instance override. Empty: no User= line. The
    /// control socket only accepts same-UID peers, so set this to the
    /// panel's own user for live apply to work.
    #[arg(long, env = "RTL_PANEL_DEFAULT_SERVICE_USER", default_value = "")]
    pub default_service_user: String,

    #[arg(long, env = "RTL_PANEL_DEFAULT_SERVICE_GROUP", default_value = "")]
    pub default_service_group: String,

    #[arg(long, env = "RTL_PANEL_PORT", default_value_t = 3000)]
    pub port: u16,

    #[arg(long, env = "RTL_PANEL_HOST", default_value = "127.0.0.1")]
    pub host: IpAddr,

    /// Extra host names (comma-separated) a loopback-bound panel answers
    /// to, e.g. a reverse proxy's public name passed through as `Host`.
    /// Loopback names are always allowed.
    #[arg(long, env = "RTL_PANEL_ALLOWED_HOSTS", value_delimiter = ',')]
    pub allowed_hosts: Vec<String>,

    /// HTTP Basic auth password. Required when --host isn't a loopback
    /// address (unless --allow-unauthenticated).
    #[arg(long, env = "RTL_PANEL_PASSWORD", hide_env_values = true)]
    pub password: Option<String>,

    #[arg(long, env = "RTL_PANEL_USERNAME", default_value = "admin")]
    pub username: String,

    /// Serve without auth on a non-loopback address. Anyone who can reach
    /// the port can then edit configs and restart units.
    #[arg(
        long,
        env = "RTL_PANEL_ALLOW_UNAUTHENTICATED",
        default_value_t = false,
        action = clap::ArgAction::SetTrue,
        value_parser = clap::builder::BoolishValueParser::new()
    )]
    pub allow_unauthenticated: bool,

    /// tracing filter, e.g. info, debug, rtl_airband_panel=debug.
    #[arg(long, env = "RTL_PANEL_LOG_LEVEL", default_value = "info")]
    pub log_level: String,

    /// Write the panel's own logs (NDJSON) to this file instead of stdout.
    #[arg(long, env = "RTL_PANEL_LOG_FILE")]
    pub log_file: Option<PathBuf>,

    /// SQLite file for historical stats samples [default: ~/.rtl-airband-panel/stats.db]
    #[arg(long, env = "RTL_PANEL_STATS_DB_PATH")]
    pub stats_db_path: Option<PathBuf>,

    #[arg(long, env = "RTL_PANEL_STATS_POLL_INTERVAL_MS", default_value_t = 15_000)]
    pub stats_poll_interval_ms: u64,

    /// Stats samples older than this are pruned; 0 disables pruning.
    #[arg(long, env = "RTL_PANEL_STATS_RETENTION_DAYS", default_value_t = 7.0)]
    pub stats_retention_days: f64,

    #[arg(long, env = "RTL_PANEL_STATS_PRUNE_INTERVAL_MS", default_value_t = 3_600_000)]
    pub stats_prune_interval_ms: u64,

    #[arg(long, env = "RTL_PANEL_CONTROL_SOCKET_TIMEOUT_MS", default_value_t = 8_000)]
    pub control_socket_timeout_ms: u64,

    /// How often the Hardware page's live readings are refreshed from each
    /// instance's control socket, while anyone has the page open.
    #[arg(long, env = "RTL_PANEL_HARDWARE_POLL_INTERVAL_MS", default_value_t = 1_000)]
    pub hardware_poll_interval_ms: u64,

    /// How often the Hardware page's readings are recorded while nobody has
    /// the page open, so its gain advice opens with recent history. 0 turns
    /// background polling off.
    #[arg(long, env = "RTL_PANEL_HARDWARE_BACKGROUND_POLL_INTERVAL_MS", default_value_t = 15_000)]
    pub hardware_background_poll_interval_ms: u64,

    /// Serve the frontend from this directory instead of the copy embedded
    /// in the binary.
    #[arg(long, env = "RTL_PANEL_FRONTEND_DIST")]
    pub frontend_dist: Option<PathBuf>,

    /// Load environment variables from this .env file [default: ./.env if present]
    #[arg(long)]
    pub env_file: Option<PathBuf>,
}

impl Settings {
    /// Loads the .env file (if any) into the environment, then parses flags,
    /// so real environment variables win over the file and flags over both.
    pub fn load() -> Settings {
        let args: Vec<String> = std::env::args().collect();
        let env_file = args
            .iter()
            .position(|a| a == "--env-file")
            .and_then(|i| args.get(i + 1).cloned())
            .or_else(|| args.iter().find_map(|a| a.strip_prefix("--env-file=").map(str::to_string)));
        match env_file {
            Some(path) => {
                if let Err(e) = dotenvy::from_path(&path) {
                    eprintln!("Warning: --env-file '{path}' could not be loaded: {e}");
                }
            }
            None => {
                let _ = dotenvy::dotenv();
            }
        }
        Settings::parse()
    }

    pub fn stats_db_path(&self) -> PathBuf {
        self.stats_db_path.clone().unwrap_or_else(|| {
            let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
            home.join(".rtl-airband-panel").join("stats.db")
        })
    }

    /// Refuses to serve an unauthenticated panel beyond localhost.
    pub fn check_auth_policy(&self) -> Result<(), String> {
        if self.password.as_deref().is_some_and(str::is_empty) {
            return Err("RTL_PANEL_PASSWORD is set but empty".into());
        }
        if !self.host.is_loopback() && self.password.is_none() && !self.allow_unauthenticated {
            return Err(format!(
                "refusing to listen on {} without authentication: set RTL_PANEL_PASSWORD (or pass --allow-unauthenticated to accept the risk)",
                self.host
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn for_tests(instances_dir: PathBuf) -> Settings {
        Settings::parse_from(["rtl-airband-panel", "--instances-dir", instances_dir.to_str().unwrap()])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_policy() {
        let s = Settings::parse_from(["x"]);
        assert!(s.check_auth_policy().is_ok(), "loopback without a password is fine");
        let s = Settings::parse_from(["x", "--host", "0.0.0.0"]);
        assert!(s.check_auth_policy().is_err());
        let s = Settings::parse_from(["x", "--host", "0.0.0.0", "--password", "pw"]);
        assert!(s.check_auth_policy().is_ok());
        let s = Settings::parse_from(["x", "--host", "0.0.0.0", "--allow-unauthenticated"]);
        assert!(s.check_auth_policy().is_ok());
    }

    #[test]
    fn systemd_mode_parses_like_the_ts_flag() {
        assert_eq!(Settings::parse_from(["x", "--systemd-mode", "sudo"]).systemd_mode, SystemdMode::Sudo);
        assert_eq!(Settings::parse_from(["x"]).systemd_mode, SystemdMode::Mock);
    }
}
