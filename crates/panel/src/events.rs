//! The error log behind the Errors page: a lasting, timestamped record of
//! what went wrong with each instance, with markers where the panel (or
//! something else) restarted it, so a problem can be placed before or after
//! a change.
//!
//! Producers:
//! - restart markers, from the same `RestartObserver` hook that zeroes the
//!   Overview counters ([`EventLog`] implements it);
//! - systemd transitions (failed, stopped, restarted outside the panel), from
//!   [`unit_watcher`];
//! - failure-counter increases, from the stats poller ([`EventLog::counter_poll`]);
//! - journal errors and warnings, from [`journal_watcher`].
//!
//! Rows live in stats.db (`events`), pruned with the stats retention, and
//! each new one is pushed to websocket clients as `{"type":"event","data":Event}`.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use airband_supervisor::systemd::{ActiveState, LogLine, UnitStatus};
use airband_supervisor::{LogSeverity, classify_log_line};
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::broadcast;

use crate::error::ApiError;
use crate::service::{InstanceService, RestartKind, RestartObserver, RestartReason};
use crate::stats_db::{NewEvent, StatsDb, now_ms};

/// Event kinds, as stored and sent.
pub mod kind {
    /// A journal line classified as an error or warning.
    pub const LOG: &str = "log";
    /// A failure counter (icecast disconnects, overflows, ...) went up.
    pub const COUNTER: &str = "counter";
    pub const UNIT_FAILED: &str = "unit-failed";
    pub const UNIT_STOPPED: &str = "unit-stopped";
    /// Marker: the unit (re)started without the panel asking (systemd's
    /// Restart= after a crash, or systemctl).
    pub const UNEXPECTED_RESTART: &str = "unexpected-restart";
    /// Marker: the panel restarted the unit.
    pub const RESTART: &str = "restart";
    /// Marker: the panel live-applied a change over the control socket.
    pub const LIVE_APPLY: &str = "live-apply";
}

pub mod severity {
    pub const ERROR: &str = "error";
    pub const WARNING: &str = "warning";
    pub const INFO: &str = "info";
}

/// Repeats of a counter's increases, or of the same log line, within this
/// window are folded into the next event instead of one event each.
const REPEAT_WINDOW: Duration = Duration::from_secs(60);
/// A systemd restart this soon after the panel's own isn't "unexpected".
const PANEL_RESTART_GRACE: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: i64,
    pub instance: String,
    /// Epoch ms.
    pub ts: i64,
    pub kind: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
}

impl Event {
    fn from_row(id: i64, e: NewEvent) -> Event {
        Event {
            id,
            instance: e.instance,
            ts: e.ts,
            kind: e.kind,
            severity: e.severity,
            message: e.message,
            detail: e.detail.and_then(|d| serde_json::from_str(&d).ok()),
        }
    }
}

/// One series' increase between two stats polls.
#[derive(Debug, Clone, PartialEq)]
pub struct CounterJump {
    pub metric: String,
    pub labels: BTreeMap<String, String>,
    pub delta: f64,
}

#[derive(Default)]
struct PendingCounter {
    delta: f64,
    series: BTreeSet<String>,
    last_emit: Option<Instant>,
}

#[derive(Default)]
struct RepeatedLine {
    last_emit: Option<Instant>,
    suppressed: u32,
}

pub struct EventLog {
    db: Arc<StatsDb>,
    tx: broadcast::Sender<Value>,
    panel_restarts: Mutex<HashMap<String, Instant>>,
    counters: Mutex<HashMap<(String, String), PendingCounter>>,
    lines: Mutex<HashMap<(String, String), RepeatedLine>>,
}

fn metric_title(metric: &str) -> &str {
    match metric {
        "icecast_disconnect_count" => "Icecast disconnects",
        "lame_encode_failure_count" => "MP3 encode failures",
        "file_write_failure_count" => "File write failures",
        "udp_stream_dropped_packet_count" => "UDP packets dropped",
        "pulse_disconnect_count" => "PulseAudio disconnects",
        "rdio_scanner_queue_drop_count" => "rdio-scanner queue drops",
        "rdio_scanner_upload_failure_count" => "rdio-scanner upload failures",
        "buffer_overflow_count" => "Buffer overflows",
        "output_overrun_count" => "Output overruns",
        other => other,
    }
}

