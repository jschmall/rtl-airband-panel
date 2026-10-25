#!/usr/bin/env python3
"""Fake rtl_airband control sockets for the docs screenshots.

    fake-control-sockets.py PANEL_URL STATS.db

For every instance the panel at PANEL_URL lists with a control_socket_path,
listens on that path and answers `status` the way the fork does, so the
Hardware page shows live readings without any SDR attached:
- headroom, gain and frequency error replay that instance's recorded
  hardware_samples from STATS.db, one per request, looping;
- each channel's noise and signal level is its latest recorded value;
- every channel reports a carrier offset matching the recorded frequency
  error, as if each had heard a transmission.
`reload_diff` (Apply live) re-reads the instance's saved config and reports
any device gain that changed as applied, which the replay then uses.
Runs until interrupted, removing its sockets on exit.
"""

import json
import os
import random
import signal
import socket
import sqlite3
import sys
import threading
import urllib.request


def get(url: str):
    with urllib.request.urlopen(url) as res:
        return json.load(res)


def channel_levels(db: sqlite3.Connection, instance: str) -> dict:
    """Latest noise and signal dBFS per frequency label (e.g. "151.160")."""
    out: dict = {}
    for metric, key in (("channel_dbfs_noise_level", "noise"), ("channel_dbfs_signal_level", "signal")):
        rows = db.execute(
            """SELECT s.labels, (SELECT value FROM samples WHERE series_id = s.id ORDER BY ts DESC LIMIT 1)
               FROM series s WHERE s.instance = ? AND s.metric = ?""",
            (instance, metric),
        )
        for labels, value in rows:
            freq = json.loads(labels).get("freq")
            if freq is not None and value is not None:
                out.setdefault(freq, {})[key] = value
    return out


def channels_of(device: dict) -> list:
    """(freq Hz, label, modulation) lists per enabled channel, in the order rtl_airband numbers them."""
    out = []
    for ch in device.get("channels", []):
        if ch.get("disable"):
            continue
        if "freqs" in ch:
            labels = ch.get("labels") or []
            out.append([(f, labels[i] if i < len(labels) else None, ch.get("modulation") or "am") for i, f in enumerate(ch["freqs"])])
        else:
            out.append([(ch["freq"], ch.get("label"), ch.get("modulation") or "am")])
    return out


class Replay:
    def __init__(self, db: sqlite3.Connection, instance: str, config: dict):
        self.devices = [d for d in config["devices"] if not d.get("disable")]
        self.levels = channel_levels(db, instance)
        self.rows = {}
        for i in range(len(self.devices)):
            self.rows[i] = db.execute(
                "SELECT headroom_db, freq_error_ppm, gain_db FROM hardware_samples WHERE instance = ? AND device = ? ORDER BY ts",
                (instance, i),
            ).fetchall() or [(15.0, None, None)]
        self.step = 0
        self.clipped = [0] * len(self.devices)
        self.gain_override: dict = {}

    def reload_diff(self, config: dict) -> dict:
        devices = [d for d in config["devices"] if not d.get("disable")]
        applied = []
        for i, dev in enumerate(devices):
            gain = dev.get("gain")
            current = self.gain_override.get(i, self.rows[i][self.step % len(self.rows[i])][2])
            if isinstance(gain, (int, float)) and gain != current:
                applied.append(f"device[{i}]: gain -> {gain:g}")
                self.gain_override[i] = gain
        self.devices = devices
        return {"ok": True, "applied": applied, "skipped_requires_restart": []}

    def status(self) -> dict:
        self.step += 1
        devices = []
        for i, dev in enumerate(self.devices):
            headroom, ppm, gain = self.rows[i][self.step % len(self.rows[i])]
            gain = self.gain_override.get(i, gain)
            if headroom is not None and headroom < 0.5:
                self.clipped[i] += random.randint(50, 400)
            channels = []
            for ci, freqs in enumerate(channels_of(dev)):
                entries = []
                open_ = False
                for freq, label, modulation in freqs:
                    lv = self.levels.get(f"{freq / 1e6:.3f}", {})
                    noise = lv.get("noise", -40 + random.uniform(-3, 3))
                    signal = lv.get("signal", noise + random.uniform(0, 2))
                    heard = ppm is not None
                    open_ = open_ or signal - noise > 10
                    entries.append({
                        "freq": int(freq), "label": label, "modulation": modulation,
                        "noise_dbfs": round(noise + random.uniform(-0.3, 0.3), 2),
                        "signal_dbfs": round(signal + random.uniform(-0.3, 0.3), 2),
                        "freq_offset_hz": round(ppm * freq / 1e6 + random.uniform(-15, 15), 1) if heard else None,
                        "freq_offset_updates": 12 if heard else 0,
                    })
                channels.append({"index": ci, "enabled": True, "freq_idx": 0, "squelch_open": open_, "freqs": entries})
            devices.append({
                "index": i, "driver": dev.get("type", "rtlsdr"), "state": "running",
                "mode": dev.get("mode") or "multichannel",
                "centerfreq": int(dev.get("centerfreq") or 0), "sample_rate": int(dev.get("sample_rate") or 2_560_000),
                "gain": gain, "correction": dev.get("correction", 0), "bandwidth": int(dev.get("bandwidth") or 0),
                "peak_dbfs": None if headroom is None else -headroom,
                "clipped_samples": self.clipped[i], "buffer_overflows": 0, "buffer_underruns": 0,
                "retune_failures": 0, "output_overruns": 0, "channels": channels,
            })
        return {"ok": True, "version": "v6.5.0", "devices": devices}


def serve(path: str, replay: Replay, lock: threading.Lock, config_url: str) -> None:
    if os.path.exists(path):
        os.remove(path)
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(path)
    listener.listen()
    while True:
        conn, _ = listener.accept()
        with conn:
            try:
                cmd = json.loads(conn.makefile().readline() or "{}").get("cmd")
            except ValueError:
                cmd = None
            with lock:
                reply = replay.reload_diff(get(config_url)) if cmd == "reload_diff" else replay.status()
            conn.sendall((json.dumps(reply) + "\n").encode())


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    panel, db_path = sys.argv[1].rstrip("/"), sys.argv[2]
    db = sqlite3.connect(db_path, check_same_thread=False)
    lock = threading.Lock()
    paths = []
    for inst in get(f"{panel}/api/instances"):
        config = get(f"{panel}/api/instances/{inst['name']}")
        path = config.get("control_socket_path")
        if not path:
            continue
        replay = Replay(db, inst["name"], config)
        url = f"{panel}/api/instances/{inst['name']}"
        threading.Thread(target=serve, args=(path, replay, lock, url), daemon=True).start()
        paths.append(path)
    print(f"serving {len(paths)} control sockets", flush=True)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    try:
        stop.wait()
    except KeyboardInterrupt:
        pass
    finally:
        for p in paths:
            if os.path.exists(p):
                os.remove(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
