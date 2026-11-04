//! Historical stats storage (SQLite), laid out to keep disk writes low: stats
//! arrive thousands of samples every few seconds, on hosts where disk load
//! costs audio.
//!
//! `series` interns each (instance, metric, labels) once. Samples are held in
//! memory and written once per 5-minute bucket, one packed row per series (see
//! `stats_chunk`) in `sample_chunks`. Its key starts with the bucket, so writes
//! append at one end of the table and pruning deletes from the other. Readers
//! see every poll, stored or held, as if each were written when it arrived.
//!
//! A crash loses what's held, up to one bucket of chart history. That's
//! acceptable because this database is regenerable.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use airband_supervisor::StatSample;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use serde::{Deserialize, Serialize};

use crate::stats_chunk::{self, BUCKET_MS, bucket_of};
use crate::store::canonical_labels;

/// What `PRAGMA user_version` holds. Anything older with a `samples` table is
/// replaced on open (see `replace_old_layout`).
const SCHEMA_VERSION: i32 = 2;

const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance TEXT NOT NULL,
      metric TEXT NOT NULL,
      labels TEXT NOT NULL,
      last_seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_series_identity ON series(instance, metric, labels);
    CREATE TABLE IF NOT EXISTS sample_chunks (
      bucket INTEGER NOT NULL,
      series_id INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (bucket, series_id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS instance_last_poll (
      instance TEXT PRIMARY KEY,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hardware_samples (
      instance TEXT NOT NULL,
      device INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      headroom_db REAL,
      noise_floor_dbfs REAL,
      freq_error_ppm REAL,
      gain_db REAL
    );
    CREATE INDEX IF NOT EXISTS idx_hardware_samples_ts ON hardware_samples(ts);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance TEXT NOT NULL,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_instance_id ON events(instance, id);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE TABLE IF NOT EXISTS summary_baselines (
      instance TEXT PRIMARY KEY,
      set_at INTEGER NOT NULL,
      samples TEXT NOT NULL
    );";

const STORED_BUCKET_RANGE: &str =
    "SELECT (SELECT MIN(bucket) FROM sample_chunks), (SELECT MAX(bucket) FROM sample_chunks)";

/// The tables worth keeping from an old-layout file. Its samples and series
/// are regenerable and would cost gigabytes of I/O to convert.
const KEPT_TABLES: [&str; 3] = ["events", "summary_baselines", "hardware_samples"];

/// Past this many held rows (flushes must have been failing for hours, say on
/// a full disk), the held rows are dropped rather than growing without limit.
const MAX_HELD_ROWS: usize = 4_000_000;

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

/// One SDR's Hardware-page readings at one poll (see hardware.rs), kept so
/// the page's gain advice starts from recent history instead of nothing.
#[derive(Debug, Clone, PartialEq)]
pub struct HardwareSample {
    pub instance: String,
    pub device: u32,
    pub ts: i64,
    pub headroom_db: Option<f64>,
    pub noise_floor_dbfs: Option<f64>,
    pub freq_error_ppm: Option<f64>,
    pub gain_db: Option<f64>,
}

/// The counter values an instance's Overview totals count up from, taken
/// when it was last restarted or live-applied by the panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SummaryBaseline {
    pub set_at: i64,
    pub samples: Vec<LatestSample>,
}

/// One error-log row as stored (see crate::events for the typed view).
#[derive(Debug, Clone, PartialEq)]
pub struct NewEvent {
    pub instance: String,
    pub ts: i64,
    pub kind: String,
    pub severity: String,
    pub message: String,
    /// JSON text.
    pub detail: Option<String>,
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
    /// Always locked after `conn`.
    held: Mutex<Held>,
}

/// What hasn't reached the database yet.
#[derive(Default)]
struct Held {
    /// The oldest bucket held; None when nothing is.
    bucket: Option<i64>,
    /// Each series' samples, oldest first.
    samples: HashMap<i64, Vec<(i64, f64)>>,
    hardware: Vec<HardwareSample>,
    /// Each instance's newest poll.
    last_polls: HashMap<String, i64>,
    rows: usize,
    /// Each series' newest sample since `series.last_seen` was last written,
    /// which outlives a flush: writing it costs a rewrite of the whole small
    /// table, so it happens hourly (at prune) rather than each bucket.
    seen: HashMap<i64, i64>,
}

impl Held {
    fn note_bucket(&mut self, ts: i64) {
        let bucket = bucket_of(ts);
        self.bucket = Some(self.bucket.map_or(bucket, |b| b.min(bucket)));
    }

    /// Whether `ts` has moved past the held bucket. A clock stepped well
    /// backwards counts too, so it can't hold samples back until time catches up.
    fn due(&self, ts: i64) -> bool {
        self.bucket.is_some_and(|b| {
            let bucket = bucket_of(ts);
            bucket > b || bucket < b - 1
        })
    }
}

fn has_table(conn: &Connection, schema: &str, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        &format!("SELECT EXISTS (SELECT 1 FROM {schema}.sqlite_master WHERE type = 'table' AND name = ?)"),
        [table],
        |r| r.get(0),
    )
}

fn with_suffix(path: &Path, suffix: &str) -> std::path::PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    name.into()
}

fn remove_if_present(path: &Path) -> rusqlite::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(rusqlite::Error::ToSqlConversionFailure(Box::new(e))),
        _ => Ok(()),
    }
}