/// e.g. `device 0, channel 1, output 0` or `151.100 MHz (Tower)`.
fn series_name(labels: &BTreeMap<String, String>) -> String {
    let mut parts = Vec::new();
    if let Some(freq) = labels.get("freq").and_then(|f| f.parse::<f64>().ok()) {
        parts.push(format!("{:.3} MHz", freq / 1e6));
    }
    if let Some(label) = labels.get("label").filter(|l| !l.is_empty()) {
        parts.push(format!("({label})"));
    }
    // Outermost first: device/mixer, then channel, then output.
    const ORDER: [&str; 4] = ["device", "mixer", "channel", "output"];
    for k in ORDER {
        if let Some(v) = labels.get(k) {
            parts.push(format!("{k} {v}"));
        }
    }
    for (k, v) in labels {
        if !ORDER.contains(&k.as_str()) && k != "freq" && k != "label" {
            parts.push(format!("{k} {v}"));
        }
    }
    parts.join(" ")
}

/// A plain journal line is `<host> <ident>[pid]: <message>`; the host adds nothing.
fn without_host(line: &LogLine) -> &str {
    if line.level.is_some() {
        return &line.message;
    }
    match line.message.split_once(' ') {
        Some((_, rest)) if rest.contains(": ") => rest,
        _ => &line.message,
    }
}

impl EventLog {
    pub fn new(db: Arc<StatsDb>, tx: broadcast::Sender<Value>) -> EventLog {
        EventLog { db, tx, panel_restarts: Mutex::default(), counters: Mutex::default(), lines: Mutex::default() }
    }

    /// Stores an event and pushes it to websocket clients. A storage
    /// failure is logged, never raised: the error log must not break what
    /// it observes.
    pub fn record(&self, instance: &str, kind: &str, severity: &str, message: String, detail: Option<Value>) {
        let row = NewEvent {
            instance: instance.to_string(),
            ts: now_ms(),
            kind: kind.to_string(),
            severity: severity.to_string(),
            message,
            detail: detail.map(|d| d.to_string()),
        };
        match self.db.insert_event(&row) {
            Ok(id) => {
                let event = Event::from_row(id, row);
                let _ = self.tx.send(json!({ "type": "event", "data": event }));
            }
            Err(e) => tracing::warn!(instance, kind, error = %e, "couldn't record an error-log event"),
        }
    }

    pub fn list(&self, instance: Option<&str>, before: Option<i64>, limit: u32) -> Result<Vec<Event>, ApiError> {
        let rows = self.db.list_events(instance, before, limit).map_err(|e| ApiError::Internal(e.to_string()))?;
        Ok(rows.into_iter().map(|(id, e)| Event::from_row(id, e)).collect())
    }

    fn restarted_by_panel_recently(&self, name: &str) -> bool {
        self.panel_restarts.lock().unwrap().get(name).is_some_and(|t| t.elapsed() < PANEL_RESTART_GRACE)
    }

    /// Takes one stats poll's counter increases. Each counter gets at most
    /// one event per [`REPEAT_WINDOW`]; increases in between are added to
    /// the next one. Called every poll (even with no jumps) so a held-back
    /// increase is written once its window passes.
    pub fn counter_poll(&self, instance: &str, jumps: &[CounterJump]) {
        let ready = {
            let mut counters = self.counters.lock().unwrap();
            for j in jumps {
                let p = counters.entry((instance.to_string(), j.metric.clone())).or_default();
                p.delta += j.delta;
                p.series.insert(series_name(&j.labels));
            }
            Self::take_ready(&mut counters, instance, false)
        };
        self.write_counters(instance, ready);
    }

    fn take_ready(
        counters: &mut HashMap<(String, String), PendingCounter>,
        instance: &str,
        force: bool,
    ) -> Vec<(String, f64, BTreeSet<String>)> {
        let mut ready = Vec::new();
        for ((inst, metric), p) in counters.iter_mut() {
            if inst != instance || p.delta <= 0.0 {
                continue;
            }
            if force || p.last_emit.is_none_or(|t| t.elapsed() >= REPEAT_WINDOW) {
                ready.push((metric.clone(), p.delta, std::mem::take(&mut p.series)));
                p.delta = 0.0;
                p.last_emit = Some(Instant::now());
            }
        }
        ready.sort_by(|a, b| a.0.cmp(&b.0));
        ready
    }

