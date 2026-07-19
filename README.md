# rtl-airband-panel

A web control panel for [RTLSDR-Airband](https://github.com/rtl-airband/RTLSDR-Airband) instances. Each SDR runs as its own systemd-managed `rtl_airband` process with its own `.conf` file (one service per instance). This panel reads and writes those config files through a JSON intermediate model, validates changes before saving, and restarts only the systemd unit it touched — RTLSDR-Airband itself has no live-reload, so a config change always means a targeted restart.

## How it's built

The repo is an npm workspace monorepo with four packages, each one layer of the pipeline described in [CLAUDE.md](./CLAUDE.md):

| Package | What it does |
|---|---|
| [`backend/parser`](./backend/parser) | Hand-rolled libconfig tokenizer/parser/serializer. Converts a `.conf` file to a JSON domain model (`devices` → `channels` → `outputs`) and back, round-trip tested against a real sanitized fixture. |
| [`backend/validate`](./backend/validate) | Semantic checks on the JSON model, grounded in RTLSDR-Airband's own source: frequency-in-window (warning), FFT bin collisions between distinct frequencies (error), and CTCSS tone validity (warnings for non-positive values or near-miss typos of the 51 standard tones). |
| [`backend/api`](./backend/api) | Fastify HTTP API: instance CRUD, systemd restart, health checks, and stats history. Also serves the built frontend directly when present, so the whole app can run as one process. Fails closed — a config write that fails validation never touches disk or systemd. |
| [`frontend`](./frontend) | React + Vite + Tailwind UI: instance list with live health, a form editor for devices/channels/outputs, and a stats/charts page per instance. |

```
.conf file  <──parse/serialize──>  JSON model  <──validate──>  {errors, warnings}
                                        │
                    backend/api (CRUD, systemd, health, stats, serves frontend build)
                                        │
                                   frontend (React UI)
```

## Prerequisites

- Node.js 18+ and npm
- To control real systemd units, `sudo` access to `systemctl` on the host (see [Systemd control](#systemd-control) below)

## Setup

```bash
git clone git@github.com:jschmall/rtl-airband-panel.git
cd rtl-airband-panel
npm install
```

`backend/api` and `frontend` both import `backend/parser` and `backend/validate` as *compiled* workspace packages (their `dist/` is gitignored, not committed), so build those first — and **re-run this after every `git pull`**, or `backend/api`/`frontend` will keep running whatever was last compiled, silently ignoring newer source changes:

```bash
npm run build:deps
```

## Running it

If you've pulled new changes since you last built, run `npm run build:deps` first (see above) — this is the most common source of "I fixed it but it's still broken" confusion in this repo.

By default the backend runs in **mock systemd mode**: it logs what it would do instead of calling real `systemctl`, and points at `/etc/rtl-airband-panel/instances` for `.conf` files. That means you can run the whole stack safely without touching any real instance.

### Single process (recommended)

`backend/api` serves the frontend's built assets itself when a build is present, so the whole app runs as one process on one port — no proxy, no second server to keep in sync:

```bash
npm run build
npm start --workspace=backend/api
```

Open `http://localhost:3000`. If no frontend build is found, `backend/api` logs a warning and falls back to API-only — nothing breaks, you just won't get the UI at that port. Where it looks for the build is configurable (`RTL_PANEL_FRONTEND_DIST`, default `frontend/dist` relative to the repo root).

By default the server only listens on `127.0.0.1` (localhost-only). To reach it from other machines on your LAN, bind it to all interfaces:

```bash
RTL_PANEL_HOST=0.0.0.0 npm start --workspace=backend/api
```

Then open `http://<this-machine's-LAN-IP>:3000` from another device. **Note:** there's no authentication on this API — binding to `0.0.0.0` means anyone on your network can read/write instance configs and trigger restarts (and, in `sudo` systemd mode, real `systemctl` actions). `127.0.0.1` stays the default specifically so that's an opt-in choice, not automatic.

### Two processes (frontend dev / hot reload)

For iterating on the frontend itself, run it separately via Vite so edits show up instantly:

```bash
# terminal 1
npm run build --workspace=backend/api
npm start --workspace=backend/api

# terminal 2
npm run dev --workspace=frontend
```

Open `http://localhost:5173` — the Vite dev server proxies `/api/*` to the backend at `http://127.0.0.1:3000` (configurable via `VITE_API_PROXY_TARGET`).

## Configuration

`backend/api` reads its configuration from environment variables (see [`backend/api/src/config.ts`](./backend/api/src/config.ts)):

| Variable | Default | Purpose |
|---|---|---|
| `RTL_PANEL_INSTANCES_DIR` | `/etc/rtl-airband-panel/instances` | Directory containing per-instance `.conf` files |
| `RTL_PANEL_UNIT_DIR` | `/etc/systemd/system` | Where systemd unit files are installed |
| `RTL_PANEL_RTL_AIRBAND_BIN` | `/usr/local/bin/rtl_airband` | Binary path used in generated unit files |
| `RTL_PANEL_SYSTEMD_MODE` | `mock` | `mock` (safe, no real systemctl calls) or `sudo` (real) |
| `RTL_PANEL_PORT` | `3000` | API listen port |
| `RTL_PANEL_HOST` | `127.0.0.1` | API listen host |
| `RTL_PANEL_FRONTEND_DIST` | `frontend/dist` (repo-relative) | Where to look for the frontend's build to serve as a single process; absent build = API-only, not an error |
| `RTL_PANEL_STATS_DB_PATH` | `~/.rtl-airband-panel/stats.db` | SQLite file the stats poller writes historical samples to |
| `RTL_PANEL_STATS_POLL_INTERVAL_MS` | `15000` | How often each instance's stats file is re-read |
| `RTL_PANEL_STATS_RETENTION_DAYS` | `7` | Samples older than this are pruned each poll cycle; `0` or negative disables pruning |

### Systemd control

Instance names map to config files and systemd units by a fixed convention: `rtl_<name>.conf` ↔ `rtl_<name>.service`, matching basenames, no `@` templating. Setting `RTL_PANEL_SYSTEMD_MODE=sudo` makes the backend shell out to real `sudo systemctl` commands — only do this once you're ready to affect real running instances, and consider testing against a non-critical instance first.

### Stats & graphing

RTLSDR-Airband writes each instance's `stats_filepath` in real Prometheus text-exposition format (`# HELP`/`# TYPE` comments, `metric{labels}` lines) — per-channel signal/noise/squelch levels and counters, plus device/mixer overrun counters — but it **rewrites the file in full on every write** (roughly every 15s), so it holds only the latest snapshot, no history.

`backend/api` polls each running instance's stats file on that same cadence and records every sample into a local SQLite database (`RTL_PANEL_STATS_DB_PATH`), skipping a read if the file's mtime hasn't changed (a stopped instance doesn't get repeated identical rows). Each instance's "Stats" page (linked from the instance list and the edit page) charts signal-vs-noise and squelch-open-count per channel over a selectable time window, plus device/mixer counters as tiles. Retention is capped by `RTL_PANEL_STATS_RETENTION_DAYS` (default 7 days; pruned on every poll cycle).

## Testing

Each package has its own test suite (Vitest):

```bash
npm test --workspace=backend/parser
npm test --workspace=backend/validate
npm test --workspace=backend/api
```

`backend/parser` and `backend/validate` tests run against [`fixtures/151719.conf`](./fixtures/151719.conf), a sanitized real-world config. `backend/api` tests run entirely against a mock systemd adapter and temp scratch directories — nothing in the test suite touches real systemd or the configured instances directory.

## Current scope

The JSON model covers `multichannel`-mode devices with all six RTLSDR-Airband output types (`pulse`, `file`, `rawfile`, `icecast`, `udp_stream`, `mixer`). RTLSDR-Airband also supports `scan`-mode devices (a `freqs` list with hardware retuning), top-level mixer *definitions* (a channel can route into a mixer by name, but the `mixers: (...)` list itself isn't modeled yet), and several per-channel options (`highpass`/`lowpass`/`tau`/`labels`) that aren't modeled yet.
