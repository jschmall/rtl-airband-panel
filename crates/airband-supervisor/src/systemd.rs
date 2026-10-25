//! systemd unit control behind a narrow, swappable trait. Port of
//! v0.4.110's backend/api/src/systemd/{types,sudo-adapter,mock-adapter}.ts.
//!
//! The sudo implementation issues exactly the argv that
//! deploy/rtl-airband-panel.sudoers allows (sudo matches arguments
//! literally); keep the two in sync.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use ts_rs::TS;

use crate::command::{CommandError, run_command};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ActiveState {
    Active,
    Inactive,
    Activating,
    Deactivating,
    Failed,
    Unknown,
}

impl ActiveState {
    fn parse(raw: &str) -> ActiveState {
        match raw {
            "active" => ActiveState::Active,
            "inactive" => ActiveState::Inactive,
            "activating" => ActiveState::Activating,
            "deactivating" => ActiveState::Deactivating,
            "failed" => ActiveState::Failed,
            _ => ActiveState::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, optional_fields)]
#[serde(rename_all = "camelCase")]
pub struct UnitStatus {
    pub unit: String,
    pub active_state: ActiveState,
    pub sub_state: String,
    /// When the unit last became active (ISO 8601, UTC). Doubles as uptime
    /// and "last (re)started at". None if it has never been active.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_enter_timestamp: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, optional_fields)]
pub struct LogLine {
    /// journalctl's timestamp for the entry (`-o short-iso`).
    pub timestamp: String,
    pub message: String,
    /// Severity, when the line is one of rtl_airband's `-j` JSON log lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
}

#[derive(Debug, Error)]
pub enum UnitError {
    #[error(
        "Refusing to act on unit '{unit}': outside {} this adapter is scoped to",
        if prefix.is_empty() { "the configured unit-name scope".to_string() } else { format!("the '{prefix}' unit-name prefix") }
    )]
    OutOfScope { unit: String, prefix: String },
    #[error("Invalid sudo unit-name prefix '{0}': must match /^[A-Za-z0-9_-]*$/")]
    InvalidPrefix(String),
    #[error(transparent)]
    Command(#[from] CommandError),
}

/// Everything the panel needs to control instance units.
#[async_trait]
pub trait UnitManager: Send + Sync {
    async fn restart(&self, unit: &str) -> Result<(), UnitError>;
    async fn start(&self, unit: &str) -> Result<(), UnitError>;
    async fn stop(&self, unit: &str) -> Result<(), UnitError>;
    async fn enable(&self, unit: &str) -> Result<(), UnitError>;
    async fn disable(&self, unit: &str) -> Result<(), UnitError>;
    async fn status(&self, unit: &str) -> Result<UnitStatus, UnitError>;
    /// One underlying call for many units (each sudo invocation logs its
    /// own PAM session, so polling N units one by one floods syslog).
    async fn status_many(&self, units: &[String]) -> Result<HashMap<String, UnitStatus>, UnitError>;
    async fn daemon_reload(&self) -> Result<(), UnitError>;
    async fn install_unit_file(&self, unit: &str, contents: &str) -> Result<(), UnitError>;
    async fn remove_unit_file(&self, unit: &str) -> Result<(), UnitError>;
    /// The unit file's contents, None if there isn't one. Unit files are
    /// world-readable, so this needs no privileges.
    async fn read_unit_file(&self, unit: &str) -> Result<Option<String>, UnitError>;
    /// Most recent `lines` journal entries, oldest first. Unknown units have no logs.
    async fn logs(&self, unit: &str, lines: u32) -> Result<Vec<LogLine>, UnitError>;
    /// `lines` of backlog then live entries until the receiver is dropped.
    async fn follow_logs(&self, unit: &str, lines: u32) -> Result<mpsc::Receiver<LogLine>, UnitError>;
}

// ------------------------------------------------------------------ parsing

/// Parses one unit's `key=value` block from `systemctl show`.
fn parse_props(block: &str) -> HashMap<&str, &str> {
    block.lines().filter_map(|l| l.split_once('=')).collect()
}

/// `systemctl show --timestamp=utc` prints e.g. `Thu 2026-07-31 14:03:11 UTC`.
pub fn parse_active_enter_timestamp(raw: &str) -> Option<String> {
    let mut parts = raw.split_whitespace();
    let (_weekday, date, time, zone) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    let valid_date = date.len() == 10 && date.as_bytes()[4] == b'-' && date.as_bytes()[7] == b'-';
    let valid_time = time.len() == 8 && time.as_bytes()[2] == b':' && time.as_bytes()[5] == b':';
    let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit() || b == b'-' || b == b':');
    (zone == "UTC" && valid_date && valid_time && digits(date) && digits(time)).then(|| format!("{date}T{time}Z"))
}

