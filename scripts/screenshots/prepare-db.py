#!/usr/bin/env python3
"""Copies the recent part of a panel stats database for the docs screenshots.

    prepare-db.py SOURCE.db OUT.db [--hours 25]

Copies the series, the last --hours of samples and all hardware samples,
then shifts time so the newest reading is within 5 minutes of now: the Stats
and Hardware pages only show recent history. SOURCE is opened read-only.

Samples are packed per 5-minute bucket with timestamps relative to the bucket,
so shifting by whole buckets leaves the packed data as it is. An unreadable
bucket is skipped instead of failing the copy: a stats.db copied while the
panel was writing it can have a few damaged pages near the end.
"""

import argparse
import os
import sqlite3
import sys
import time

BUCKET_MS = 300_000
SCHEMA_VERSION = 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source")
    parser.add_argument("out")
    parser.add_argument("--hours", type=float, default=25)
    args = parser.parse_args()

    src = sqlite3.connect(f"file:{args.source}?mode=ro&immutable=1", uri=True)
    version = src.execute("PRAGMA user_version").fetchone()[0]
    if version != SCHEMA_VERSION:
        print(
            f"{args.source} has schema version {version}, not {SCHEMA_VERSION}. "
            "Copy a stats.db from a panel running v0.6.51 or newer.",
            file=sys.stderr,
        )
        return 1

    if os.path.exists(args.out):
        os.remove(args.out)
    dst = sqlite3.connect(args.out)
    for (sql,) in src.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"):
        dst.execute(sql)
    dst.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    newest = max(
        src.execute("SELECT COALESCE(MAX(ts), 0) FROM instance_last_poll").fetchone()[0],
        src.execute("SELECT COALESCE(MAX(ts), 0) FROM hardware_samples").fetchone()[0],
    )
    shift_buckets = (int(time.time() * 1000) - newest) // BUCKET_MS if newest else 0
    shift_ms = shift_buckets * BUCKET_MS

    series = src.execute("SELECT id, instance, metric, labels, last_seen FROM series").fetchall()
    dst.executemany(
        "INSERT INTO series (id, instance, metric, labels, last_seen) VALUES (?, ?, ?, ?, ?)",
        [(i, inst, metric, labels, seen + shift_ms) for (i, inst, metric, labels, seen) in series],
    )
    dst.executemany(
        "INSERT INTO instance_last_poll (instance, ts) VALUES (?, ?)",
        [(inst, ts + shift_ms) for (inst, ts) in src.execute("SELECT instance, ts FROM instance_last_poll")],
    )

    last_bucket = newest // BUCKET_MS
    first_bucket = (newest - int(args.hours * 3_600_000)) // BUCKET_MS
    copied = skipped = 0
    for bucket in range(first_bucket, last_bucket + 1):
        try:
            rows = src.execute("SELECT series_id, data FROM sample_chunks WHERE bucket = ?", (bucket,)).fetchall()
        except sqlite3.DatabaseError:
            skipped += 1
            continue
        dst.executemany(
            "INSERT INTO sample_chunks (bucket, series_id, data) VALUES (?, ?, ?)",
            [(bucket + shift_buckets, series_id, data) for (series_id, data) in rows],
        )
        copied += len(rows)

    hardware = src.execute("SELECT * FROM hardware_samples").fetchall()
    if hardware:
        dst.executemany(f"INSERT INTO hardware_samples VALUES ({', '.join('?' * len(hardware[0]))})", hardware)
        dst.execute("UPDATE hardware_samples SET ts = ts + ?", (shift_ms,))
    dst.commit()

    note = f", {skipped} buckets skipped for damaged pages" if skipped else ""
    print(f"{copied} sample chunks from {len(series)} series, {len(hardware)} hardware samples{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