/// Copies as much of `old.<table>` as can be read. A damaged page ends the
/// copy with an error but what came before it stays.
fn copy_kept_table(new: &Connection, table: &str) -> rusqlite::Result<()> {
    let mut read = new.prepare(&format!("SELECT * FROM old.{table}"))?;
    let columns = read.column_count();
    let placeholders = vec!["?"; columns].join(", ");
    let mut write = new.prepare(&format!("INSERT INTO main.{table} VALUES ({placeholders})"))?;
    let mut rows = read.query([])?;
    while let Some(row) = rows.next()? {
        let values =
            (0..columns).map(|i| row.get::<_, rusqlite::types::Value>(i)).collect::<rusqlite::Result<Vec<_>>>()?;
        write.execute(params_from_iter(values))?;
    }
    Ok(())
}

/// Moves a file from before `sample_chunks` to the new layout. It builds a new
/// file holding just `KEPT_TABLES` and renames it over the old one: dropping
/// the samples in place and vacuuming would itself be gigabytes of I/O on a
/// host that drops audio when its disk is busy. Sample history starts over.
fn replace_old_layout(path: &Path) -> rusqlite::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let old = Connection::open(path)?;
    let version: i32 = old.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version >= SCHEMA_VERSION || !has_table(&old, "main", "samples")? {
        return Ok(());
    }
    tracing::warn!(path = %path.display(), "stats database is in the old layout: replacing it; chart history starts over, the error log is kept");

    let new_path = with_suffix(path, ".migrate");
    for leftover in [new_path.clone(), with_suffix(&new_path, "-journal")] {
        remove_if_present(&leftover)?;
    }
    {
        let new = Connection::open(&new_path)?;
        new.execute_batch(SCHEMA)?;
        new.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        new.pragma_update(None, "synchronous", "OFF")?;
        new.execute("ATTACH DATABASE ? AS old", [path.to_string_lossy()])?;
        new.execute_batch("BEGIN")?;
        for table in KEPT_TABLES {
            let copied = has_table(&new, "old", table).and_then(|there| match there {
                true => copy_kept_table(&new, table),
                false => Ok(()),
            });
            if let Err(e) = copied {
                tracing::warn!(table, error = %e, "couldn't copy all of this table from the old stats database");
            }
        }
        new.execute_batch("COMMIT")?;
        new.execute_batch("DETACH DATABASE old")?;
    }
    if let Ok(meta) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&new_path, meta.permissions());
    }
    // Closing the last connection checkpoints and removes the old WAL. Anything
    // left of it goes before the rename, so it can't be replayed into the new file.
    drop(old);
    remove_if_present(&with_suffix(path, "-wal"))?;
    remove_if_present(&with_suffix(path, "-shm"))?;
    std::fs::rename(&new_path, path).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
}