    fn write_counters(&self, instance: &str, ready: Vec<(String, f64, BTreeSet<String>)>) {
        for (metric, delta, series) in ready {
            let n = airband_config::jsnum::to_js_string(delta);
            let place = match series.len() {
                0 => String::new(),
                1 => series.iter().next().filter(|s| !s.is_empty()).map(|s| format!(" ({s})")).unwrap_or_default(),
                k => format!(" across {k} series"),
            };
            self.record(
                instance,
                kind::COUNTER,
                severity::WARNING,
                format!("{} +{n}{place}", metric_title(&metric)),
                Some(json!({ "metric": metric, "delta": delta, "series": series })),
            );
        }
    }

    /// Takes one journal line; keeps it if it classifies as an error or
    /// warning. The same line again within [`REPEAT_WINDOW`] is counted, not
    /// stored, and the count rides along on its next stored copy.
    pub fn log_line(&self, instance: &str, line: &LogLine) {
        let message = without_host(line);
        let Some(class) = classify_log_line(line.level.as_deref(), message) else { return };
        let repeated = {
            let mut lines = self.lines.lock().unwrap();
            if lines.len() > 2000 {
                lines.retain(|_, r| r.last_emit.is_some_and(|t| t.elapsed() < REPEAT_WINDOW * 10));
            }
            let r = lines.entry((instance.to_string(), message.to_string())).or_default();
            if r.last_emit.is_some_and(|t| t.elapsed() < REPEAT_WINDOW) {
                r.suppressed += 1;
                return;
            }
            r.last_emit = Some(Instant::now());
            std::mem::take(&mut r.suppressed)
        };
        let severity = match class.severity {
            LogSeverity::Error => severity::ERROR,
            LogSeverity::Warning => severity::WARNING,
        };
        let mut detail = json!({ "journalTimestamp": line.timestamp, "heuristic": class.heuristic });
        if let Some(level) = &line.level {
            detail["level"] = json!(level);
        }
        if repeated > 0 {
            detail["repeatedBefore"] = json!(repeated);
        }
        self.record(instance, kind::LOG, severity, message.to_string(), Some(detail));
    }

    /// Events for a change in a unit's systemd status between two checks.
    pub fn unit_change(&self, instance: &str, prev: &UnitStatus, now: &UnitStatus) {
        for (k, sev, msg) in unit_change_events(prev, now, self.restarted_by_panel_recently(instance)) {
            self.record(instance, k, sev, msg, Some(json!({ "subState": now.sub_state })));
        }
    }
}

/// What a status change between two checks means for the error log.
/// `panel_restarted` suppresses the restart and stop the panel itself caused.
pub fn unit_change_events(
    prev: &UnitStatus,
    now: &UnitStatus,
    panel_restarted: bool,
) -> Vec<(&'static str, &'static str, String)> {
    let mut out = Vec::new();
    if now.active_state == ActiveState::Failed && prev.active_state != ActiveState::Failed {
        out.push((kind::UNIT_FAILED, severity::ERROR, format!("Unit failed ({})", now.sub_state)));
    }
    if now.active_state == ActiveState::Inactive
        && matches!(prev.active_state, ActiveState::Active | ActiveState::Activating | ActiveState::Deactivating)
        && !panel_restarted
    {
        out.push((kind::UNIT_STOPPED, severity::WARNING, "Unit stopped outside the panel".to_string()));
    }
    let restarted = now.active_enter_timestamp.is_some() && now.active_enter_timestamp != prev.active_enter_timestamp;
    if restarted && !panel_restarted {
        let msg = if prev.active_state == ActiveState::Failed {
            "Started again after failing (systemd Restart= or systemctl)"
        } else {
            "Restarted outside the panel (systemd Restart= after a crash, or systemctl)"
        };
        out.push((kind::UNEXPECTED_RESTART, severity::WARNING, msg.to_string()));
    }
    out
}

