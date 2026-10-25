#!/usr/bin/env python3
"""Copies the recent part of a panel stats database for the docs screenshots.

    prepare-db.py SOURCE.db OUT.db [--hours 25]

Copies the series, the last --hours of samples and all hardware samples,
then shifts every timestamp so the newest reading is now: the Stats and
Hardware pages only show recent history. SOURCE is opened read-only.

Samples are read series by series through the (series_id, ts) index, and a
series stops at the first unreadable page instead of failing the copy. A
stats.db copied while the panel was writing it can have a few damaged
pages near the end, which this skips.
"""

import argparse
import os
import sqlite3
import sys
import time


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source")
    parser.add_argument("out")
    parser.add_argument("--hours", type=float, default=25)
    args = parser.parse_args()

    if os.path.exists(args.out):
        os.remove(args.out)
    src = sqlite3.connect(f"file:{args.source}?mode=ro&immutable=1", uri=True)
    dst = sqlite3.connect(args.out)
    for (sql,) in src.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"):
        dst.execute(sql)

    series = src.execute("SELECT id, instance, metric, labels FROM series").fetchall()
    dst.executemany("INSERT INTO series (id, instance, metric, labels) VALUES (?, ?, ?, ?)", series)

    since = int(time.time() * 1000) - int(args.hours * 3_600_000)
    copied = cut_short = 0
    for (series_id, *_rest) in series:
        rows = []
        try:
            for row in src.execute(
                "SELECT series_id, value, ts FROM samples INDEXED BY idx_samples_series_ts WHERE series_id = ? AND ts >= ?",
                (series_id, since),
            ):
                rows.append(row)
        except sqlite3.DatabaseError:
            cut_short += 1
        dst.executemany("INSERT INTO samples VALUES (?, ?, ?)", rows)
        copied += len(rows)

    hardware = src.execute("SELECT * FROM hardware_samples").fetchall()
    if hardware:
        dst.executemany(f"INSERT INTO hardware_samples VALUES ({', '.join('?' * len(hardware[0]))})", hardware)

    newest = max(
        dst.execute("SELECT COALESCE(MAX(ts), 0) FROM samples").fetchone()[0],
        dst.execute("SELECT COALESCE(MAX(ts), 0) FROM hardware_samples").fetchone()[0],
    )
    if newest:
        shift = int(time.time() * 1000) - newest
        dst.execute("UPDATE samples SET ts = ts + ?", (shift,))
        dst.execute("UPDATE hardware_samples SET ts = ts + ?", (shift,))
    dst.commit()

    note = f", {cut_short} series cut short by damaged pages" if cut_short else ""
    print(f"{copied} samples from {len(series)} series, {len(hardware)} hardware samples{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
