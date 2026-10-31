//! Stats polling and queries. Port of v0.4.110's backend/api's stats/{poller,
//! poll-status,stats-service,metrics-format}.ts.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use airband_supervisor::{StatSample, StatsReader, StatsSource};
use serde::Serialize;
use tokio::sync::watch;

use crate::error::ApiError;
use crate::stats_db::{HistoryPoint, HistoryQuery, LatestSample, StatsDb, now_ms};
use crate::store::ConfigStore;

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
}

fn db_err(e: rusqlite::Error) -> ApiError {
    ApiError::Internal(e.to_string())
}

impl StatsService {
    pub fn new(db: Arc<StatsDb>) -> StatsService {
        StatsService { db, poll_status: Arc::new(PollStatusTracker::default()), latest: Mutex::new(HashMap::new()) }
    }

    /// Records a poll that was just stored, as `db.latest(name)` would now return it.
    pub fn record_poll(&self, name: &str, samples: &[StatSample]) {
        if samples.is_empty() {
            return; // nothing was stored, so the previous poll is still the latest
        }
        let latest = samples
            .iter()
            .map(|s| LatestSample { metric: s.metric.clone(), labels: s.labels.clone(), value: s.value })
            .collect();
        self.latest.lock().unwrap().insert(name.to_string(), Arc::new(latest));
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
        let mut out = BTreeMap::new();
        for name in names {
            let mut s = InstanceStatsSummary {
                buffer_overflow_total: 0.0,
                output_overrun_total: 0.0,
                inputs_dropping_count: 0,
                output_failure_total: 0.0,
                process_cpu_seconds: None,
            };
            for sample in self.latest(name)?.iter() {
                match sample.metric.as_str() {
                    m if OUTPUT_FAILURE_METRICS.contains(&m) => s.output_failure_total += sample.value,
                    "buffer_overflow_count" => s.buffer_overflow_total += sample.value,
                    "output_overrun_count" => s.output_overrun_total += sample.value,
                    "input_overrun_count" if sample.value > 0.0 => s.inputs_dropping_count += 1,
                    "process_cpu_seconds_total" => s.process_cpu_seconds = Some(sample.value),
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
                            stats.record_poll(&info.name, &samples);
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
}