fn to_unit_status(unit: &str, props: &HashMap<&str, &str>) -> UnitStatus {
    UnitStatus {
        unit: unit.to_string(),
        active_state: ActiveState::parse(props.get("ActiveState").copied().unwrap_or("unknown")),
        sub_state: props.get("SubState").copied().unwrap_or("unknown").to_string(),
        active_enter_timestamp: props.get("ActiveEnterTimestamp").and_then(|t| parse_active_enter_timestamp(t)),
    }
}

/// Parses multi-unit `systemctl show` output (blocks in argument order,
/// separated by blank lines).
pub fn parse_show_output(units: &[String], output: &str) -> HashMap<String, UnitStatus> {
    let blocks: Vec<&str> = output.split("\n\n").collect();
    units
        .iter()
        .enumerate()
        .map(|(i, unit)| (unit.clone(), to_unit_status(unit, &parse_props(blocks.get(i).copied().unwrap_or("")))))
        .collect()
}

#[derive(Deserialize)]
struct JsonLog {
    level: String,
    message: String,
}

/// Parses one `journalctl -o short-iso` line. A message that is one of
/// rtl_airband's `-j` JSON log lines is unwrapped into level + message.
pub fn parse_journal_line(line: &str) -> LogLine {
    let (timestamp, rest) = match line.split_once(char::is_whitespace) {
        Some((ts, rest)) => (ts.to_string(), rest.trim_start()),
        None => (String::new(), line),
    };
    if timestamp.is_empty() {
        return LogLine { timestamp, message: line.to_string(), level: None };
    }
    // short-iso is `<ts> <host> <ident>[<pid>]: <message>`.
    let message = rest.split_once(": ").map_or(rest, |(_, m)| m);
    if let Ok(json) = serde_json::from_str::<JsonLog>(message.trim()) {
        return LogLine { timestamp, message: json.message, level: Some(json.level) };
    }
    LogLine { timestamp, message: rest.to_string(), level: None }
}

// --------------------------------------------------------------------- sudo

const SUDO_NONINTERACTIVE: &str = "-n";
const SHOW_PROPS: [&str; 4] =
    ["--property=ActiveState", "--property=SubState", "--property=ActiveEnterTimestamp", "--timestamp=utc"];

/// Real implementation: `sudo -n systemctl ...`, scoped to unit names that
/// start with a configurable prefix (enforced here and in sudoers).
pub struct SudoSystemctl {
    unit_dir: String,
    prefix: String,
}

