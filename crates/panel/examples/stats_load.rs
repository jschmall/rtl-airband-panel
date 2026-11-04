//! Replays prod's stats load against the real `StatsDb` and reports the disk
//! I/O it causes, so storage changes can be measured instead of guessed at.
//!
//!     cargo run --release -p rtl-airband-panel --example stats_load -- \
//!         --db /tmp/stats.db --phase day [--hours 24]
//!
//! Phases (time is simulated from a fixed start, nothing sleeps):
//! - `day`: from an empty file, poll for --hours; reports each hour.
//! - `seed`: fill --days of history. --bulk writes it with a raw connection
//!   instead of through `StatsDb`, which is how the row-per-sample layout
//!   avoids a terabyte of writes just to set up the measurement.
//! - `measure`: continue a seeded file for --hours, pruning hourly the way
//!   the poller does, and report polling and pruning separately.
//! - `read`: time a 24 h history query and a cold `latest`.
//!
//! The series follow what the fork's stats output prints: 2,338 series over
//! 12 instances, mostly counters that rarely move plus %.3f gauges that move
//! on every poll. Prod's exact change rate isn't known here, so the mix below
//! is a stated assumption. To see real page-cache misses in `measure`, drop
//! the file's cached pages first:
//!     dd of=/tmp/stats.db oflag=nocache conv=notrunc,fdatasync count=0

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use airband_supervisor::StatSample;
use panel::stats_db::{HardwareSample, HistoryQuery, StatsDb};
use panel::store::canonical_labels;

const POLL_MS: i64 = 15_000;
const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;
const START_MS: i64 = 1_780_000_000_000;
const INSTANCES: usize = 12;
const CHANNELS_PER_INSTANCE: usize = 15;
const TOTAL_SERIES: usize = 2_338;
const RETENTION_MS: i64 = 7 * DAY_MS;

/// xorshift64*: deterministic, so before and after runs see the same load.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }
    /// -1.0 to 1.0.
    fn spread(&mut self) -> f64 {
        self.unit() * 2.0 - 1.0
    }
}

/// How a series moves from poll to poll.
#[derive(Clone, Copy)]
enum Kind {
    /// A counter stuck where it is (most failure counters: 0).
    Stuck,
    /// A counter that goes up by about `step` with probability `p`.
    Counter { p: f64, step: f64 },
    /// A counter that goes up every poll (`decimals` as printed).
    Steady { step: f64, decimals: i32 },
    /// A gauge that wanders around `center` on every poll.
    Gauge { center: f64, wander: f64, decimals: i32 },
    /// A gauge that holds, then jumps with probability `p`.
    Sticky { center: f64, wander: f64, p: f64, decimals: i32 },
}

struct Series {
    metric: &'static str,
    labels: BTreeMap<String, String>,
    kind: Kind,
    value: f64,
}

fn rounded(v: f64, decimals: i32) -> f64 {
    let scale = 10f64.powi(decimals);
    (v * scale).round() / scale
}

impl Series {
    fn new(metric: &'static str, labels: BTreeMap<String, String>, kind: Kind) -> Series {
        let value = match kind {
            Kind::Gauge { center, .. } | Kind::Sticky { center, .. } => center,
            _ => 0.0,
        };
        Series { metric, labels, kind, value }
    }

    fn step(&mut self, rng: &mut Rng) {
        match self.kind {
            Kind::Stuck => {}
            Kind::Counter { p, step } => {
                if rng.chance(p) {
                    self.value += (step * (0.5 + rng.unit())).round().max(1.0);
                }
            }
            Kind::Steady { step, decimals } => {
                self.value = rounded(self.value + step * (0.9 + 0.2 * rng.unit()), decimals)
            }
            Kind::Gauge { center, wander, decimals } => self.value = rounded(center + wander * rng.spread(), decimals),
            Kind::Sticky { center, wander, p, decimals } => {
                if rng.chance(p) {
                    self.value = rounded(center + wander * rng.spread(), decimals);
                }
            }
        }
    }
}