impl StatsDb {
    pub fn open(path: &Path) -> rusqlite::Result<StatsDb> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        replace_old_layout(path)?;
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        // Safe against corruption in WAL mode, and drops the fsync per commit.
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        // An older panel run against this file recreates its own table.
        conn.execute_batch("DROP TABLE IF EXISTS samples;")?;
        conn.execute_batch(SCHEMA)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(StatsDb { conn: Mutex::new(conn), series_ids: Mutex::new(HashMap::new()), held: Mutex::default() })
    }

    /// Holds one poll in memory, stamped `ts` to the second, which is what
    /// makes timestamps cheap to store. Everything in a poll shares one `ts`,
    /// so readers can line its series up. Writes out what's held when `ts`
    /// enters a new bucket; if that fails, the poll is still held for the next try.
    pub fn insert_batch(&self, instance: &str, samples: &[StatSample], ts: i64) -> rusqlite::Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        let ts = ts - ts.rem_euclid(1000);
        let mut conn = self.conn.lock().unwrap();
        let mut held = self.held.lock().unwrap();
        let flushed = if held.due(ts) { flush_held(&mut conn, &mut held) } else { Ok(()) };

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
            let id = self.series_id(
                &tx,
                instance,
                &s.metric,
                &labels,
                s.labels.get("freq").map(String::as_str),
                &active,
                ts,
            )?;
            held.samples.entry(id).or_default().push((ts, s.value));
            held.seen.insert(id, ts);
        }
        tx.commit()?;
        held.rows += samples.len();
        held.note_bucket(ts);
        held.last_polls.insert(instance.to_string(), ts);
        flushed
    }

    #[allow(clippy::too_many_arguments)]
    fn series_id(
        &self,
        conn: &Connection,
        instance: &str,
        metric: &str,
        labels: &str,
        freq: Option<&str>,
        active: &HashMap<String, HashSet<String>>,
        ts: i64,
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
            "INSERT INTO series (instance, metric, labels, last_seen) VALUES (?, ?, ?, ?)",
            params![instance, metric, labels, ts],
        )?;
        let id = conn.last_insert_rowid();
        self.series_ids.lock().unwrap().insert(key, id);
        Ok(id)
    }

    /// Every series' value from the most recent poll of this instance.
    pub fn latest(&self, instance: &str) -> rusqlite::Result<Vec<LatestSample>> {
        let conn = self.conn.lock().unwrap();
        let held = self.held.lock().unwrap();
        let held_ts = held.last_polls.get(instance).copied();
        let ts = match held_ts {
            Some(ts) => Some(ts),
            None => conn
                .query_row("SELECT ts FROM instance_last_poll WHERE instance = ?", [instance], |r| r.get(0))
                .optional()?,
        };
        let Some(ts) = ts else { return Ok(Vec::new()) };
        let mut stmt = conn.prepare("SELECT id, metric, labels FROM series WHERE instance = ? ORDER BY id")?;
        let series = stmt
            .query_map([instance], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let at_poll = |points: &[(i64, f64)]| points.iter().rfind(|(t, _)| *t == ts).map(|(_, v)| *v);

        let mut out = Vec::new();
        for (id, metric, labels) in series {
            let value = match held_ts {
                Some(_) => held.samples.get(&id).and_then(|points| at_poll(points)),
                None => at_poll(&stored_chunk(&conn, bucket_of(ts), id)?),
            };
            if let Some(value) = value {
                out.push(LatestSample { metric, labels: serde_json::from_str(&labels).unwrap_or_default(), value });
            }
        }
        Ok(out)
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
        let in_range = |ts: i64| q.since_ms.is_none_or(|s| ts >= s) && q.until_ms.is_none_or(|u| ts <= u);

        let mut out = Vec::new();
        // One keyed seek per bucket, limited to the buckets that exist so a
        // wide range (or none) doesn't loop over empty ones.
        // As separate subqueries: SQLite only reads MIN or MAX off the key when
        // it's the sole aggregate, and otherwise scans the whole table.
        let stored: (Option<i64>, Option<i64>) =
            conn.query_row(STORED_BUCKET_RANGE, [], |r| Ok((r.get(0)?, r.get(1)?)))?;
        if let (Some(first), Some(last)) = stored {
            let from = q.since_ms.map_or(first, |s| bucket_of(s).max(first));
            let to = q.until_ms.map_or(last, |u| bucket_of(u).min(last));
            for bucket in from..=to {
                let points = stored_chunk(&conn, bucket, id)?;
                out.extend(points.into_iter().filter(|(ts, _)| in_range(*ts)));
            }
        }
        if let Some(points) = self.held.lock().unwrap().samples.get(&id) {
            out.extend(points.iter().filter(|(ts, _)| in_range(*ts)));
        }
        out.sort_by_key(|(ts, _)| *ts);
        Ok(out.into_iter().map(|(ts, value)| HistoryPoint { ts, value }).collect())
    }

    /// Holds these rows with the stats, so a Hardware page refreshing every
    /// second doesn't cost a commit every second.
    pub fn insert_hardware(&self, rows: &[HardwareSample]) -> rusqlite::Result<()> {
        let Some(ts) = rows.iter().map(|r| r.ts).max() else { return Ok(()) };
        let mut conn = self.conn.lock().unwrap();
        let mut held = self.held.lock().unwrap();
        let flushed = if held.due(ts) { flush_held(&mut conn, &mut held) } else { Ok(()) };
        held.hardware.extend_from_slice(rows);
        held.rows += rows.len();
        held.note_bucket(ts);
        flushed
    }

    /// Every SDR's hardware samples since `since_ms`, oldest first.
    pub fn hardware_history(&self, since_ms: i64) -> rusqlite::Result<Vec<HardwareSample>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT instance, device, ts, headroom_db, noise_floor_dbfs, freq_error_ppm, gain_db
               FROM hardware_samples WHERE ts >= ? ORDER BY ts ASC",
        )?;
        let rows = stmt.query_map(params![since_ms], |r| {
            Ok(HardwareSample {
                instance: r.get(0)?,
                device: r.get(1)?,
                ts: r.get(2)?,
                headroom_db: r.get(3)?,
                noise_floor_dbfs: r.get(4)?,
                freq_error_ppm: r.get(5)?,
                gain_db: r.get(6)?,
            })
        })?;
        let mut out = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        out.extend(self.held.lock().unwrap().hardware.iter().filter(|r| r.ts >= since_ms).cloned());
        out.sort_by_key(|r| r.ts);
        Ok(out)
    }

    /// Deletes samples older than `retention_days` (<= 0 keeps everything) and series gone that long.
    pub fn prune(&self, retention_days: f64) -> rusqlite::Result<()> {
        if retention_days <= 0.0 {
            return Ok(());
        }
        self.prune_before(now_ms() - (retention_days * 86_400_000.0) as i64)
    }

    /// Writes everything held to the database. The poller flushes by bucket on
    /// its own; this is for shutdown.
    pub fn flush(&self) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let mut held = self.held.lock().unwrap();
        flush_held(&mut conn, &mut held)?;
        write_seen(&mut conn, &mut held)
    }

    /// Writes out what's held once `now` has moved past its bucket, for when
    /// no poll arrives to do it (every instance stopped, say).
    pub fn flush_if_due(&self, now: i64) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let mut held = self.held.lock().unwrap();
        if held.due(now) { flush_held(&mut conn, &mut held) } else { Ok(()) }
    }

    /// Deletes samples older than `cutoff` (ms), and series not heard from
    /// since then. Whole buckets go, so a sample can outlive `cutoff` by up to
    /// one bucket. Freed pages are reused by later writes rather than vacuumed:
    /// a vacuum rewrites pages, and the file settles at a steady size anyway.
    pub fn prune_before(&self, cutoff: i64) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let mut held = self.held.lock().unwrap();
        flush_held(&mut conn, &mut held)?;
        write_seen(&mut conn, &mut held)?;
        drop(held);

        let bucket = bucket_of(cutoff);
        let boundary = bucket * BUCKET_MS;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM sample_chunks WHERE bucket < ?", [bucket])?;
        tx.execute("DELETE FROM hardware_samples WHERE ts < ?", [cutoff])?;
        tx.execute("DELETE FROM events WHERE ts < ?", [cutoff])?;
        tx.execute("DELETE FROM instance_last_poll WHERE ts < ?", [boundary])?;
        let orphaned = tx.execute("DELETE FROM series WHERE last_seen < ?", [boundary])?;
        tx.commit()?;
        if orphaned > 0 {
            self.series_ids.lock().unwrap().clear();
        }
        Ok(())
    }

    /// Stores the Overview counters' zero point for an instance (see
    /// `StatsService::mark_baseline`), replacing any earlier one.
    pub fn set_baseline(&self, instance: &str, baseline: &SummaryBaseline) -> rusqlite::Result<()> {
        let samples = serde_json::to_string(&baseline.samples).expect("samples serialize");
        self.conn.lock().unwrap().execute(
            "INSERT OR REPLACE INTO summary_baselines (instance, set_at, samples) VALUES (?, ?, ?)",
            params![instance, baseline.set_at, samples],
        )?;
        Ok(())
    }

    pub fn clear_baseline(&self, instance: &str) -> rusqlite::Result<()> {
        self.conn.lock().unwrap().execute("DELETE FROM summary_baselines WHERE instance = ?", params![instance])?;
        Ok(())
    }

    pub fn baselines(&self) -> rusqlite::Result<HashMap<String, SummaryBaseline>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT instance, set_at, samples FROM summary_baselines")?;
        let rows = stmt.query_map([], |r| {
            let samples: String = r.get(2)?;
            Ok((
                r.get::<_, String>(0)?,
                SummaryBaseline { set_at: r.get(1)?, samples: serde_json::from_str(&samples).unwrap_or_default() },
            ))
        })?;
        rows.collect()
    }

    /// Appends one entry to the error log; returns its id.
    pub fn insert_event(&self, e: &NewEvent) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO events (instance, ts, kind, severity, message, detail) VALUES (?, ?, ?, ?, ?, ?)",
            params![e.instance, e.ts, e.kind, e.severity, e.message, e.detail],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Newest first: up to `limit` events with ids below `before`, for one
    /// instance or all of them.
    pub fn list_events(
        &self,
        instance: Option<&str>,
        before: Option<i64>,
        limit: u32,
    ) -> rusqlite::Result<Vec<(i64, NewEvent)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, instance, ts, kind, severity, message, detail FROM events
              WHERE (?1 IS NULL OR instance = ?1) AND (?2 IS NULL OR id < ?2)
              ORDER BY id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![instance, before, limit], |r| {
            Ok((
                r.get(0)?,
                NewEvent {
                    instance: r.get(1)?,
                    ts: r.get(2)?,
                    kind: r.get(3)?,
                    severity: r.get(4)?,
                    message: r.get(5)?,
                    detail: r.get(6)?,
                },
            ))
        })?;
        rows.collect()
    }

    pub fn ping(&self) -> rusqlite::Result<()> {
        self.conn.lock().unwrap().query_row("SELECT 1", [], |_| Ok(()))
    }
}