impl SudoSystemctl {
    pub fn new(unit_dir: impl Into<String>, prefix: impl Into<String>) -> Result<SudoSystemctl, UnitError> {
        let prefix = prefix.into();
        if !prefix.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return Err(UnitError::InvalidPrefix(prefix));
        }
        Ok(SudoSystemctl { unit_dir: unit_dir.into(), prefix })
    }

    /// `^<prefix>[A-Za-z0-9_-]{1,64}\.service$`
    pub fn in_scope(&self, unit: &str) -> bool {
        unit.strip_prefix(&self.prefix)
            .and_then(|rest| rest.strip_suffix(".service"))
            .is_some_and(crate::instance::is_safe_name)
    }

    fn check(&self, unit: &str) -> Result<(), UnitError> {
        if self.in_scope(unit) {
            Ok(())
        } else {
            Err(UnitError::OutOfScope { unit: unit.to_string(), prefix: self.prefix.clone() })
        }
    }

    async fn sudo(args: Vec<String>, input: Option<&str>) -> Result<String, UnitError> {
        let mut argv = vec![SUDO_NONINTERACTIVE.to_string()];
        argv.extend(args);
        Ok(run_command("sudo", &argv, input).await?)
    }

    async fn systemctl(&self, verb: &str, unit: &str) -> Result<(), UnitError> {
        self.check(unit)?;
        Self::sudo(vec!["systemctl".into(), verb.into(), unit.into()], None).await.map(|_| ())
    }

    /// Exposed for tests: the exact argv a call issues (after `sudo -n`).
    pub fn show_argv(units: &[String]) -> Vec<String> {
        let mut argv = vec!["systemctl".to_string(), "show".to_string()];
        argv.extend(units.iter().cloned());
        argv.extend(SHOW_PROPS.iter().map(|s| s.to_string()));
        argv
    }

    pub fn logs_argv(unit: &str, lines: u32) -> Vec<String> {
        ["journalctl", "-u", unit, "-n", &lines.to_string(), "--no-pager", "-o", "short-iso"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    pub fn follow_argv(unit: &str, lines: u32) -> Vec<String> {
        ["journalctl", "-u", unit, "-n", &lines.to_string(), "-f", "-o", "short-iso", "--no-pager"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }
}

#[async_trait]
impl UnitManager for SudoSystemctl {
    async fn restart(&self, unit: &str) -> Result<(), UnitError> {
        self.systemctl("restart", unit).await
    }
    async fn start(&self, unit: &str) -> Result<(), UnitError> {
        self.systemctl("start", unit).await
    }
    async fn stop(&self, unit: &str) -> Result<(), UnitError> {
        self.systemctl("stop", unit).await
    }
    async fn enable(&self, unit: &str) -> Result<(), UnitError> {
        self.systemctl("enable", unit).await
    }
    async fn disable(&self, unit: &str) -> Result<(), UnitError> {
        self.systemctl("disable", unit).await
    }

    async fn status(&self, unit: &str) -> Result<UnitStatus, UnitError> {
        let units = [unit.to_string()];
        let mut map = self.status_many(&units).await?;
        Ok(map.remove(unit).expect("status_many returns every requested unit"))
    }

    async fn status_many(&self, units: &[String]) -> Result<HashMap<String, UnitStatus>, UnitError> {
        for u in units {
            self.check(u)?;
        }
        if units.is_empty() {
            return Ok(HashMap::new());
        }
        // `systemctl show` exits 0 for unknown units (ActiveState=inactive).
        let output = Self::sudo(Self::show_argv(units), None).await?;
        Ok(parse_show_output(units, &output))
    }

    async fn daemon_reload(&self) -> Result<(), UnitError> {
        Self::sudo(vec!["systemctl".into(), "daemon-reload".into()], None).await.map(|_| ())
    }

    async fn install_unit_file(&self, unit: &str, contents: &str) -> Result<(), UnitError> {
        self.check(unit)?;
        Self::sudo(vec!["tee".into(), format!("{}/{unit}", self.unit_dir)], Some(contents)).await.map(|_| ())
    }

    async fn remove_unit_file(&self, unit: &str) -> Result<(), UnitError> {
        self.check(unit)?;
        Self::sudo(vec!["rm".into(), "-f".into(), format!("{}/{unit}", self.unit_dir)], None).await.map(|_| ())
    }

    async fn read_unit_file(&self, unit: &str) -> Result<Option<String>, UnitError> {
        self.check(unit)?;
        Ok(tokio::fs::read_to_string(format!("{}/{unit}", self.unit_dir)).await.ok())
    }

    async fn logs(&self, unit: &str, lines: u32) -> Result<Vec<LogLine>, UnitError> {
        self.check(unit)?;
        match Self::sudo(Self::logs_argv(unit, lines), None).await {
            Ok(out) => Ok(out.lines().filter(|l| !l.is_empty()).map(parse_journal_line).collect()),
            Err(UnitError::Command(CommandError::Failed { .. })) => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    }

    async fn follow_logs(&self, unit: &str, lines: u32) -> Result<mpsc::Receiver<LogLine>, UnitError> {
        self.check(unit)?;
        let mut argv = vec![SUDO_NONINTERACTIVE.to_string()];
        argv.extend(Self::follow_argv(unit, lines));
        let mut child = Command::new("sudo")
            .args(&argv)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|source| CommandError::Spawn { command: "sudo".into(), source })?;
        let stdout = child.stdout.take().expect("piped stdout");
        let (tx, rx) = mpsc::channel(256);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                tokio::select! {
                    // Receiver dropped: stop following; kill_on_drop ends journalctl.
                    _ = tx.closed() => break,
                    line = lines.next_line() => match line {
                        Ok(Some(l)) if l.is_empty() => {}
                        Ok(Some(l)) => {
                            if tx.send(parse_journal_line(&l)).await.is_err() {
                                break;
                            }
                        }
                        _ => break,
                    },
                }
            }
            drop(child);
        });
        Ok(rx)
    }
}

// --------------------------------------------------------------------- mock