/// One instance's series: per channel a dozen metrics, then device and output
/// counters up to `total`.
fn instance_series(index: usize, total: usize) -> Vec<Series> {
    let mut out = Vec::with_capacity(total);
    for ch in 0..CHANNELS_PER_INSTANCE {
        let freq = format!("{:.3}", 118.0 + index as f64 * 4.0 + ch as f64 * 0.025);
        let labels: BTreeMap<String, String> =
            [("freq".to_string(), freq), ("label".to_string(), format!("Channel {ch}"))].into();
        let noise = -38.0 + ch as f64 * 0.2;
        let channel: [(&'static str, Kind); 12] = [
            ("channel_noise_level", Kind::Gauge { center: 0.012, wander: 0.002, decimals: 3 }),
            ("channel_dbfs_noise_level", Kind::Gauge { center: noise, wander: 1.5, decimals: 3 }),
            ("channel_signal_level", Kind::Gauge { center: 0.016, wander: 0.004, decimals: 3 }),
            ("channel_dbfs_signal_level", Kind::Gauge { center: noise + 2.0, wander: 4.0, decimals: 3 }),
            ("channel_squelch_level", Kind::Gauge { center: 0.04, wander: 0.004, decimals: 3 }),
            ("channel_activity_counter", Kind::Counter { p: 0.15, step: 4_000.0 }),
            ("channel_squelch_counter", Kind::Counter { p: 0.15, step: 2.0 }),
            ("channel_flappy_counter", Kind::Counter { p: 0.02, step: 1.0 }),
            ("channel_ctcss_counter", Kind::Stuck),
            ("channel_no_ctcss_counter", Kind::Stuck),
            ("channel_split_tx_dropped_counter", Kind::Stuck),
            ("channel_freq_offset_hz", Kind::Sticky { center: 40.0, wander: 200.0, p: 0.15, decimals: 1 }),
        ];
        for (metric, kind) in channel {
            out.push(Series::new(metric, labels.clone(), kind));
        }
    }
    let device: [(&'static str, Kind); 8] = [
        ("process_cpu_seconds_total", Kind::Steady { step: 4.0, decimals: 2 }),
        ("device_peak_dbfs", Kind::Gauge { center: -12.0, wander: 3.0, decimals: 1 }),
        ("device_auto_ppm_residual_ppm", Kind::Sticky { center: 0.1, wander: 0.5, p: 0.1, decimals: 2 }),
        ("buffer_underrun_count", Kind::Counter { p: 0.01, step: 1.0 }),
        ("output_overrun_count", Kind::Counter { p: 0.002, step: 10.0 }),
        ("device_ppm_correction", Kind::Sticky { center: 17.0, wander: 0.0, p: 0.0, decimals: 0 }),
        ("buffer_overflow_count", Kind::Stuck),
        ("device_clipped_sample_count", Kind::Stuck),
    ];
    for (metric, kind) in device {
        out.push(Series::new(metric, BTreeMap::new(), kind));
    }
    // The rest: per-output and per-mixer failure counters, nearly all zero.
    let mut output = 0;
    while out.len() < total {
        let labels: BTreeMap<String, String> = [("output".to_string(), output.to_string())].into();
        out.push(Series::new("icecast_disconnect_count", labels, Kind::Stuck));
        output += 1;
    }
    out.truncate(total);
    out
}

struct Load {
    rng: Rng,
    names: Vec<String>,
    series: Vec<Vec<Series>>,
}

impl Load {
    fn new() -> Load {
        let mut series = Vec::new();
        let mut names = Vec::new();
        for i in 0..INSTANCES {
            // 2,338 doesn't divide by 12 evenly; the first instances take the remainder.
            let total = TOTAL_SERIES / INSTANCES + usize::from(i < TOTAL_SERIES % INSTANCES);
            series.push(instance_series(i, total));
            names.push(format!("rtl_{i}"));
        }
        Load { rng: Rng(0x9E37_79B9_7F4A_7C15), names, series }
    }

    /// One instance's samples at the next poll, plus the ms it reads late
    /// (the poller stamps each instance as it gets to it).
    fn poll(&mut self, instance: usize) -> (Vec<StatSample>, i64) {
        let rng = &mut self.rng;
        let mut samples = Vec::with_capacity(self.series[instance].len());
        for s in &mut self.series[instance] {
            s.step(rng);
            samples.push(StatSample { metric: s.metric.to_string(), labels: s.labels.clone(), value: s.value });
        }
        (samples, instance as i64 * 4 + (rng.next() % 3) as i64)
    }

    fn hardware(&mut self, ts: i64) -> Vec<HardwareSample> {
        let rng = &mut self.rng;
        self.names
            .iter()
            .map(|name| HardwareSample {
                instance: name.clone(),
                device: 0,
                ts,
                headroom_db: Some(rounded(12.0 + 3.0 * rng.spread(), 2)),
                noise_floor_dbfs: Some(rounded(-38.0 + rng.spread(), 2)),
                freq_error_ppm: Some(rounded(0.2 * rng.spread(), 2)),
                gain_db: Some(37.2),
            })
            .collect()
    }

    /// One whole poll round through `StatsDb`, as the poller does it.
    fn tick(&mut self, db: &StatsDb, t: i64) {
        for i in 0..INSTANCES {
            let (samples, late) = self.poll(i);
            let name = self.names[i].clone();
            db.insert_batch(&name, &samples, t + late).expect("insert_batch");
        }
        let rows = self.hardware(t);
        db.insert_hardware(&rows).expect("insert_hardware");
    }
}

#[derive(Clone, Copy, Default)]
struct Io {
    rchar: u64,
    wchar: u64,
    read_bytes: u64,
    write_bytes: u64,
}

impl Io {
    fn now() -> Io {
        let text = std::fs::read_to_string("/proc/self/io").expect("/proc/self/io");
        let field = |name: &str| {
            text.lines()
                .find_map(|l| l.strip_prefix(name).and_then(|v| v.strip_prefix(": ")))
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0)
        };
        Io {
            rchar: field("rchar"),
            wchar: field("wchar"),
            read_bytes: field("read_bytes"),
            write_bytes: field("write_bytes"),
        }
    }

    fn since(self, earlier: Io) -> Io {
        Io {
            rchar: self.rchar - earlier.rchar,
            wchar: self.wchar - earlier.wchar,
            read_bytes: self.read_bytes - earlier.read_bytes,
            write_bytes: self.write_bytes - earlier.write_bytes,
        }
    }
}

fn mb(bytes: u64) -> f64 {
    bytes as f64 / 1_000_000.0
}

fn size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn wal_path(db: &Path) -> PathBuf {
    let mut s = db.as_os_str().to_owned();
    s.push("-wal");
    PathBuf::from(s)
}

fn report(label: &str, io: Io, secs: f64, db: &Path) {
    println!(
        "{label:<22} write_bytes {:>10.1} MB  wchar {:>10.1} MB  read_bytes {:>9.1} MB  rchar {:>10.1} MB  db {:>9.1} MB  wal {:>7.1} MB  {secs:>7.1} s",
        mb(io.write_bytes),
        mb(io.wchar),
        mb(io.read_bytes),
        mb(io.rchar),
        mb(size(db)),
        mb(size(&wal_path(db))),
    );
}

/// The polls' simulated time `t`, plus an hourly prune; both as the poller does.
fn run_hours(db: &StatsDb, load: &mut Load, from: i64, hours: i64, path: &Path) {
    let mut totals = Io::default();
    let mut prune_totals = Io::default();
    for hour in 0..hours {
        let hour_start = from + hour * HOUR_MS;
        let (io, clock) = (Io::now(), Instant::now());
        let mut t = hour_start;
        while t < hour_start + HOUR_MS {
            load.tick(db, t);
            t += POLL_MS;
        }
        let polled = Io::now().since(io);
        report(&format!("hour {hour} polling"), polled, clock.elapsed().as_secs_f64(), path);

        let (io, clock) = (Io::now(), Instant::now());
        db.prune_before(t - RETENTION_MS).expect("prune");
        let pruned = Io::now().since(io);
        report(&format!("hour {hour} prune"), pruned, clock.elapsed().as_secs_f64(), path);

        totals.write_bytes += polled.write_bytes;
        totals.wchar += polled.wchar;
        totals.read_bytes += polled.read_bytes;
        totals.rchar += polled.rchar;
        prune_totals.write_bytes += pruned.write_bytes;
        prune_totals.wchar += pruned.wchar;
        prune_totals.read_bytes += pruned.read_bytes;
        prune_totals.rchar += pruned.rchar;
    }
    report(&format!("TOTAL polling {hours}h"), totals, 0.0, path);
    report(&format!("TOTAL prune {hours}h"), prune_totals, 0.0, path);
}

/// Writes --days of history straight into the row-per-sample tables.
fn bulk_seed_rows(path: &Path, load: &mut Load, days: i64) {
    // Create the schema and every series through the real code first.
    {
        let db = StatsDb::open(path).expect("open");
        load.tick(&db, START_MS);
    }
    let conn = rusqlite::Connection::open(path).expect("open raw");
    conn.execute_batch(
        "PRAGMA synchronous=OFF; PRAGMA cache_size=-1000000;
         DROP INDEX idx_samples_series_ts; DROP INDEX idx_samples_ts; DROP INDEX idx_hardware_samples_ts;",
    )
    .expect("prepare bulk seed");
    let mut ids = std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, instance, metric, labels FROM series").unwrap();
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
            })
            .unwrap();
        for row in rows {
            let (id, instance, metric, labels) = row.unwrap();
            ids.insert((instance, metric, labels), id);
        }
    }
    let end = START_MS + days * DAY_MS;
    let mut t = START_MS + POLL_MS;
    let mut stored = 0u64;
    while t < end {
        conn.execute_batch("BEGIN").unwrap();
        {
            let mut insert =
                conn.prepare_cached("INSERT INTO samples (series_id, value, ts) VALUES (?, ?, ?)").unwrap();
            let mut hardware = conn
                .prepare_cached(
                    "INSERT INTO hardware_samples (instance, device, ts, headroom_db, noise_floor_dbfs, freq_error_ppm, gain_db)
                     VALUES (?, ?, ?, ?, ?, ?, ?)",
                )
                .unwrap();
            let hour_end = (t + HOUR_MS).min(end);
            while t < hour_end {
                for i in 0..INSTANCES {
                    let (samples, late) = load.poll(i);
                    for s in &samples {
                        let key = (load.names[i].clone(), s.metric.clone(), canonical_labels(&s.labels));
                        insert.execute(rusqlite::params![ids[&key], s.value, t + late]).unwrap();
                        stored += 1;
                    }
                }
                for r in load.hardware(t) {
                    hardware
                        .execute(rusqlite::params![
                            r.instance,
                            r.device,
                            r.ts,
                            r.headroom_db,
                            r.noise_floor_dbfs,
                            r.freq_error_ppm,
                            r.gain_db
                        ])
                        .unwrap();
                }
                t += POLL_MS;
            }
        }
        conn.execute_batch("COMMIT").unwrap();
    }
    conn.execute_batch(
        "CREATE INDEX idx_samples_series_ts ON samples(series_id, ts);
         CREATE INDEX idx_samples_ts ON samples(ts);
         CREATE INDEX idx_hardware_samples_ts ON hardware_samples(ts);
         PRAGMA wal_checkpoint(TRUNCATE);",
    )
    .expect("rebuild indexes");
    println!("bulk seeded {stored} samples");
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (mut db_path, mut phase, mut hours, mut days, mut bulk) = (None, None, 24i64, 7i64, false);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--db" => db_path = args.next().map(PathBuf::from),
            "--phase" => phase = args.next(),
            "--hours" => hours = args.next().and_then(|v| v.parse().ok()).expect("--hours N"),
            "--days" => days = args.next().and_then(|v| v.parse().ok()).expect("--days N"),
            "--bulk" => bulk = true,
            other => panic!("unknown argument {other}"),
        }
    }
    let path = db_path.expect("--db PATH");
    let phase = phase.expect("--phase day|seed|measure|read");
    let mut load = Load::new();
    println!("{TOTAL_SERIES} series over {INSTANCES} instances, one poll every {} s", POLL_MS / 1000);

    let seeded_end = START_MS + days * DAY_MS;
    match phase.as_str() {
        "day" => {
            let db = StatsDb::open(&path).expect("open");
            run_hours(&db, &mut load, START_MS, hours, &path);
            db.flush().expect("flush");
            drop(db);
            report("closed", Io::default(), 0.0, &path);
        }
        "seed" => {
            let clock = Instant::now();
            if bulk {
                bulk_seed_rows(&path, &mut load, days);
            } else {
                let db = StatsDb::open(&path).expect("open");
                let mut t = START_MS;
                while t < seeded_end {
                    load.tick(&db, t);
                    t += POLL_MS;
                }
                db.flush().expect("flush");
            }
            report("seeded", Io::default(), clock.elapsed().as_secs_f64(), &path);
        }
        "measure" => {
            let db = StatsDb::open(&path).expect("open");
            // Age out exactly what a prune an hour ago would have.
            let (io, clock) = (Io::now(), Instant::now());
            db.prune_before(seeded_end - RETENTION_MS).expect("prune");
            report("catch-up prune", Io::now().since(io), clock.elapsed().as_secs_f64(), &path);
            run_hours(&db, &mut load, seeded_end, hours, &path);
        }
        "read" => {
            let db = StatsDb::open(&path).expect("open");
            let labels: BTreeMap<String, String> =
                [("freq".to_string(), "118.000".to_string()), ("label".to_string(), "Channel 0".to_string())].into();
            for metric in ["channel_dbfs_signal_level", "channel_signal_level", "channel_squelch_level"] {
                let q = HistoryQuery {
                    metric: metric.into(),
                    labels: labels.clone(),
                    since_ms: Some(seeded_end - DAY_MS),
                    until_ms: None,
                };
                let clock = Instant::now();
                let points = db.history("rtl_0", &q).expect("history");
                println!(
                    "history 24 h {metric}: {} points in {:.1} ms",
                    points.len(),
                    clock.elapsed().as_secs_f64() * 1e3
                );
            }
            let clock = Instant::now();
            let latest = db.latest("rtl_0").expect("latest");
            println!("cold latest: {} samples in {:.1} ms", latest.len(), clock.elapsed().as_secs_f64() * 1e3);
        }
        other => panic!("unknown phase {other}"),
    }
}