impl Drop for StatsDb {
    fn drop(&mut self) {
        if let Err(e) = self.flush() {
            tracing::warn!(error = %e, "couldn't write out held stats");
        }
    }
}

/// One series' stored samples in one bucket. A damaged chunk reads as empty:
/// it's only chart history, and the rest of the range is still good.
fn stored_chunk(conn: &Connection, bucket: i64, id: i64) -> rusqlite::Result<Vec<(i64, f64)>> {
    let mut stmt = conn.prepare_cached("SELECT data FROM sample_chunks WHERE bucket = ? AND series_id = ?")?;
    let data: Option<Vec<u8>> = stmt.query_row(params![bucket, id], |r| r.get(0)).optional()?;
    Ok(data.map_or_else(Vec::new, |data| {
        stats_chunk::decode(bucket, &data).unwrap_or_else(|e| {
            tracing::warn!(bucket, series = id, error = %e, "skipping a damaged stats chunk");
            Vec::new()
        })
    }))
}

/// Writes everything held in one transaction. A chunk that exists already (a
/// flush partway through a bucket, or a restart) is appended to, which the
/// format allows without decoding it. On failure everything stays held, up to
/// `MAX_HELD_ROWS`.
fn flush_held(conn: &mut Connection, held: &mut Held) -> rusqlite::Result<()> {
    if held.rows == 0 {
        return Ok(());
    }
    match write_held(conn, held) {
        Ok(()) => {
            let seen = std::mem::take(&mut held.seen);
            *held = Held { seen, ..Held::default() };
            Ok(())
        }
        Err(e) => {
            if held.rows > MAX_HELD_ROWS {
                tracing::warn!(rows = held.rows, error = %e, "dropping held stats after repeated write failures");
                let seen = std::mem::take(&mut held.seen);
                *held = Held { seen, ..Held::default() };
            }
            Err(e)
        }
    }
}