impl RestartObserver for EventLog {
    fn restarted(&self, name: &str, kind: &RestartKind) {
        self.panel_restarts.lock().unwrap().insert(name.to_string(), Instant::now());
        // Counter increases held back from before the restart belong before its marker.
        let ready = Self::take_ready(&mut self.counters.lock().unwrap(), name, true);
        self.write_counters(name, ready);
        match kind {
            RestartKind::Restart { reason } => {
                let message = match reason {
                    RestartReason::Manual => "Restarted from the panel",
                    RestartReason::Pending => "Restarted to load pending changes",
                    RestartReason::ConfigSave => "Restarted to load a saved config",
                    RestartReason::Options => "Restarted to apply unit options",
                };
                self.record(name, kind::RESTART, severity::INFO, message.into(), Some(json!({ "reason": reason })));
            }
            RestartKind::LiveApply { applied, skipped_requires_restart } => {
                let mut message =
                    format!("Live-applied {} change{}", applied.len(), if applied.len() == 1 { "" } else { "s" });
                if !skipped_requires_restart.is_empty() {
                    message.push_str(&format!("; {} still need a restart", skipped_requires_restart.len()));
                }
                self.record(
                    name,
                    kind::LIVE_APPLY,
                    severity::INFO,
                    message,
                    Some(json!({ "applied": applied, "skippedRequiresRestart": skipped_requires_restart })),
                );
            }
        }
    }
}

/// Records systemd status changes (see [`unit_change_events`]). Runs
/// whether or not anyone is watching, unlike the websocket health push.
pub async fn unit_watcher(service: Arc<InstanceService>, events: Arc<EventLog>, interval: Duration) {
    let mut last: BTreeMap<String, UnitStatus> = BTreeMap::new();
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        ticker.tick().await;
        let Ok(now) = service.all_health().await else { continue };
        for (name, status) in &now {
            if let Some(prev) = last.get(name) {
                events.unit_change(name, prev, status);
            }
        }
        last = now;
    }
}

/// Follows every instance's journal (one `journalctl -f` each, the same
/// sudo-allowed call as the live log viewer) and records its errors and
/// warnings. Instances added or removed are picked up within `rescan`. A
/// stream that ends is reopened with backoff; lines in the gap are missed.
pub async fn journal_watcher(service: Arc<InstanceService>, events: Arc<EventLog>, rescan: Duration) {
    let mut followers: HashMap<String, tokio::task::JoinHandle<()>> = HashMap::new();
    let mut ticker = tokio::time::interval(rescan);
    loop {
        ticker.tick().await;
        let Ok(infos) = service.configs.list().await else { continue };
        let names: BTreeSet<String> = infos.into_iter().map(|i| i.name).collect();
        followers.retain(|name, task| {
            let keep = names.contains(name);
            if !keep {
                task.abort();
            }
            keep
        });
        for name in names {
            followers.entry(name.clone()).or_insert_with(|| {
                let (service, events) = (service.clone(), events.clone());
                tokio::spawn(follow_one(service, events, name))
            });
        }
    }
}

