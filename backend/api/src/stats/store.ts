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
 */
export class StatsStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance TEXT NOT NULL,
        metric TEXT NOT NULL,
        labels TEXT NOT NULL,
        value REAL NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_samples_lookup ON samples(instance, metric, labels, ts);
      CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);
    `);
  }

  insertBatch(instance: string, samples: StatSample[], ts: number): void {
    if (samples.length === 0) return;
    const insert = this.db.prepare("INSERT INTO samples (instance, metric, labels, value, ts) VALUES (?, ?, ?, ?, ?)");
    const insertMany = this.db.transaction((rows: StatSample[]) => {
      for (const sample of rows) {
        insert.run(instance, sample.metric, canonicalizeLabels(sample.labels), sample.value, ts);
      }
    });
    insertMany(samples);
  }

  /** All series' values from the most recent poll for this instance. Empty if nothing has been polled yet. */
  latest(instance: string): LatestSample[] {
    const maxTsRow = this.db.prepare("SELECT MAX(ts) as ts FROM samples WHERE instance = ?").get(instance) as {
      ts: number | null;
    };
    if (maxTsRow.ts === null) return [];

    const rows = this.db
      .prepare("SELECT metric, labels, value FROM samples WHERE instance = ? AND ts = ?")
      .all(instance, maxTsRow.ts) as { metric: string; labels: string; value: number }[];

    return rows.map((row) => ({
      metric: row.metric,
      labels: JSON.parse(row.labels) as Record<string, string>,
      value: row.value,
    }));
  }

  history(instance: string, query: HistoryQuery): HistoryPoint[] {
    const clauses = ["instance = ?", "metric = ?", "labels = ?"];
    const params: (string | number)[] = [instance, query.metric, canonicalizeLabels(query.labels ?? {})];
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
  }

  close(): void {
    this.db.close();
  }
}