fn write_held(conn: &mut Connection, held: &Held) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        // Rows in key order: every one lands at the end of the table.
        let mut chunks: Vec<(i64, i64, Vec<u8>)> = Vec::with_capacity(held.samples.len());
        for (id, points) in &held.samples {
            for run in points.chunk_by(|a, b| bucket_of(a.0) == bucket_of(b.0)) {
                let bucket = bucket_of(run[0].0);
                let mut data = Vec::new();
                stats_chunk::encode_frame(bucket, run, &mut data);
                chunks.push((bucket, *id, data));
            }
        }
        chunks.sort_by_key(|(bucket, id, _)| (*bucket, *id));
        let mut insert = tx.prepare_cached(
            "INSERT INTO sample_chunks (bucket, series_id, data) VALUES (?, ?, ?)
             ON CONFLICT (bucket, series_id) DO UPDATE SET data = CAST(data || excluded.data AS BLOB)",
        )?;
        for (bucket, id, data) in chunks {
            insert.execute(params![bucket, id, data])?;
        }
        let mut last_poll = tx.prepare_cached(
            "INSERT INTO instance_last_poll (instance, ts) VALUES (?, ?)
             ON CONFLICT (instance) DO UPDATE SET ts = excluded.ts",
        )?;
        for (instance, ts) in &held.last_polls {
            last_poll.execute(params![instance, ts])?;
        }
        let mut hardware = tx.prepare_cached(
            "INSERT INTO hardware_samples (instance, device, ts, headroom_db, noise_floor_dbfs, freq_error_ppm, gain_db)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )?;
        for r in &held.hardware {
            hardware.execute(params![
                r.instance,
                r.device,
                r.ts,
                r.headroom_db,
                r.noise_floor_dbfs,
                r.freq_error_ppm,
                r.gain_db
            ])?;
        }
    }
    tx.commit()
}

