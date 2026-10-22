//! Historical stats storage (SQLite). Same schema and behavior as
//! v0.4.110's backend/api's stats/store.ts, so an existing stats.db keeps working:
//! `series` interns each (instance, metric, labels) once, `samples` holds
//! (series_id, value, ts).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use airband_supervisor::StatSample;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::store::canonical_labels;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LatestSample {
    pub metric: String,
    pub labels: BTreeMap<String, String>,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryPoint {
    pub ts: i64,
    pub value: f64,
}

pub struct HistoryQuery {
    pub metric: String,
    pub labels: BTreeMap<String, String>,
    pub since_ms: Option<i64>,
    pub until_ms: Option<i64>,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub struct StatsDb {
    conn: Mutex<Connection>,
    series_ids: Mutex<HashMap<String, i64>>,
}

impl StatsDb {
    pub fn open(path: &Path) -> rusqlite::Result<StatsDb> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "auto_vacuum", "INCREMENTAL")?;

        // Pre-0.3.1 databases had one flat samples table; that's regenerable
        // poll history, so drop it rather than migrate.
        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(samples)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<Result<_, _>>()?;
        if !columns.is_empty() && !columns.iter().any(|c| c == "series_id") {
            conn.execute_batch("DROP TABLE samples; VACUUM;")?;
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS series (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               instance TEXT NOT NULL,
               metric TEXT NOT NULL,
               labels TEXT NOT NULL
             );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_series_identity ON series(instance, metric, labels);
             CREATE TABLE IF NOT EXISTS samples (
               series_id INTEGER NOT NULL REFERENCES series(id),
               value REAL NOT NULL,
               ts INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_samples_series_ts ON samples(series_id, ts);
             CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);",
        )?;
        Ok(StatsDb { conn: Mutex::new(conn), series_ids: Mutex::new(HashMap::new()) })
    }

    pub fn insert_batch(&self, instance: &str, samples: &[StatSample], ts: i64) -> rusqlite::Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        // Which exact label sets report this poll, per (metric, freq): a series
        // still reporting is never the orphaned side of another's label change.
        let mut active: HashMap<String, HashSet<String>> = HashMap::new();
        for s in samples {
            if let Some(freq) = s.labels.get("freq") {
                active.entry(format!("{} {freq}", s.metric)).or_default().insert(canonical_labels(&s.labels));
            }
        }
        for s in samples {
            let labels = canonical_labels(&s.labels);
            let id =
                self.series_id(&tx, instance, &s.metric, &labels, s.labels.get("freq").map(String::as_str), &active)?;
            tx.execute("INSERT INTO samples (series_id, value, ts) VALUES (?, ?, ?)", params![id, s.value, ts])?;
        }
        tx.commit()
    }

    fn series_id(
        &self,
        conn: &Connection,
        instance: &str,
        metric: &str,
        labels: &str,
        freq: Option<&str>,
        active: &HashMap<String, HashSet<String>>,
    ) -> rusqlite::Result<i64> {
        let key = format!("{instance} {metric} {labels}");
        if let Some(id) = self.series_ids.lock().unwrap().get(&key) {
            return Ok(*id);
        }
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM series WHERE instance = ? AND metric = ? AND labels = ?",
                params![instance, metric, labels],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            self.series_ids.lock().unwrap().insert(key, id);
            return Ok(id);
        }

        // A channel's label set changes when its `label` is added/edited/removed;
        // carry its history over when exactly one same-freq series went quiet.
        if let Some(freq) = freq {
            let empty = HashSet::new();
            let active_at_freq = active.get(&format!("{metric} {freq}")).unwrap_or(&empty);
            let mut stmt = conn.prepare("SELECT id, labels FROM series WHERE instance = ? AND metric = ?")?;
            let candidates: Vec<i64> = stmt
                .query_map(params![instance, metric], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
                .filter_map(Result::ok)
                .filter(|(_, l)| !active_at_freq.contains(l))
                .filter(|(_, l)| {
                    serde_json::from_str::<BTreeMap<String, String>>(l)
                        .ok()
                        .and_then(|m| m.get("freq").cloned())
                        .as_deref()
                        == Some(freq)
                })
                .map(|(id, _)| id)
                .collect();
            if let [id] = candidates[..] {
                conn.execute("UPDATE series SET labels = ? WHERE id = ?", params![labels, id])?;
                let mut cache = self.series_ids.lock().unwrap();
                cache.retain(|_, v| *v != id);
                cache.insert(key, id);
                return Ok(id);
            }
        }

        conn.execute(
            "INSERT INTO series (instance, metric, labels) VALUES (?, ?, ?)",
            params![instance, metric, labels],
        )?;
        let id = conn.last_insert_rowid();
        self.series_ids.lock().unwrap().insert(key, id);
        Ok(id)
    }

    /// Every series' value from the most recent poll of this instance.
    pub fn latest(&self, instance: &str) -> rusqlite::Result<Vec<LatestSample>> {
        let conn = self.conn.lock().unwrap();
        let max_ts: Option<i64> = conn.query_row(
            "SELECT MAX(sa.ts) FROM samples sa JOIN series se ON se.id = sa.series_id WHERE se.instance = ?",
            params![instance],
            |r| r.get(0),
        )?;
        let Some(ts) = max_ts else { return Ok(Vec::new()) };
        let mut stmt = conn.prepare(
            "SELECT se.metric, se.labels, sa.value FROM samples sa JOIN series se ON se.id = sa.series_id
             WHERE se.instance = ? AND sa.ts = ?",
        )?;
        let rows = stmt.query_map(params![instance, ts], |r| {
            let labels: String = r.get(1)?;
            Ok(LatestSample {
                metric: r.get(0)?,
                labels: serde_json::from_str(&labels).unwrap_or_default(),
                value: r.get(2)?,
            })
        })?;
        rows.collect()
    }

    pub fn history(&self, instance: &str, q: &HistoryQuery) -> rusqlite::Result<Vec<HistoryPoint>> {
        let conn = self.conn.lock().unwrap();
        let id: Option<i64> = conn
            .query_row(
                "SELECT id FROM series WHERE instance = ? AND metric = ? AND labels = ?",
                params![instance, q.metric, canonical_labels(&q.labels)],
                |r| r.get(0),
            )
            .optional()?;
        let Some(id) = id else { return Ok(Vec::new()) };
        let mut stmt = conn.prepare(
            "SELECT ts, value FROM samples WHERE series_id = ?1
               AND (?2 IS NULL OR ts >= ?2) AND (?3 IS NULL OR ts <= ?3) ORDER BY ts ASC",
        )?;
        let rows = stmt
            .query_map(params![id, q.since_ms, q.until_ms], |r| Ok(HistoryPoint { ts: r.get(0)?, value: r.get(1)? }))?;
        rows.collect()
    }

    /// Deletes samples older than `retention_days` (<= 0 keeps everything) and orphaned series.
    pub fn prune(&self, retention_days: f64) -> rusqlite::Result<()> {
        if retention_days <= 0.0 {
            return Ok(());
        }
        let cutoff = now_ms() - (retention_days * 86_400_000.0) as i64;
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM samples WHERE ts < ?", params![cutoff])?;
        let orphaned =
            conn.execute("DELETE FROM series WHERE id NOT IN (SELECT DISTINCT series_id FROM samples)", [])?;
        if orphaned > 0 {
            self.series_ids.lock().unwrap().clear();
        }
        conn.execute_batch("PRAGMA incremental_vacuum;")
    }

    pub fn ping(&self) -> rusqlite::Result<()> {
        self.conn.lock().unwrap().query_row("SELECT 1", [], |_| Ok(()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(metric: &str, labels: &[(&str, &str)], value: f64) -> StatSample {
        StatSample {
            metric: metric.into(),
            labels: labels.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            value,
        }
    }

    #[test]
    fn latest_history_and_label_migration() {
        let dir = tempfile::tempdir().unwrap();
        let db = StatsDb::open(&dir.path().join("stats.db")).unwrap();
        db.insert_batch("a", &[sample("noise", &[("freq", "151.160")], 1.0), sample("cpu", &[], 5.0)], 1000).unwrap();
        db.insert_batch("a", &[sample("noise", &[("freq", "151.160"), ("label", "Tower")], 2.0)], 2000).unwrap();

        let latest = db.latest("a").unwrap();
        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].labels.get("label").map(String::as_str), Some("Tower"));

        // The relabeled channel kept its history.
        let labels: BTreeMap<String, String> =
            [("freq".to_string(), "151.160".to_string()), ("label".to_string(), "Tower".to_string())].into();
        let h =
            db.history("a", &HistoryQuery { metric: "noise".into(), labels, since_ms: None, until_ms: None }).unwrap();
        assert_eq!(h, [HistoryPoint { ts: 1000, value: 1.0 }, HistoryPoint { ts: 2000, value: 2.0 }]);

        let h = db
            .history(
                "a",
                &HistoryQuery { metric: "cpu".into(), labels: BTreeMap::new(), since_ms: Some(1001), until_ms: None },
            )
            .unwrap();
        assert!(h.is_empty());
        db.prune(7.0).unwrap();
        assert!(db.latest("a").unwrap().is_empty(), "samples from 1970 are older than 7 days");
        db.ping().unwrap();
    }
}
