import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";
import type { StatSample } from "./prometheus-parser.js";

export interface LatestSample {
  metric: string;
  labels: Record<string, string>;
  value: number;
}

export interface HistoryPoint {
  ts: number;
  value: number;
}

export interface HistoryQuery {
  metric: string;
  /** Exact label-set match (as discovered from a `latest()` call). Omit to match samples with no labels. */
  labels?: Record<string, string>;
  sinceMs?: number;
  untilMs?: number;
}

/** Stable JSON form (sorted keys) so equal label sets always compare equal regardless of insertion order. */
function canonicalizeLabels(labels: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(labels).sort()) sorted[key] = labels[key]!;
  return JSON.stringify(sorted);
}

/**
 * Historical time-series storage for instance stats. RTLSDR-Airband's stats
 * file is a snapshot rewritten every ~15s (see prometheus-parser.ts) — this
 * is what turns repeated snapshots into a queryable history.
 *
 * Schema is normalized: `series` interns each distinct (instance, metric,
 * labels) tuple once, and `samples` stores only (series_id, value, ts).
 * Series identity is fixed by a device/channel's config, so its cardinality
 * tracks config size; samples grow with poll count. Before this split, every
 * sample row repeated the full instance/metric/labels text (and repeated it
 * again in the covering index), which dominated on-disk growth.
 */
export class StatsStore {
  private readonly db: Database.Database;
  private readonly findSeriesStmt: Database.Statement;
  private readonly insertSeriesStmt: Database.Statement;
  private readonly insertSampleStmt: Database.Statement;
  /** In-memory cache of (instance, metric, labels) -> series_id, so hot polling doesn't round-trip to SQLite per sample. */
  private readonly seriesIds = new Map<string, number>();

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("auto_vacuum = INCREMENTAL");

    this.migrateLegacySchema();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS series (
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
      CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);
    `);

    this.findSeriesStmt = this.db.prepare("SELECT id FROM series WHERE instance = ? AND metric = ? AND labels = ?");
    this.insertSeriesStmt = this.db.prepare("INSERT INTO series (instance, metric, labels) VALUES (?, ?, ?)");
    this.insertSampleStmt = this.db.prepare("INSERT INTO samples (series_id, value, ts) VALUES (?, ?, ?)");
  }

  /**
   * Pre-0.3.1 databases stored samples as a single flat table with the
   * instance/metric/labels text repeated on every row. That data is just
   * regenerable poll history, not config, so on detecting the old shape we
   * drop it and VACUUM once rather than migrating rows — this is also what
   * reclaims the freed space immediately instead of leaving it as unused
   * pages in the file.
   */
  private migrateLegacySchema(): void {
    const columns = this.db.prepare("PRAGMA table_info(samples)").all() as { name: string }[];
    if (columns.length === 0) return; // fresh db
    if (columns.some((c) => c.name === "series_id")) return; // already normalized

    this.db.exec("DROP TABLE samples;");
    this.db.exec("VACUUM;"); // also applies the auto_vacuum pragma set above, which only takes effect via VACUUM on a non-empty db
  }

  private getSeriesId(instance: string, metric: string, labels: string): number {
    const key = `${instance} ${metric} ${labels}`;
    const cached = this.seriesIds.get(key);
    if (cached !== undefined) return cached;

    const existing = this.findSeriesStmt.get(instance, metric, labels) as { id: number } | undefined;
    const id = existing ? existing.id : Number(this.insertSeriesStmt.run(instance, metric, labels).lastInsertRowid);
    this.seriesIds.set(key, id);
    return id;
  }

  insertBatch(instance: string, samples: StatSample[], ts: number): void {
    if (samples.length === 0) return;
    const insertMany = this.db.transaction((rows: StatSample[]) => {
      for (const sample of rows) {
        const seriesId = this.getSeriesId(instance, sample.metric, canonicalizeLabels(sample.labels));
        this.insertSampleStmt.run(seriesId, sample.value, ts);
      }
    });
    insertMany(samples);
  }

  /** All series' values from the most recent poll for this instance. Empty if nothing has been polled yet. */
  latest(instance: string): LatestSample[] {
    const maxTsRow = this.db
      .prepare("SELECT MAX(sa.ts) as ts FROM samples sa JOIN series se ON se.id = sa.series_id WHERE se.instance = ?")
      .get(instance) as { ts: number | null };
    if (maxTsRow.ts === null) return [];

    const rows = this.db
      .prepare(
        `SELECT se.metric, se.labels, sa.value FROM samples sa
         JOIN series se ON se.id = sa.series_id
         WHERE se.instance = ? AND sa.ts = ?`
      )
      .all(instance, maxTsRow.ts) as { metric: string; labels: string; value: number }[];

    return rows.map((row) => ({
      metric: row.metric,
      labels: JSON.parse(row.labels) as Record<string, string>,
      value: row.value,
    }));
  }

  history(instance: string, query: HistoryQuery): HistoryPoint[] {
    const labels = canonicalizeLabels(query.labels ?? {});
    const series = this.findSeriesStmt.get(instance, query.metric, labels) as { id: number } | undefined;
    if (!series) return [];

    const clauses = ["series_id = ?"];
    const params: (string | number)[] = [series.id];
    if (query.sinceMs !== undefined) {
      clauses.push("ts >= ?");
      params.push(query.sinceMs);
    }
    if (query.untilMs !== undefined) {
      clauses.push("ts <= ?");
      params.push(query.untilMs);
    }
    return this.db
      .prepare(`SELECT ts, value FROM samples WHERE ${clauses.join(" AND ")} ORDER BY ts ASC`)
      .all(...params) as HistoryPoint[];
  }

  /** Deletes samples older than retentionDays. A retentionDays <= 0 disables pruning (keep forever). */
  prune(retentionDays: number): void {
    if (retentionDays <= 0) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM samples WHERE ts < ?").run(cutoff);

    // Drop series whose config (channel/device) no longer produces samples, e.g. a renamed channel.
    const orphaned = this.db
      .prepare("DELETE FROM series WHERE id NOT IN (SELECT DISTINCT series_id FROM samples)")
      .run();
    if (orphaned.changes > 0) this.seriesIds.clear(); // cache may hold ids that no longer exist

    this.db.pragma("incremental_vacuum");
  }

  close(): void {
    this.db.close();
  }
}