/// Records calls instead of touching the system. The default everywhere
/// until sudo mode is configured explicitly, and what tests drive.
#[derive(Default)]
pub struct MockUnits {
    state: Mutex<MockState>,
}

#[derive(Default)]
struct MockState {
    calls: Vec<String>,
    unit_files: HashMap<String, String>,
    statuses: HashMap<String, UnitStatus>,
    logs: HashMap<String, Vec<LogLine>>,
}

/// Current time as ISO 8601 UTC (what the mock reports as ActiveEnterTimestamp).
fn utc_now_iso() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    // Days since 1970-01-01 -> civil date (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

impl MockUnits {
    pub fn calls(&self) -> Vec<String> {
        self.state.lock().unwrap().calls.clone()
    }
    pub fn unit_file(&self, unit: &str) -> Option<String> {
        self.state.lock().unwrap().unit_files.get(unit).cloned()
    }
    pub fn seed_logs(&self, unit: &str, lines: Vec<LogLine>) {
        self.state.lock().unwrap().logs.insert(unit.to_string(), lines);
    }
    pub fn seed_status(&self, status: UnitStatus) {
        self.state.lock().unwrap().statuses.insert(status.unit.clone(), status);
    }

    fn record(&self, call: String) -> std::sync::MutexGuard<'_, MockState> {
        let mut s = self.state.lock().unwrap();
        s.calls.push(call);
        s
    }

    fn note(&self, call: String) {
        self.state.lock().unwrap().calls.push(call);
    }

    fn set_running(&self, verb: &str, unit: &str) {
        let mut s = self.record(format!("{verb} {unit}"));
        let ts = utc_now_iso();
        s.statuses.insert(
            unit.to_string(),
            UnitStatus {
                unit: unit.to_string(),
                active_state: ActiveState::Active,
                sub_state: "running".into(),
                active_enter_timestamp: Some(ts),
            },
        );
    }

    fn status_of(s: &MockState, unit: &str) -> UnitStatus {
        // Same default the TS mock reported for a unit it has never touched.
        s.statuses.get(unit).cloned().unwrap_or(UnitStatus {
            unit: unit.to_string(),
            active_state: ActiveState::Unknown,
            sub_state: "dead".into(),
            active_enter_timestamp: None,
        })
    }
}

