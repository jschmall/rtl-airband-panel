//! Picks the journal lines worth keeping in the panel's error log.
//!
//! With `-j`, rtl_airband tags every line with its syslog priority, which
//! is trusted. Without it, rtl_airband logs to stderr and the level is lost,
//! so plain-text lines (and systemd's own lines about the unit) are sorted by
//! keywords. That second path is a guess and is reported as one.

/// How serious a kept log line is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogClass {
    pub severity: LogSeverity,
    /// True when the severity came from keywords rather than a `-j` level.
    pub heuristic: bool,
}

/// Routine lines that would otherwise match a keyword: a normal shutdown
/// ("Got signal 15, exiting") and icecast connecting.
const ROUTINE: [&str; 6] =
    ["got signal", "connecting to ", "connected to ", "deactivated successfully", "consumed ", "cleaning up"];

/// Keywords that mean the process (or a whole device) went down.
const ERROR_WORDS: [&str; 11] = [
    "fatal",
    "abort",
    "segfault",
    "segmentation fault",
    "core-dump",
    "core dumped",
    "/segv",
    "/abrt",
    "out of memory",
    "all receivers failed",
    // fork auto_ppm's divergence trip (LOG_ERR): it's off until a reload.
    "auto_ppm disabled",
];

const WARNING_WORDS: [&str; 23] = [
    "error",
    "fail",
    "cannot",
    "can't",
    "could not",
    "couldn't",
    "unable",
    "denied",
    "refused",
    "timeout",
    "timed out",
    "lost connection",
    "overflow",
    "disconnect",
    "problem",
    "died",
    "disabling",
    "exceeded",
    "not supported",
    "warning",
    "too big",
    "exiting",
    // fork auto_ppm hitting auto_ppm_max_ppm (LOG_WARNING).
    "auto_ppm wants",
];

/// The severity to log a line under, or None for a routine line.
pub fn classify_log_line(level: Option<&str>, message: &str) -> Option<LogClass> {
    match level {
        Some("emerg" | "alert" | "crit" | "error" | "err") => {
            Some(LogClass { severity: LogSeverity::Error, heuristic: false })
        }
        Some("warning" | "warn") => Some(LogClass { severity: LogSeverity::Warning, heuristic: false }),
        // `notice` carries both "Connected to ..." and "Disabling mixer ... all
        // inputs died", so it gets the keyword check.
        Some("notice") | None => keyword_class(message),
        Some(_) => None,
    }
}

fn keyword_class(message: &str) -> Option<LogClass> {
    let m = message.to_ascii_lowercase();
    if ROUTINE.iter().any(|w| m.contains(w)) {
        return None;
    }
    let severity = if ERROR_WORDS.iter().any(|w| m.contains(w)) {
        LogSeverity::Error
    } else if WARNING_WORDS.iter().any(|w| m.contains(w)) {
        LogSeverity::Warning
    } else {
        return None;
    };
    Some(LogClass { severity, heuristic: true })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn class(level: Option<&str>, m: &str) -> Option<(LogSeverity, bool)> {
        classify_log_line(level, m).map(|c| (c.severity, c.heuristic))
    }

    #[test]
    fn json_levels_are_trusted() {
        assert_eq!(class(Some("error"), "anything"), Some((LogSeverity::Error, false)));
        assert_eq!(class(Some("crit"), "Out of memory."), Some((LogSeverity::Error, false)));
        assert_eq!(class(Some("warning"), "Failed to add shout metadata"), Some((LogSeverity::Warning, false)));
        assert_eq!(class(Some("info"), "Activity on 151.100 MHz (Tower) failed"), None);
        assert_eq!(class(Some("debug"), "error"), None);
    }

    #[test]
    fn notice_lines_fall_back_to_keywords() {
        assert_eq!(class(Some("notice"), "Connected to example:8000/tower"), None);
        assert_eq!(class(Some("notice"), "Got signal 15, exiting"), None);
        assert_eq!(class(Some("notice"), "Disabling mixer 'm1' - all inputs died"), Some((LogSeverity::Warning, true)));
    }

    #[test]
    fn plain_text_rtl_airband_lines() {
        // journalctl short-iso without -j: "<host> <ident>[pid]: <message>"
        let warn = Some((LogSeverity::Warning, true));
        let err = Some((LogSeverity::Error, true));
        assert_eq!(class(None, "dev01 rtl_airband[812]: Lost connection to example:8000/tower"), warn);
        assert_eq!(class(None, "dev01 rtl_airband[812]: Could not connect to example:8000/tower: refused"), warn);
        assert_eq!(class(None, "dev01 rtl_airband[812]: Failed to set gain to 29.70 for device #0: error -5"), warn);
        assert_eq!(class(None, "dev01 rtl_airband[812]: RTLSDR device #0: async read failed, disabling"), warn);
        assert_eq!(class(None, "dev01 rtl_airband[812]: 1 device(s) failed to initialize - aborting"), err);
        assert_eq!(class(None, "dev01 rtl_airband[812]: All receivers failed, exiting"), err);
        assert_eq!(class(None, "dev01 rtl_airband[812]: Writing to /var/rec/tower.mp3"), None);
        assert_eq!(class(None, "dev01 rtl_airband[812]: RTLSDR-Airband version v6.5.0 starting"), None);
        assert_eq!(class(None, "dev01 rtl_airband[812]: Connecting to example:8000/tower..."), None);
        assert_eq!(class(None, "dev01 rtl_airband[812]: Got signal 15, exiting"), None);
    }

    #[test]
    fn plain_text_auto_ppm_lines() {
        let line = |m: &str| format!("dev01 rtl_airband[812]: Device #0: {m}");
        assert_eq!(
            class(
                None,
                &line(
                    "auto_ppm disabled: error grew after 2 consecutive adjustments; reverted correction to 3 ppm. Fix the cause, then reload_diff or restart to re-enable"
                )
            ),
            Some((LogSeverity::Error, true))
        );
        assert_eq!(
            class(
                None,
                &line(
                    "auto_ppm wants +12.0 ppm beyond the current 95 ppm, past the +/-100 ppm limit - check the dongle"
                )
            ),
            Some((LogSeverity::Warning, true))
        );
        assert_eq!(class(None, &line("auto_ppm correction 3 -> 5 ppm (residual +2.10, 3/3 channels)")), None);
        // With -j the level decides.
        assert_eq!(class(Some("info"), "Device #0: auto_ppm correction 3 -> 5 ppm"), None);
    }

    #[test]
    fn systemd_lines_about_the_unit() {
        let warn = Some((LogSeverity::Warning, true));
        assert_eq!(
            class(None, "dev01 systemd[1]: rtl_a.service: Main process exited, code=killed, status=11/SEGV"),
            Some((LogSeverity::Error, true))
        );
        assert_eq!(class(None, "dev01 systemd[1]: rtl_a.service: Failed with result 'exit-code'."), warn);
        assert_eq!(class(None, "dev01 systemd[1]: rtl_a.service: Deactivated successfully."), None);
        assert_eq!(class(None, "dev01 systemd[1]: Started rtl_a.service - RTLSDR-Airband instance: a."), None);
        assert_eq!(class(None, "dev01 systemd[1]: rtl_a.service: Consumed 1min 2.345s CPU time."), None);
    }
}