async fn follow_one(service: Arc<InstanceService>, events: Arc<EventLog>, name: String) {
    const MIN_BACKOFF: Duration = Duration::from_secs(5);
    const MAX_BACKOFF: Duration = Duration::from_secs(300);
    let mut backoff = MIN_BACKOFF;
    loop {
        let opened = Instant::now();
        match service.follow_logs(&name, 0).await {
            Ok(mut rx) => {
                while let Some(line) = rx.recv().await {
                    events.log_line(&name, &line);
                }
            }
            Err(e) => tracing::debug!(instance = %name, error = %e, "couldn't follow the journal"),
        }
        backoff = if opened.elapsed() > MAX_BACKOFF { MIN_BACKOFF } else { (backoff * 2).min(MAX_BACKOFF) };
        tokio::time::sleep(backoff).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log() -> (tempfile::TempDir, EventLog, broadcast::Receiver<Value>) {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(StatsDb::open(&dir.path().join("stats.db")).unwrap());
        let (tx, rx) = broadcast::channel(64);
        (dir, EventLog::new(db, tx), rx)
    }

    fn status(state: ActiveState, ts: Option<&str>) -> UnitStatus {
        UnitStatus {
            unit: "a.service".into(),
            active_state: state,
            sub_state: "x".into(),
            active_enter_timestamp: ts.map(String::from),
        }
    }

    fn kinds(log: &EventLog) -> Vec<String> {
        log.list(Some("a"), None, 100).unwrap().into_iter().rev().map(|e| e.kind).collect()
    }

    #[test]
    fn events_are_stored_listed_newest_first_and_pushed() {
        let (_d, log, mut rx) = log();
        log.record("a", kind::LOG, severity::ERROR, "one".into(), None);
        log.record("b", kind::LOG, severity::WARNING, "two".into(), Some(json!({ "x": 1 })));
        log.record("a", kind::RESTART, severity::INFO, "three".into(), None);
        let all = log.list(None, None, 10).unwrap();
        assert_eq!(all.iter().map(|e| e.message.as_str()).collect::<Vec<_>>(), ["three", "two", "one"]);
        assert_eq!(all[1].detail, Some(json!({ "x": 1 })));
        let a = log.list(Some("a"), None, 10).unwrap();
        assert_eq!(a.len(), 2);
        let older = log.list(None, Some(all[0].id), 1).unwrap();
        assert_eq!(older[0].message, "two");
        let pushed = rx.try_recv().unwrap();
        assert_eq!(pushed["type"], "event");
        assert_eq!(pushed["data"]["message"], "one");
    }

    #[test]
    fn counter_increases_are_folded_per_window_and_flushed_before_a_restart() {
        let (_d, log, _rx) = log();
        let jump = |delta| CounterJump {
            metric: "icecast_disconnect_count".into(),
            labels: [("device".to_string(), "0".to_string()), ("output".to_string(), "1".to_string())].into(),
            delta,
        };
        log.counter_poll("a", &[jump(2.0)]);
        log.counter_poll("a", &[jump(1.0)]); // inside the window: held back
        log.counter_poll("a", &[jump(4.0)]);
        let events = log.list(Some("a"), None, 10).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].message, "Icecast disconnects +2 (device 0 output 1)");

        log.restarted("a", &RestartKind::Restart { reason: RestartReason::Manual });
        assert_eq!(kinds(&log), ["counter", "counter", "restart"]);
        assert_eq!(log.list(Some("a"), None, 10).unwrap()[1].message, "Icecast disconnects +5 (device 0 output 1)");
    }

    #[test]
    fn journal_lines_are_classified_and_repeats_folded() {
        let (_d, log, _rx) = log();
        let plain = |m: &str| LogLine { timestamp: "2026-11-01T10:00:00+0000".into(), message: m.into(), level: None };
        log.log_line("a", &plain("dev01 rtl_airband[9]: Writing to /rec/a.mp3"));
        log.log_line("a", &plain("dev01 rtl_airband[9]: Lost connection to ice:8000/a"));
        log.log_line("a", &plain("dev01 rtl_airband[9]: Lost connection to ice:8000/a"));
        log.log_line(
            "a",
            &LogLine {
                timestamp: "t".into(),
                message: "Failed to open rtlsdr device #0.".into(),
                level: Some("error".into()),
            },
        );
        let events = log.list(Some("a"), None, 10).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].message, "rtl_airband[9]: Lost connection to ice:8000/a");
        assert_eq!(events[1].severity, "warning");
        assert_eq!(events[1].detail.as_ref().unwrap()["heuristic"], true);
        assert_eq!(events[0].severity, "error");
        assert_eq!(events[0].detail.as_ref().unwrap()["heuristic"], false);
    }

    #[test]
    fn unit_transitions() {
        let active = status(ActiveState::Active, Some("2026-11-01T10:00:00Z"));
        let failed = status(ActiveState::Failed, Some("2026-11-01T10:00:00Z"));
        let back = status(ActiveState::Active, Some("2026-11-01T10:05:00Z"));
        let stopped = status(ActiveState::Inactive, Some("2026-11-01T10:00:00Z"));
        let k = |p, n, panel| unit_change_events(p, n, panel).into_iter().map(|e| e.0).collect::<Vec<_>>();
        assert_eq!(k(&active, &active, false), Vec::<&str>::new());
        assert_eq!(k(&active, &failed, false), [kind::UNIT_FAILED]);
        assert_eq!(k(&failed, &back, false), [kind::UNEXPECTED_RESTART]);
        assert_eq!(k(&active, &back, false), [kind::UNEXPECTED_RESTART]);
        assert_eq!(k(&active, &back, true), Vec::<&str>::new(), "the panel's own restart has its own marker");
        assert_eq!(k(&active, &stopped, false), [kind::UNIT_STOPPED]);
        assert_eq!(k(&active, &failed, true), [kind::UNIT_FAILED], "a failure is reported even right after a restart");
    }

    #[test]
    fn live_apply_marker() {
        let (_d, log, _rx) = log();
        log.restarted(
            "a",
            &RestartKind::LiveApply {
                applied: vec!["gain".into()],
                skipped_requires_restart: vec!["x".into(), "y".into()],
            },
        );
        let e = &log.list(Some("a"), None, 1).unwrap()[0];
        assert_eq!(e.kind, kind::LIVE_APPLY);
        assert_eq!(e.message, "Live-applied 1 change; 2 still need a restart");
    }
}