#[async_trait]
impl UnitManager for MockUnits {
    async fn restart(&self, unit: &str) -> Result<(), UnitError> {
        self.set_running("restart", unit);
        Ok(())
    }
    async fn start(&self, unit: &str) -> Result<(), UnitError> {
        self.set_running("start", unit);
        Ok(())
    }
    async fn stop(&self, unit: &str) -> Result<(), UnitError> {
        let mut s = self.record(format!("stop {unit}"));
        // systemd keeps ActiveEnterTimestamp after a stop.
        let previous = Self::status_of(&s, unit).active_enter_timestamp;
        s.statuses.insert(
            unit.to_string(),
            UnitStatus {
                unit: unit.to_string(),
                active_state: ActiveState::Inactive,
                sub_state: "dead".into(),
                active_enter_timestamp: previous,
            },
        );
        Ok(())
    }
    async fn enable(&self, unit: &str) -> Result<(), UnitError> {
        self.note(format!("enable {unit}"));
        Ok(())
    }
    async fn disable(&self, unit: &str) -> Result<(), UnitError> {
        self.note(format!("disable {unit}"));
        Ok(())
    }
    async fn status(&self, unit: &str) -> Result<UnitStatus, UnitError> {
        Ok(Self::status_of(&self.state.lock().unwrap(), unit))
    }
    async fn status_many(&self, units: &[String]) -> Result<HashMap<String, UnitStatus>, UnitError> {
        let s = self.state.lock().unwrap();
        Ok(units.iter().map(|u| (u.clone(), Self::status_of(&s, u))).collect())
    }
    async fn daemon_reload(&self) -> Result<(), UnitError> {
        self.note("daemon-reload".into());
        Ok(())
    }
    async fn install_unit_file(&self, unit: &str, contents: &str) -> Result<(), UnitError> {
        let mut s = self.record(format!("install-unit-file {unit}"));
        s.unit_files.insert(unit.to_string(), contents.to_string());
        Ok(())
    }
    async fn remove_unit_file(&self, unit: &str) -> Result<(), UnitError> {
        let mut s = self.record(format!("remove-unit-file {unit}"));
        s.unit_files.remove(unit);
        Ok(())
    }
    async fn read_unit_file(&self, unit: &str) -> Result<Option<String>, UnitError> {
        Ok(self.state.lock().unwrap().unit_files.get(unit).cloned())
    }
    async fn logs(&self, unit: &str, lines: u32) -> Result<Vec<LogLine>, UnitError> {
        let s = self.state.lock().unwrap();
        let all = s.logs.get(unit).cloned().unwrap_or_default();
        let skip = all.len().saturating_sub(lines as usize);
        Ok(all.into_iter().skip(skip).collect())
    }
    async fn follow_logs(&self, unit: &str, lines: u32) -> Result<mpsc::Receiver<LogLine>, UnitError> {
        let backlog = self.logs(unit, lines).await?;
        let (tx, rx) = mpsc::channel(backlog.len().max(1));
        for line in backlog {
            let _ = tx.try_send(line);
        }
        Ok(rx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn show_output_parses_in_argument_order() {
        let units = vec!["a.service".to_string(), "b.service".to_string(), "c.service".to_string()];
        let out = "ActiveState=active\nSubState=running\nActiveEnterTimestamp=Thu 2026-10-22 14:48:44 UTC\n\nActiveState=failed\nSubState=failed\nActiveEnterTimestamp=\n\nActiveState=bogus\n";
        let m = parse_show_output(&units, out);
        assert_eq!(m["a.service"].active_state, ActiveState::Active);
        assert_eq!(m["a.service"].active_enter_timestamp.as_deref(), Some("2026-10-22T14:48:44Z"));
        assert_eq!(m["b.service"].active_state, ActiveState::Failed);
        assert_eq!(m["b.service"].active_enter_timestamp, None);
        assert_eq!(m["c.service"].active_state, ActiveState::Unknown);
        assert_eq!(m["c.service"].sub_state, "unknown");
    }

    #[test]
    fn timestamps_other_than_utc_are_rejected() {
        assert_eq!(parse_active_enter_timestamp("Thu 2026-10-22 14:48:44 EDT"), None);
        assert_eq!(parse_active_enter_timestamp("n/a"), None);
        assert_eq!(parse_active_enter_timestamp(""), None);
    }

    #[test]
    fn scope_check() {
        let any = SudoSystemctl::new("/etc/systemd/system", "").unwrap();
        assert!(any.in_scope("rtl_151.service"));
        assert!(!any.in_scope("rtl_151.service --now"));
        assert!(!any.in_scope("../x.service"));
        assert!(!any.in_scope("sshd"));
        let scoped = SudoSystemctl::new("/etc/systemd/system", "rtl_").unwrap();
        assert!(scoped.in_scope("rtl_151.service"));
        assert!(!scoped.in_scope("other.service"));
        assert!(!scoped.in_scope("rtl_.service"));
        assert!(SudoSystemctl::new("/x", "rtl.*").is_err());
    }

    #[test]
    fn argv_matches_sudoers_rules() {
        let units = vec!["rtl_1.service".to_string()];
        assert_eq!(
            SudoSystemctl::show_argv(&units).join(" "),
            "systemctl show rtl_1.service --property=ActiveState --property=SubState --property=ActiveEnterTimestamp --timestamp=utc"
        );
        assert_eq!(
            SudoSystemctl::logs_argv("rtl_1.service", 200).join(" "),
            "journalctl -u rtl_1.service -n 200 --no-pager -o short-iso"
        );
        assert_eq!(
            SudoSystemctl::follow_argv("rtl_1.service", 50).join(" "),
            "journalctl -u rtl_1.service -n 50 -f -o short-iso --no-pager"
        );
    }

    #[test]
    fn journal_lines() {
        let plain = parse_journal_line("2026-10-22T10:00:00-0400 host rtl_airband[123]: Device #0 started");
        assert_eq!(plain.timestamp, "2026-10-22T10:00:00-0400");
        assert_eq!(plain.message, "host rtl_airband[123]: Device #0 started");
        assert_eq!(plain.level, None);

        let json = parse_journal_line(
            r#"2026-10-22T10:00:00-0400 host rtl_airband[123]: {"timestamp":"2026-10-22T14:00:00.123Z","level":"warning","pid":123,"message":"buffer underrun"}"#,
        );
        assert_eq!(json.level.as_deref(), Some("warning"));
        assert_eq!(json.message, "buffer underrun");

        let bare = parse_journal_line("-- No entries --");
        assert_eq!(bare.timestamp, "--");
    }
}