fn write_seen(conn: &mut Connection, held: &mut Held) -> rusqlite::Result<()> {
    if held.seen.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction()?;
    {
        let mut update = tx.prepare_cached("UPDATE series SET last_seen = ? WHERE id = ?")?;
        for (id, ts) in &held.seen {
            update.execute(params![ts, id])?;
        }
    }
    tx.commit()?;
    held.seen.clear();
    Ok(())
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

    #[test]
    fn latest_is_the_instances_most_recent_poll() {
        let dir = tempfile::tempdir().unwrap();
        let db = StatsDb::open(&dir.path().join("stats.db")).unwrap();
        for ts in 1..=50 {
            db.insert_batch("a", &[sample("cpu", &[], ts as f64), sample("noise", &[("freq", "1")], 0.5)], ts * 1000)
                .unwrap();
        }
        // A series that stopped reporting isn't part of the latest poll.
        db.insert_batch("a", &[sample("cpu", &[], 99.0)], 60_000).unwrap();
        // Another instance's newer samples don't leak in.
        db.insert_batch("b", &[sample("cpu", &[], 7.0)], 90_000).unwrap();

        assert_eq!(
            db.latest("a").unwrap(),
            [LatestSample { metric: "cpu".into(), labels: BTreeMap::new(), value: 99.0 }]
        );
        assert_eq!(db.latest("b").unwrap().len(), 1);
        assert!(db.latest("missing").unwrap().is_empty());
    }

    #[test]
    fn baselines_survive_reopening() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        let b = SummaryBaseline {
            set_at: 42,
            samples: vec![LatestSample { metric: "cpu".into(), labels: BTreeMap::new(), value: 3.0 }],
        };
        {
            let db = StatsDb::open(&path).unwrap();
            db.set_baseline("a", &b).unwrap();
            db.set_baseline("b", &b).unwrap();
            db.clear_baseline("b").unwrap();
        }
        let db = StatsDb::open(&path).unwrap();
        let all = db.baselines().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all["a"], b);
    }

    #[test]
    fn hardware_history_round_trips_and_prunes() {
        let dir = tempfile::tempdir().unwrap();
        let db = StatsDb::open(&dir.path().join("stats.db")).unwrap();
        let row = |instance: &str, device, ts| HardwareSample {
            instance: instance.into(),
            device,
            ts,
            headroom_db: Some(4.5),
            noise_floor_dbfs: None,
            freq_error_ppm: Some(-0.4),
            gain_db: Some(37.2),
        };
        db.insert_hardware(&[row("a", 0, 1000), row("a", 1, 1000)]).unwrap();
        db.insert_hardware(&[row("a", 0, 2000)]).unwrap();

        assert_eq!(db.hardware_history(0).unwrap(), [row("a", 0, 1000), row("a", 1, 1000), row("a", 0, 2000)]);
        assert_eq!(db.hardware_history(1001).unwrap(), [row("a", 0, 2000)]);
        db.prune(7.0).unwrap();
        assert!(db.hardware_history(0).unwrap().is_empty(), "samples from 1970 are older than 7 days");
    }

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn query(metric: &str, labels: BTreeMap<String, String>) -> HistoryQuery {
        HistoryQuery { metric: metric.into(), labels, since_ms: None, until_ms: None }
    }

    /// A start far from the epoch, on a bucket boundary.
    const T0: i64 = 1_780_000_200_000;

    fn cpu_at(db: &StatsDb, ts: i64, value: f64) {
        db.insert_batch("a", &[sample("cpu", &[], value)], ts).unwrap();
    }

    fn cpu_history(db: &StatsDb) -> Vec<HistoryPoint> {
        db.history("a", &query("cpu", BTreeMap::new())).unwrap()
    }

    fn stored_rows(path: &Path) -> i64 {
        Connection::open(path).unwrap().query_row("SELECT COUNT(*) FROM sample_chunks", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn history_reads_the_same_held_stored_or_across_buckets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        let db = StatsDb::open(&path).unwrap();
        let polls: Vec<(i64, f64)> = (0..50).map(|i| (T0 + i * 15_000, -38.5 + i as f64 / 1000.0)).collect();
        let want: Vec<HistoryPoint> = polls.iter().map(|(ts, value)| HistoryPoint { ts: *ts, value: *value }).collect();

        for (ts, value) in &polls {
            cpu_at(&db, *ts, *value);
            assert_eq!(cpu_history(&db).last(), Some(&HistoryPoint { ts: *ts, value: *value }));
        }
        assert_eq!(cpu_history(&db), want, "50 polls span three buckets: part stored, part held");
        assert_eq!(stored_rows(&path), 2, "the two finished buckets were written; the third is held");

        db.flush().unwrap();
        assert_eq!(cpu_history(&db), want, "all stored");
        drop(db);
        assert_eq!(cpu_history(&StatsDb::open(&path).unwrap()), want, "reopened");
    }

    #[test]
    fn writes_wait_for_a_new_bucket() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        let db = StatsDb::open(&path).unwrap();
        for i in 0..20 {
            cpu_at(&db, T0 + i * 15_000, i as f64);
        }
        assert_eq!(stored_rows(&path), 0, "20 polls fit in one bucket");
        cpu_at(&db, T0 + BUCKET_MS, 20.0);
        assert_eq!(stored_rows(&path), 1);
        assert_eq!(cpu_history(&db).len(), 21);
    }

    #[test]
    fn a_flush_partway_through_a_bucket_then_a_restart_appends() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        {
            let db = StatsDb::open(&path).unwrap();
            cpu_at(&db, T0, 1.0);
            cpu_at(&db, T0 + 15_000, 2.5);
        } // Dropping flushes, as a clean shutdown does.
        assert_eq!(stored_rows(&path), 1);
        let db = StatsDb::open(&path).unwrap();
        cpu_at(&db, T0 + 30_000, f64::NAN);
        cpu_at(&db, T0 + 45_000, 4.0);
        db.flush().unwrap();
        assert_eq!(stored_rows(&path), 1, "same bucket, same row");
        let h = cpu_history(&db);
        assert_eq!(h.iter().map(|p| p.ts).collect::<Vec<_>>(), [T0, T0 + 15_000, T0 + 30_000, T0 + 45_000]);
        assert_eq!((h[0].value, h[1].value, h[3].value), (1.0, 2.5, 4.0));
        assert!(h[2].value.is_nan());
    }

    #[test]
    fn a_polls_series_share_a_timestamp_whichever_ms_it_arrived() {
        // The Stats page's squelch line joins three metrics on exact ts.
        let dir = tempfile::tempdir().unwrap();
        let db = StatsDb::open(&dir.path().join("stats.db")).unwrap();
        let channel = [("freq", "151.160")];
        for i in 0..30 {
            let poll = [
                sample("channel_dbfs_signal_level", &channel, -40.0 + i as f64),
                sample("channel_signal_level", &channel, 0.016),
                sample("channel_squelch_level", &channel, 0.04),
            ];
            db.insert_batch("a", &poll, T0 + i * 15_000 + 437).unwrap();
        }
        let times = |metric: &str| -> Vec<i64> {
            db.history("a", &query(metric, labels(&channel))).unwrap().iter().map(|p| p.ts).collect()
        };
        let signal = times("channel_dbfs_signal_level");
        assert_eq!(signal.len(), 30);
        assert_eq!(signal[0], T0, "stamped to the second");
        assert_eq!(signal, times("channel_signal_level"));
        assert_eq!(signal, times("channel_squelch_level"));
    }

    #[test]
    fn history_honors_its_range_and_tolerates_a_wide_one() {
        let dir = tempfile::tempdir().unwrap();
        let db = StatsDb::open(&dir.path().join("stats.db")).unwrap();
        for i in 0..100 {
            cpu_at(&db, T0 + i * 15_000, i as f64);
        }
        let range = |since_ms, until_ms| {
            let q = HistoryQuery { metric: "cpu".into(), labels: BTreeMap::new(), since_ms, until_ms };
            db.history("a", &q).unwrap().iter().map(|p| p.value).collect::<Vec<_>>()
        };
        assert_eq!(range(Some(T0 + 150_000), Some(T0 + 180_000)), [10.0, 11.0, 12.0]);
        assert_eq!(range(Some(T0 + 1_485_000), None), [99.0]);
        assert_eq!(range(None, Some(T0)), [0.0]);
        assert_eq!(range(Some(0), Some(i64::MAX)).len(), 100);
        assert!(range(Some(T0 + 100_000_000), None).is_empty());
    }

    #[test]
    fn readers_seek_instead_of_scanning_the_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        drop(StatsDb::open(&path).unwrap());
        let conn = Connection::open(&path).unwrap();
        let plan = |sql: &str| -> String {
            conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(3))
                .unwrap()
                .map(Result::unwrap)
                .collect::<Vec<_>>()
                .join("; ")
        };
        assert!(plan(STORED_BUCKET_RANGE).contains("SEARCH"), "{}", plan(STORED_BUCKET_RANGE));
        assert!(!plan(STORED_BUCKET_RANGE).contains("SCAN sample_chunks"), "{}", plan(STORED_BUCKET_RANGE));
        let chunk = plan("SELECT data FROM sample_chunks WHERE bucket = 1 AND series_id = 1");
        assert!(chunk.contains("SEARCH") && chunk.contains("PRIMARY KEY"), "{chunk}");
    }

    #[test]
    fn a_relabelled_channel_keeps_history_across_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let db = StatsDb::open(&dir.path().join("stats.db")).unwrap();
        db.insert_batch("a", &[sample("noise", &[("freq", "1")], 1.0)], T0).unwrap();
        db.flush().unwrap();
        db.insert_batch("a", &[sample("noise", &[("freq", "1"), ("label", "Tower")], 2.0)], T0 + BUCKET_MS).unwrap();
        let h = db.history("a", &query("noise", labels(&[("freq", "1"), ("label", "Tower")]))).unwrap();
        assert_eq!(h.iter().map(|p| p.value).collect::<Vec<_>>(), [1.0, 2.0]);
    }

    #[test]
    fn latest_reads_back_cold_with_only_the_newest_poll() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        {
            let db = StatsDb::open(&path).unwrap();
            db.insert_batch("a", &[sample("gone", &[], 1.0), sample("cpu", &[], 1.0)], T0).unwrap();
            db.insert_batch("a", &[sample("cpu", &[], 7.5), sample("noise", &[("freq", "1")], -3.25)], T0 + BUCKET_MS)
                .unwrap();
            db.insert_batch("b", &[sample("cpu", &[], 2.0)], T0 + BUCKET_MS).unwrap();
        }
        let db = StatsDb::open(&path).unwrap();
        assert_eq!(
            db.latest("a").unwrap(),
            [
                LatestSample { metric: "cpu".into(), labels: BTreeMap::new(), value: 7.5 },
                LatestSample { metric: "noise".into(), labels: labels(&[("freq", "1")]), value: -3.25 },
            ],
            "'gone' didn't report in the last poll"
        );
        assert_eq!(db.latest("b").unwrap().len(), 1);
    }

    #[test]
    fn latest_without_a_clean_shutdown_is_the_last_stored_poll() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        let db = StatsDb::open(&path).unwrap();
        cpu_at(&db, T0, 1.0);
        cpu_at(&db, T0 + BUCKET_MS, 2.0); // writes the first bucket, holds this one
        std::mem::forget(db); // a crash: nothing further is written
        let db = StatsDb::open(&path).unwrap();
        assert_eq!(db.latest("a").unwrap()[0].value, 1.0);
        assert_eq!(cpu_history(&db).len(), 1, "the held poll is lost, and only it");
    }

    #[test]
    fn prune_removes_old_buckets_and_series_gone_that_long() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        let db = StatsDb::open(&path).unwrap();
        db.insert_batch("a", &[sample("old", &[], 1.0), sample("cpu", &[], 1.0)], T0).unwrap();
        db.insert_batch("gone", &[sample("old", &[], 1.0)], T0).unwrap();
        db.insert_batch("a", &[sample("cpu", &[], 2.0)], T0 + 10 * BUCKET_MS).unwrap();

        db.prune_before(T0 + 5 * BUCKET_MS).unwrap();

        assert_eq!(db.history("a", &query("cpu", BTreeMap::new())).unwrap().len(), 1, "cpu's old bucket went");
        let conn = Connection::open(&path).unwrap();
        let names: Vec<String> = conn
            .prepare("SELECT instance || '/' || metric FROM series ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(names, ["a/cpu"], "only the series still reporting stays");
        assert!(db.latest("gone").unwrap().is_empty());
        assert_eq!(db.latest("a").unwrap().len(), 1);
    }

    #[test]
    fn a_series_seen_within_retention_survives_prune_even_if_idle() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        {
            let db = StatsDb::open(&path).unwrap();
            cpu_at(&db, T0, 1.0);
            cpu_at(&db, T0 + 20 * BUCKET_MS, 2.0);
        }
        let db = StatsDb::open(&path).unwrap();
        // Nothing has reported in this process, so only the stored last_seen protects it.
        db.prune_before(T0 + 10 * BUCKET_MS).unwrap();
        assert_eq!(cpu_history(&db).len(), 1);
        assert_eq!(db.latest("a").unwrap()[0].value, 2.0);
    }

    #[test]
    fn hardware_rows_wait_for_a_flush_but_read_back_at_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        let db = StatsDb::open(&path).unwrap();
        let row = |ts| HardwareSample {
            instance: "a".into(),
            device: 0,
            ts,
            headroom_db: None,
            noise_floor_dbfs: None,
            freq_error_ppm: None,
            gain_db: None,
        };
        let stored = || -> i64 {
            Connection::open(&path)
                .unwrap()
                .query_row("SELECT COUNT(*) FROM hardware_samples", [], |r| r.get(0))
                .unwrap()
        };
        db.insert_hardware(&[row(T0)]).unwrap();
        db.insert_hardware(&[row(T0 + 1)]).unwrap();
        assert_eq!(stored(), 0);
        assert_eq!(db.hardware_history(0).unwrap().len(), 2);
        db.insert_hardware(&[row(T0 + BUCKET_MS)]).unwrap();
        assert_eq!(stored(), 2);
        assert_eq!(db.hardware_history(T0 + 1).unwrap().len(), 2, "one stored, one held");
    }

    #[test]
    fn flush_if_due_writes_when_no_poll_arrives() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        let db = StatsDb::open(&path).unwrap();
        cpu_at(&db, T0, 1.0);
        db.flush_if_due(T0 + BUCKET_MS - 1).unwrap();
        assert_eq!(stored_rows(&path), 0);
        db.flush_if_due(T0 + BUCKET_MS).unwrap();
        assert_eq!(stored_rows(&path), 1);
    }

    /// A file as every panel up to 0.6.50 left it, WAL included.
    fn old_layout_db(path: &Path) -> Connection {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA auto_vacuum = INCREMENTAL;
             CREATE TABLE series (id INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT NOT NULL, metric TEXT NOT NULL, labels TEXT NOT NULL);
             CREATE UNIQUE INDEX idx_series_identity ON series(instance, metric, labels);
             CREATE TABLE samples (series_id INTEGER NOT NULL REFERENCES series(id), value REAL NOT NULL, ts INTEGER NOT NULL);
             CREATE INDEX idx_samples_series_ts ON samples(series_id, ts);
             CREATE INDEX idx_samples_ts ON samples(ts);
             CREATE TABLE hardware_samples (instance TEXT NOT NULL, device INTEGER NOT NULL, ts INTEGER NOT NULL,
               headroom_db REAL, noise_floor_dbfs REAL, freq_error_ppm REAL, gain_db REAL);
             CREATE INDEX idx_hardware_samples_ts ON hardware_samples(ts);
             CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, instance TEXT NOT NULL, ts INTEGER NOT NULL,
               kind TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, detail TEXT);
             CREATE INDEX idx_events_instance_id ON events(instance, id);
             CREATE INDEX idx_events_ts ON events(ts);
             CREATE TABLE summary_baselines (instance TEXT PRIMARY KEY, set_at INTEGER NOT NULL, samples TEXT NOT NULL);
             INSERT INTO series (instance, metric, labels) VALUES ('a', 'cpu', '{}');
             INSERT INTO samples VALUES (1, 1.0, 1000), (1, 2.0, 2000);
             INSERT INTO hardware_samples VALUES ('a', 0, 5000, 4.5, NULL, -0.4, 37.2);
             INSERT INTO events (id, instance, ts, kind, severity, message, detail) VALUES
               (7, 'a', 3000, 'crash', 'error', 'older', NULL), (9, 'a', 4000, 'crash', 'error', 'newer', '{\"x\":1}');
             INSERT INTO summary_baselines VALUES ('a', 42, '[]');",
        )
        .unwrap();
        conn
    }

    fn assert_kept_everything_but_samples(db: &StatsDb, path: &Path) {
        let events = db.list_events(None, None, 10).unwrap();
        assert_eq!(
            events.iter().map(|(id, e)| (*id, e.message.as_str())).collect::<Vec<_>>(),
            [(9, "newer"), (7, "older")]
        );
        assert_eq!(events[0].1.detail.as_deref(), Some("{\"x\":1}"));
        assert_eq!(db.baselines().unwrap()["a"].set_at, 42);
        assert_eq!(db.hardware_history(0).unwrap()[0].gain_db, Some(37.2));
        assert!(db.latest("a").unwrap().is_empty());

        let conn = Connection::open(path).unwrap();
        let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert!(!has_table(&conn, "main", "samples").unwrap());
        let vacuum: i32 = conn.pragma_query_value(None, "auto_vacuum", |r| r.get(0)).unwrap();
        assert_eq!(vacuum, 0, "the old file's auto_vacuum pointer pages don't carry over");
    }

    #[test]
    fn an_old_layout_file_is_replaced_keeping_the_error_log() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        drop(old_layout_db(&path));

        let db = StatsDb::open(&path).unwrap();
        assert_kept_everything_but_samples(&db, &path);
        assert!(!with_suffix(&path, ".migrate").exists());

        // New events keep counting up from the old ids.
        let id = db
            .insert_event(&NewEvent {
                instance: "a".into(),
                ts: 6000,
                kind: "crash".into(),
                severity: "error".into(),
                message: "after".into(),
                detail: None,
            })
            .unwrap();
        assert_eq!(id, 10);

        // Sample history starts over and works; reopening changes nothing else.
        cpu_at(&db, T0, 1.0);
        drop(db);
        let db = StatsDb::open(&path).unwrap();
        assert_eq!(cpu_history(&db).len(), 1);
        assert_eq!(db.list_events(None, None, 10).unwrap().len(), 3);
    }

    #[test]
    fn replacing_an_old_layout_file_with_a_live_wal_keeps_recent_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        let old = old_layout_db(&path);
        // A crashed panel: the WAL still holds its last commits.
        std::mem::forget(old);
        assert!(with_suffix(&path, "-wal").exists());

        let db = StatsDb::open(&path).unwrap();
        assert_kept_everything_but_samples(&db, &path);
    }

    #[test]
    fn an_interrupted_replacement_starts_again() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        drop(old_layout_db(&path));
        std::fs::write(with_suffix(&path, ".migrate"), b"half-finished").unwrap();
        std::fs::write(with_suffix(&path, ".migrate-journal"), b"half-finished").unwrap();

        let db = StatsDb::open(&path).unwrap();
        assert_kept_everything_but_samples(&db, &path);
    }

    #[test]
    fn a_damaged_old_table_does_not_stop_the_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        let old = old_layout_db(&path);
        // Stand-in for an unreadable table: columns the new one can't take.
        old.execute_batch(
            "DROP TABLE hardware_samples;
             CREATE TABLE hardware_samples (only_one_column TEXT);
             INSERT INTO hardware_samples VALUES ('x');",
        )
        .unwrap();
        drop(old);

        let db = StatsDb::open(&path).unwrap();
        assert_eq!(db.list_events(None, None, 10).unwrap().len(), 2, "the other tables still came across");
        assert!(db.hardware_history(0).unwrap().is_empty());
    }

    #[test]
    fn a_table_left_by_rolling_back_and_forward_goes_away() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.db");
        drop(StatsDb::open(&path).unwrap());
        // An older panel run against the new file makes its own table.
        Connection::open(&path)
            .unwrap()
            .execute_batch(
                "CREATE TABLE samples (series_id INTEGER NOT NULL, value REAL NOT NULL, ts INTEGER NOT NULL);",
            )
            .unwrap();
        cpu_at(&StatsDb::open(&path).unwrap(), T0, 1.0);
        let conn = Connection::open(&path).unwrap();
        assert!(!has_table(&conn, "main", "samples").unwrap());
        assert_eq!(stored_rows(&path), 1, "the new layout's data stays");
    }
}
