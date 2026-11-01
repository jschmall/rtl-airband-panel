//! Stats polling and queries. Port of v0.4.110's backend/api's stats/{poller,
//! poll-status,stats-service,metrics-format}.ts.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use airband_supervisor::{StatSample, StatsReader, StatsSource};
use serde::Serialize;
use tokio::sync::watch;

use crate::error::ApiError;
use crate::events::{CounterJump, EventLog};
use crate::stats_db::{HistoryPoint, HistoryQuery, LatestSample, StatsDb, SummaryBaseline, now_ms};
use crate::store::{ConfigStore, canonical_labels};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollStatus {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_success_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Default)]
pub struct PollStatusTracker(Mutex<HashMap<String, PollStatus>>);

impl PollStatusTracker {
    pub fn record_success(&self, instance: &str, at: i64) {
        self.0.lock().unwrap().insert(instance.into(), PollStatus { last_success_ms: Some(at), ..Default::default() });
    }
    pub fn record_error(&self, instance: &str, at: i64, message: String) {
        let mut m = self.0.lock().unwrap();
        let last_success_ms = m.get(instance).and_then(|s| s.last_success_ms);
        m.insert(instance.into(), PollStatus { last_success_ms, last_error_ms: Some(at), last_error: Some(message) });
    }
    pub fn get(&self, instance: &str) -> PollStatus {
        self.0.lock().unwrap().get(instance).cloned().unwrap_or_default()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceStatsSummary {
    pub buffer_overflow_total: f64,
    pub output_overrun_total: f64,
    /// Count of input_overrun_count series currently nonzero.
    pub inputs_dropping_count: u64,
    pub output_failure_total: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_cpu_seconds: Option<f64>,
    /// When the counter totals above started counting from zero (the
    /// panel's last restart or live apply of this instance), if they don't
    /// simply run from the process's start.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_set_at: Option<i64>,
}

const CPU_METRIC: &str = "process_cpu_seconds_total";

/// Whether a metric is one of the counters the Overview totals add up.
fn is_summed_counter(metric: &str) -> bool {
    OUTPUT_FAILURE_METRICS.contains(&metric) || metric == "buffer_overflow_count" || metric == "output_overrun_count"
}

/// A baseline indexed for lookups: by exact series, and by (metric, freq) for
/// a series whose other labels (e.g. a channel label) changed in a live apply.
struct BaselineIndex {
    exact: HashMap<(String, String), f64>,
    by_freq: HashMap<(String, String), Option<f64>>,
}

impl BaselineIndex {
    fn new(b: &SummaryBaseline) -> BaselineIndex {
        let mut exact = HashMap::new();
        let mut by_freq: HashMap<(String, String), Option<f64>> = HashMap::new();
        for s in &b.samples {
            exact.insert((s.metric.clone(), canonical_labels(&s.labels)), s.value);
            if let Some(freq) = s.labels.get("freq") {
                by_freq
                    .entry((s.metric.clone(), freq.clone()))
                    .and_modify(|v| *v = None) // ambiguous: several series share the freq
                    .or_insert(Some(s.value));
            }
        }
        BaselineIndex { exact, by_freq }
    }

    fn get(&self, metric: &str, labels: &BTreeMap<String, String>) -> Option<f64> {
        if let Some(v) = self.exact.get(&(metric.to_string(), canonical_labels(labels))) {
            return Some(*v);
        }
        let freq = labels.get("freq")?;
        self.by_freq.get(&(metric.to_string(), freq.clone())).copied().flatten()
    }

    /// The counters went backwards, so the process restarted since the
    /// baseline was taken and its counters already start from zero.
    fn reset_by(&self, samples: &[LatestSample]) -> bool {
        samples.iter().any(|s| {
            (s.metric == CPU_METRIC || is_summed_counter(&s.metric))
                && self.get(&s.metric, &s.labels).is_some_and(|base| s.value < base)
        })
    }
}

/// Summed into output_failure_total (excludes icecast_backlog_exceeded_count,
/// a subset of icecast_disconnect_count, and pulse under/overflows, which are
/// expected under normal load).
const OUTPUT_FAILURE_METRICS: [&str; 7] = [
    "icecast_disconnect_count",
    "lame_encode_failure_count",
    "file_write_failure_count",
    "udp_stream_dropped_packet_count",
    "pulse_disconnect_count",
    "rdio_scanner_queue_drop_count",
    "rdio_scanner_upload_failure_count",
];

pub struct StatsService {
    pub db: Arc<StatsDb>,
    pub poll_status: Arc<PollStatusTracker>,
    /// Each instance's most recent poll, kept by the poller so the Overview's
    /// summaries and the latest-values reads don't go to SQLite. A miss (e.g.
    /// right after startup) falls back to the database.
    latest: Mutex<HashMap<String, Arc<Vec<LatestSample>>>>,
    /// Per instance, the counter values the Overview totals count up from
    /// (see `mark_baseline`); mirrored in SQLite so they survive a panel restart.
    baselines: Mutex<HashMap<String, SummaryBaseline>>,
    /// Woken whenever a baseline changes, so the Overview is pushed new
    /// totals right away instead of at the next tick.
    pub summaries_changed: tokio::sync::Notify,
}

fn db_err(e: rusqlite::Error) -> ApiError {
    ApiError::Internal(e.to_string())
}

impl StatsService {
    pub fn new(db: Arc<StatsDb>) -> StatsService {
        let baselines = db.baselines().unwrap_or_else(|e| {
            tracing::warn!(error = %e, "couldn't load the Overview counter baselines; totals run from process start");
            HashMap::new()
        });
        StatsService {
            db,
            poll_status: Arc::new(PollStatusTracker::default()),
            latest: Mutex::new(HashMap::new()),
            baselines: Mutex::new(baselines),
            summaries_changed: tokio::sync::Notify::new(),
        }
    }

    /// Restarts this instance's Overview totals from zero: called when the
    /// panel restarts the instance or live-applies a change to it. The latest
    /// poll becomes the zero point, until the counters themselves reset (the
    /// new process's first poll after a restart), which drops it.
    pub fn mark_baseline(&self, name: &str) -> Result<(), ApiError> {
        let samples = self.latest(name)?;
        let baseline = SummaryBaseline { set_at: now_ms(), samples: (*samples).clone() };
        self.db.set_baseline(name, &baseline).map_err(db_err)?;
        self.baselines.lock().unwrap().insert(name.to_string(), baseline);
        self.summaries_changed.notify_one();
        Ok(())
    }

    fn drop_baseline(&self, name: &str) {
        self.baselines.lock().unwrap().remove(name);
        if let Err(e) = self.db.clear_baseline(name) {
            tracing::warn!(instance = %name, error = %e, "couldn't clear an Overview counter baseline");
        }
    }

    /// After a full restart the counters start over, but the baseline
    /// still holds the old process's (higher) values: drop it once a poll
    /// shows the reset. The `set_at` is kept so the Overview still says
    /// since when it counts.
    fn check_reset(&self, name: &str, samples: &[LatestSample]) {
        let mut baselines = self.baselines.lock().unwrap();
        let Some(b) = baselines.get_mut(name) else { return };
        if !b.samples.is_empty() && BaselineIndex::new(b).reset_by(samples) {
            b.samples.clear();
            let b = b.clone();
            drop(baselines);
            if let Err(e) = self.db.set_baseline(name, &b) {
                tracing::warn!(instance = %name, error = %e, "couldn't update an Overview counter baseline");
            }
        }
    }

    /// Records a poll that was just stored, as `db.latest(name)` would now
    /// return it. Returns how much each Overview counter went up since the
    /// previous cached poll (none for the first poll after the panel
    /// starts, so old totals don't all count as new).
    pub fn record_poll(&self, name: &str, samples: &[StatSample]) -> Vec<CounterJump> {
        if samples.is_empty() {
            return Vec::new(); // nothing was stored, so the previous poll is still the latest
        }
        let latest = samples
            .iter()
            .map(|s| LatestSample { metric: s.metric.clone(), labels: s.labels.clone(), value: s.value })
            .collect::<Vec<_>>();
        self.check_reset(name, &latest);
        let previous = self.latest.lock().unwrap().insert(name.to_string(), Arc::new(latest.clone()));
        let Some(previous) = previous else { return Vec::new() };
        let before: HashMap<(&str, String), f64> =
            previous.iter().map(|s| ((s.metric.as_str(), canonical_labels(&s.labels)), s.value)).collect();
        let restarted = latest.iter().any(|s| {
            s.metric == CPU_METRIC
                && before.get(&(CPU_METRIC, canonical_labels(&s.labels))).is_some_and(|b| s.value < *b)
        });
        latest
            .into_iter()
            .filter(|s| is_summed_counter(&s.metric))
            .filter_map(|s| {
                let prev = before.get(&(s.metric.as_str(), canonical_labels(&s.labels))).copied();
                // After a reset the new value is all new; a series that just
                // appeared is new (or relabelled), so it isn't counted.
                let delta = match prev {
                    Some(p) if restarted || s.value < p => s.value,
                    Some(p) => s.value - p,
                    None => 0.0,
                };
                (delta > 0.0).then_some(CounterJump { metric: s.metric, labels: s.labels, delta })
            })
            .collect()
    }

    /// Forgets the cached poll, so reads go back to the database.
    pub fn forget(&self, name: &str) {
        self.latest.lock().unwrap().remove(name);
    }

    pub fn latest(&self, name: &str) -> Result<Arc<Vec<LatestSample>>, ApiError> {
        if let Some(hit) = self.latest.lock().unwrap().get(name) {
            return Ok(hit.clone());
        }
        let fresh = Arc::new(self.db.latest(name).map_err(db_err)?);
        // Don't cache "nothing yet": the first poll fills it in.
        if !fresh.is_empty() {
            self.latest.lock().unwrap().entry(name.to_string()).or_insert_with(|| fresh.clone());
        }
        Ok(fresh)
    }

    pub fn history(&self, name: &str, q: &HistoryQuery) -> Result<Vec<HistoryPoint>, ApiError> {
        self.db.history(name, q).map_err(db_err)
    }

    pub fn summaries(&self, names: &[String]) -> Result<BTreeMap<String, InstanceStatsSummary>, ApiError> {
        // Drop instances that were deleted or renamed away.
        self.latest.lock().unwrap().retain(|k, _| names.contains(k));
        let gone: Vec<String> = self.baselines.lock().unwrap().keys().filter(|k| !names.contains(k)).cloned().collect();
        for name in gone {
            self.drop_baseline(&name);
        }
        let mut out = BTreeMap::new();
        for name in names {
            let baseline = self.baselines.lock().unwrap().get(name).cloned();
            let index = baseline.as_ref().map(BaselineIndex::new);
            let mut s = InstanceStatsSummary {
                buffer_overflow_total: 0.0,
                output_overrun_total: 0.0,
                inputs_dropping_count: 0,
                output_failure_total: 0.0,
                process_cpu_seconds: None,
                baseline_set_at: baseline.as_ref().map(|b| b.set_at),
            };
            let latest = self.latest(name)?;
            // A cold read (e.g. the panel's first summary after a restart)
            // can predate the reset check; a reset baseline counts as none.
            let index = index.filter(|i| !i.reset_by(&latest));
            for sample in latest.iter() {
                let since_baseline = || {
                    let base = index.as_ref().and_then(|i| i.get(&sample.metric, &sample.labels)).unwrap_or(0.0);
                    (sample.value - base).max(0.0)
                };
                match sample.metric.as_str() {
                    m if OUTPUT_FAILURE_METRICS.contains(&m) => s.output_failure_total += since_baseline(),
                    "buffer_overflow_count" => s.buffer_overflow_total += since_baseline(),
                    "output_overrun_count" => s.output_overrun_total += since_baseline(),
                    "input_overrun_count" if sample.value > 0.0 => s.inputs_dropping_count += 1,
                    CPU_METRIC => s.process_cpu_seconds = Some(sample.value),
                    _ => {}
                }
            }
            out.insert(name.clone(), s);
        }
        Ok(out)
    }

    /// One Prometheus scrape covering every instance, tagged with an `instance` label.
    pub fn metrics_text(&self, names: &[String]) -> Result<String, ApiError> {
        let escape = |v: &str| v.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
        let mut lines = Vec::new();
        for name in names {
            for s in self.latest(name)?.iter() {
                let mut labels: Vec<String> = s.labels.iter().map(|(k, v)| format!("{k}=\"{}\"", escape(v))).collect();
                labels.push(format!("instance=\"{}\"", escape(name)));
                lines.push(format!(
                    "{}{{{}}} {}",
                    s.metric,
                    labels.join(","),
                    airband_config::jsnum::to_js_string(s.value)
                ));
            }
        }
        Ok(if lines.is_empty() { String::new() } else { format!("{}\n", lines.join("\n")) })
    }
}

impl crate::service::RestartObserver for StatsService {
    fn restarted(&self, name: &str, _kind: &crate::service::RestartKind) {
        if let Err(e) = self.mark_baseline(name) {
            tracing::warn!(instance = %name, error = %e, "couldn't reset the Overview counters");
        }
    }
}

pub struct PollerOptions {
    pub interval: Duration,
    pub retention_days: f64,
    pub prune_interval: Duration,
}

/// Polls every instance's stats on an interval until `shutdown` flips. One
/// bad instance (missing file, oversized file, unreachable endpoint) never
/// stalls the others; its error lands in the poll-status tracker.
pub async fn run_poller(
    configs: Arc<ConfigStore>,
    stats: Arc<StatsService>,
    events: Arc<EventLog>,
    opts: PollerOptions,
    mut shutdown: watch::Receiver<bool>,
) {
    let reader = StatsReader::default();
    let mut last_prune: Option<Instant> = None;
    let mut ticker = tokio::time::interval(opts.interval);
    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            _ = shutdown.changed() => return,
        }
        let Ok(infos) = configs.list().await else { continue };
        for info in infos {
            let result = async {
                let config = configs.read(&info.name).await.map_err(|e| e.to_string())?;
                let Some(source) = StatsSource::for_config(&config.config) else { return Ok(None) };
                reader.read(&info.name, &source).await.map_err(|e| e.to_string())
            }
            .await;
            match result {
                Ok(Some(samples)) => {
                    let db = stats.db.clone();
                    let name = info.name.clone();
                    let insert = tokio::task::spawn_blocking(move || {
                        db.insert_batch(&name, &samples, now_ms()).map(|()| samples)
                    })
                    .await;
                    match insert {
                        Ok(Ok(samples)) => {
                            let jumps = stats.record_poll(&info.name, &samples);
                            events.counter_poll(&info.name, &jumps);
                            stats.poll_status.record_success(&info.name, now_ms());
                        }
                        Ok(Err(e)) => stats.poll_status.record_error(&info.name, now_ms(), e.to_string()),
                        Err(e) => stats.poll_status.record_error(&info.name, now_ms(), e.to_string()),
                    }
                }
                Ok(None) => {
                    stats.forget(&info.name);
                    stats.poll_status.record_success(&info.name, now_ms());
                }
                Err(e) => {
                    tracing::warn!(instance = %info.name, error = %e, "failed to poll stats for instance");
                    stats.poll_status.record_error(&info.name, now_ms(), e);
                }
            }
        }
        if last_prune.is_none_or(|t| t.elapsed() >= opts.prune_interval) {
            last_prune = Some(Instant::now());
            let db = stats.db.clone();
            let days = opts.retention_days;
            if let Ok(Err(e)) = tokio::task::spawn_blocking(move || db.prune(days)).await {
                tracing::warn!(error = %e, "stats prune failed");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(metric: &str, value: f64) -> StatSample {
        StatSample { metric: metric.into(), labels: [("freq".to_string(), "1".to_string())].into(), value }
    }

    fn service() -> (tempfile::TempDir, StatsService) {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(StatsDb::open(&dir.path().join("stats.db")).unwrap());
        (dir, StatsService::new(db))
    }

    #[test]
    fn cached_poll_matches_the_database() {
        let (_dir, stats) = service();
        let poll = [sample("icecast_disconnect_count", 2.0), sample("buffer_overflow_count", 3.0)];
        stats.db.insert_batch("a", &poll, now_ms()).unwrap();
        let from_db = stats.latest("a").unwrap(); // miss: read from SQLite, then cached
        stats.forget("a");
        stats.record_poll("a", &poll);
        assert_eq!(*stats.latest("a").unwrap(), *from_db);

        let s = &stats.summaries(&["a".into()]).unwrap()["a"];
        assert_eq!((s.output_failure_total, s.buffer_overflow_total), (2.0, 3.0));
    }

    #[test]
    fn polls_report_counter_increases() {
        let (_dir, stats) = service();
        assert!(stats.record_poll("a", &[cpu(1.0), sample("icecast_disconnect_count", 3.0)]).is_empty());
        assert!(stats.record_poll("a", &[cpu(2.0), sample("icecast_disconnect_count", 3.0)]).is_empty());
        let j = stats.record_poll("a", &[cpu(3.0), sample("icecast_disconnect_count", 5.0), sample("noise", 9.0)]);
        assert_eq!(
            j.iter().map(|j| (j.metric.as_str(), j.delta)).collect::<Vec<_>>(),
            [("icecast_disconnect_count", 2.0)]
        );
        // A new process: its whole count is new.
        let j = stats.record_poll("a", &[cpu(0.1), sample("icecast_disconnect_count", 1.0)]);
        assert_eq!(j[0].delta, 1.0);
    }

    #[test]
    fn summaries_follow_new_polls_and_drop_removed_instances() {
        let (_dir, stats) = service();
        stats.record_poll("a", &[sample("file_write_failure_count", 1.0)]);
        stats.record_poll("gone", &[sample("file_write_failure_count", 9.0)]);
        stats.record_poll("a", &[sample("file_write_failure_count", 4.0)]);
        stats.record_poll("a", &[]); // an empty poll stores nothing, so the last one stands

        let out = stats.summaries(&["a".into()]).unwrap();
        assert_eq!(out["a"].output_failure_total, 4.0);
        assert!(!out.contains_key("gone"));
        assert!(!stats.latest.lock().unwrap().contains_key("gone"));
    }

    fn cpu(value: f64) -> StatSample {
        StatSample { metric: CPU_METRIC.into(), labels: BTreeMap::new(), value }
    }

    fn totals(stats: &StatsService) -> (f64, f64, Option<i64>) {
        let s = &stats.summaries(&["a".into()]).unwrap()["a"];
        (s.output_failure_total, s.buffer_overflow_total, s.baseline_set_at)
    }

    #[test]
    fn a_baseline_zeroes_the_totals_and_later_failures_count_from_it() {
        let (_dir, stats) = service();
        stats.record_poll(
            "a",
            &[cpu(10.0), sample("icecast_disconnect_count", 5.0), sample("buffer_overflow_count", 2.0)],
        );
        assert_eq!(totals(&stats).0, 5.0);
        assert_eq!(totals(&stats).2, None);

        stats.mark_baseline("a").unwrap();
        let (fail, over, since) = totals(&stats);
        assert_eq!((fail, over), (0.0, 0.0));
        assert!(since.is_some());

        // Same process (CPU kept climbing): only the new failures count.
        stats.record_poll(
            "a",
            &[cpu(12.0), sample("icecast_disconnect_count", 7.0), sample("buffer_overflow_count", 2.0)],
        );
        assert_eq!(totals(&stats).0, 2.0);
    }

    #[test]
    fn a_restarted_process_drops_the_baseline() {
        let (_dir, stats) = service();
        stats.record_poll("a", &[cpu(100.0), sample("icecast_disconnect_count", 5.0)]);
        stats.mark_baseline("a").unwrap();
        // CPU time went backwards: a new process, whose counters already
        // start at zero, so its 6 disconnects are all since the restart.
        stats.record_poll("a", &[cpu(1.0), sample("icecast_disconnect_count", 6.0)]);
        let (fail, _, since) = totals(&stats);
        assert_eq!(fail, 6.0);
        assert!(since.is_some(), "still says since when it counts");
        // ...and it stays dropped.
        stats.record_poll("a", &[cpu(2.0), sample("icecast_disconnect_count", 6.0)]);
        assert_eq!(totals(&stats).0, 6.0);
    }

    #[test]
    fn a_counter_going_backwards_also_means_a_reset() {
        let (_dir, stats) = service();
        stats.record_poll("a", &[sample("file_write_failure_count", 9.0)]);
        stats.mark_baseline("a").unwrap();
        stats.record_poll("a", &[sample("file_write_failure_count", 1.0)]);
        assert_eq!(totals(&stats).0, 1.0);
    }

    #[test]
    fn a_relabelled_channel_keeps_its_baseline_by_freq() {
        let (_dir, stats) = service();
        let labelled = |label: &str, v: f64| StatSample {
            metric: "icecast_disconnect_count".into(),
            labels: [("freq".to_string(), "1".to_string()), ("label".to_string(), label.to_string())].into(),
            value: v,
        };
        stats.record_poll("a", &[cpu(5.0), labelled("Old", 4.0)]);
        stats.mark_baseline("a").unwrap();
        stats.record_poll("a", &[cpu(6.0), labelled("New", 5.0)]);
        assert_eq!(totals(&stats).0, 1.0);
    }

    #[test]
    fn baselines_persist_and_follow_removed_instances() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        {
            let stats = StatsService::new(Arc::new(StatsDb::open(&path).unwrap()));
            stats.db.insert_batch("a", &[cpu(1.0), sample("icecast_disconnect_count", 3.0)], now_ms()).unwrap();
            stats.mark_baseline("a").unwrap();
        }
        // A new panel process reads the baseline back, and the cold (SQLite) read honors it.
        let stats = StatsService::new(Arc::new(StatsDb::open(&path).unwrap()));
        assert_eq!(totals(&stats).0, 0.0);
        // A deleted instance's baseline goes with it.
        stats.summaries(&[]).unwrap();
        assert!(stats.db.baselines().unwrap().is_empty());
    }
}
