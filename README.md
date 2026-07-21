# rtl-airband-panel

A web control panel for [RTLSDR-Airband](https://github.com/rtl-airband/RTLSDR-Airband) instances. Each SDR runs as its own systemd-managed `rtl_airband` process with its own `.conf` file (one service per instance). This panel reads and writes those config files through a JSON intermediate model, validates changes before saving, and restarts only the systemd unit it touched — RTLSDR-Airband itself has no live-reload, so a config change always means a targeted restart.

## Prerequisites

- Node.js 20 or newer, and npm. Check what you have installed:

  ```bash
  node --version
  npm --version
  ```

  This is a hard requirement, not a suggestion — the app will fail to start on Node 18. If you're updating an existing install, upgrade Node on that machine *before* pulling this version.

- To control real systemd units (start/stop/restart actual `rtl_airband` services), the user running the panel needs `sudo` access to `systemctl`. This is optional — see [Systemd control](#systemd-control) below. Without it, the panel still runs fully in a safe simulated mode.

## Install

1. Clone the repository and move into it:

   ```bash
   git clone https://github.com/jschmall/rtl-airband-panel.git
   cd rtl-airband-panel
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the internal packages. This step is required before the first run, and after every `git pull` — skipping it is the most common cause of "I fixed it but it's still broken":

   ```bash
   npm run build:deps
   ```

## Run

1. Build the backend and frontend:

   ```bash
   npm run build
   ```

2. Start the server:

   ```bash
   npm start --workspace=backend/api
   ```

3. Open `http://localhost:3000` in a browser.

By default:

- The server only listens on `127.0.0.1`, so it's reachable from this machine only.
- Systemd actions are simulated, not real — the panel logs what it would do instead of calling `systemctl`. Nothing on the real system is touched.
- It looks for instance `.conf` files in `/etc/rtl-airband-panel/instances`.

All of this is configurable — see [Configuration](#configuration) below.

### Updating to a new version

After every `git pull`, rebuild before starting the server again:

```bash
git pull
npm install
npm run build:deps
npm run build
npm start --workspace=backend/api
```

If you're updating from a version older than the Node 20 requirement was added, upgrade Node on this machine first — `npm install` will fail (or the server will fail to start) on Node 18.

### Making the panel reachable on your network

By default the server only listens on `127.0.0.1` (this machine only). To reach it from other devices on your LAN, bind it to all interfaces:

```bash
npm start --workspace=backend/api -- --host 0.0.0.0
```

Then open `http://<this-machine's-LAN-IP>:3000` from another device.

There is no authentication on this API. Binding to `0.0.0.0` means anyone on your network can read and write instance configs and trigger restarts (and, in `sudo` systemd mode, real `systemctl` actions). `127.0.0.1` is the default specifically so that reaching a wider network is a choice you make on purpose.

### Running the panel as a systemd service

Running the panel process directly in a terminal (or backgrounded with `&`/`nohup`) means it doesn't survive a reboot or restart itself if it crashes. An example unit file is provided at [`deploy/rtl-airband-panel.service`](./deploy/rtl-airband-panel.service) — this manages the *panel's own* process, separate from the per-instance `rtl_<name>.service` units the panel itself creates and controls for each RTLSDR-Airband instance.

1. Clone and build the app in its final location, e.g. `/opt/rtl-airband-panel`:

   ```bash
   sudo git clone https://github.com/jschmall/rtl-airband-panel.git /opt/rtl-airband-panel
   cd /opt/rtl-airband-panel
   sudo npm install
   sudo npm run build:deps
   sudo npm run build
   ```

2. Create a dedicated system user to run the panel as (avoid running it as `root`):

   ```bash
   sudo useradd --system --create-home --home-dir /opt/rtl-airband-panel --shell /usr/sbin/nologin rtl-airband-panel
   sudo chown -R rtl-airband-panel:rtl-airband-panel /opt/rtl-airband-panel
   ```

3. Copy your `.env` (see [Configuration](#configuration)) to `/opt/rtl-airband-panel/.env` if you're using one, owned by the same user.

4. Install the unit file, adjusting `WorkingDirectory`, `User`, and `EnvironmentFile` inside it first if your install path or user differs from the example:

   ```bash
   sudo cp deploy/rtl-airband-panel.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now rtl-airband-panel
   ```

5. Check it's running and follow its logs:

   ```bash
   sudo systemctl status rtl-airband-panel
   sudo journalctl -u rtl-airband-panel -f
   ```

If you're running with `RTL_PANEL_SYSTEMD_MODE=sudo` (see [Systemd control](#systemd-control)) so the panel can restart real `rtl_airband` instances, the `rtl-airband-panel` system user needs passwordless `sudo` access to `systemctl` for those instance units specifically — don't grant it blanket `sudo` access. For example, in a file under `/etc/sudoers.d/`:

```
rtl-airband-panel ALL=(root) NOPASSWD: /usr/bin/systemctl restart rtl_*.service, /usr/bin/systemctl status rtl_*.service
```

Adjust the command list to match whatever systemctl subcommands your version of the panel actually issues.

After a `git pull` on a systemd-managed install, rebuild and restart instead of manually starting the server:

```bash
cd /opt/rtl-airband-panel
sudo -u rtl-airband-panel git pull
sudo -u rtl-airband-panel npm install
sudo -u rtl-airband-panel npm run build:deps
sudo -u rtl-airband-panel npm run build
sudo systemctl restart rtl-airband-panel
```

### Running the frontend separately (for frontend development)

This is only needed if you're actively editing the frontend and want changes to show up instantly, without rebuilding. Most users should use the single `npm start` step above instead.

```bash
# terminal 1: the API
npm run build --workspace=backend/api
npm start --workspace=backend/api

# terminal 2: the frontend, with hot reload
npm run dev --workspace=frontend
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` requests to the backend at `http://127.0.0.1:3000`.

## Configuration

The server can be configured three ways, and they can be mixed:

- Command-line flags, e.g. `npm start --workspace=backend/api -- --port 8080`
- Environment variables, e.g. `RTL_PANEL_PORT=8080 npm start --workspace=backend/api`
- A `.env` file in the directory you invoke `npm`/`node` from (or a custom path via `--env-file <path>`)

If the same setting is given more than one way, the order of precedence, highest first, is: command-line flag, then environment variable, then `.env` file, then the default below. A missing `.env` file is not an error — it's simply skipped.

See [`.env.example`](.env.example) in the repo root for a template covering every setting — copy it to `.env` in the directory you run `npm start --workspace=backend/api` from, and adjust as needed (only the settings you want to override need to be present).

Run `node backend/api/dist/index.js --help` after building to see the full flag list.

| Environment variable | Flag | Default | Purpose |
|---|---|---|---|
| `RTL_PANEL_INSTANCES_DIR` | `--instances-dir` | `/etc/rtl-airband-panel/instances` | Directory containing per-instance `.conf` files |
| `RTL_PANEL_UNIT_DIR` | `--unit-dir` | `/etc/systemd/system` | Where systemd unit files are installed |
| `RTL_PANEL_RTL_AIRBAND_BIN` | `--rtl-airband-bin` | `/usr/local/bin/rtl_airband` | Binary path used in generated unit files |
| `RTL_PANEL_SYSTEMD_MODE` | `--systemd-mode` | `mock` | `mock` (safe, no real systemctl calls) or `sudo` (real) |
| `RTL_PANEL_PORT` | `--port` | `3000` | API listen port |
| `RTL_PANEL_HOST` | `--host` | `127.0.0.1` | API listen host |
| `RTL_PANEL_FRONTEND_DIST` | `--frontend-dist` | `frontend/dist` (repo-relative) | Where to look for the frontend's build to serve as a single process; a missing build is not an error, it just falls back to API-only |
| `RTL_PANEL_STATS_DB_PATH` | `--stats-db-path` | `~/.rtl-airband-panel/stats.db` | SQLite file the stats poller writes historical samples to |
| `RTL_PANEL_STATS_POLL_INTERVAL_MS` | `--stats-poll-interval-ms` | `15000` | How often each instance's stats file is re-read |
| `RTL_PANEL_STATS_RETENTION_DAYS` | `--stats-retention-days` | `7` | Samples older than this are pruned each poll cycle; `0` or negative disables pruning |

### Systemd control

Instance names map to config files and systemd units by a fixed convention: `rtl_<name>.conf` ↔ `rtl_<name>.service`, matching basenames, no `@` templating. Setting `RTL_PANEL_SYSTEMD_MODE=sudo` (or `--systemd-mode sudo`) makes the backend shell out to real `sudo systemctl` commands. Only turn this on once you're ready to affect real running instances, and consider testing against a non-critical instance first.

### Stats & graphing

RTLSDR-Airband writes each instance's `stats_filepath` in real Prometheus text-exposition format (`# HELP`/`# TYPE` comments, `metric{labels}` lines) — per-channel signal/noise/squelch levels and counters, plus device/mixer overrun counters — but it rewrites the file in full on every write (roughly every 15 seconds), so it holds only the latest snapshot, no history.

`backend/api` polls each running instance's stats file on that same cadence and records every sample into a local SQLite database (`RTL_PANEL_STATS_DB_PATH`), skipping a read if the file's modification time hasn't changed (a stopped instance doesn't get repeated identical rows). The Stats page charts signal-vs-squelch-threshold per channel over a selectable time window, plus per-channel and per-device counters as tiles. Retention is capped by `RTL_PANEL_STATS_RETENTION_DAYS` (default 7 days; pruned on every poll cycle).

## How it's built

The repo is an npm workspace monorepo with four packages, each one layer of the pipeline described in [CLAUDE.md](./CLAUDE.md):

| Package | What it does |
|---|---|
| [`backend/parser`](./backend/parser) | Hand-rolled libconfig tokenizer/parser/serializer. Converts a `.conf` file to a JSON domain model (`devices` → `channels` → `outputs`) and back, round-trip tested against a real sanitized fixture. |
| [`backend/validate`](./backend/validate) | Semantic checks on the JSON model, grounded in RTLSDR-Airband's own source: frequency-in-window (warning), FFT bin collisions between distinct frequencies (error), and CTCSS tone validity (warnings for non-positive values or near-miss typos of the 51 standard tones). |
| [`backend/api`](./backend/api) | Fastify HTTP API: instance CRUD, systemd restart, health checks, and stats history. Also serves the built frontend directly when present, so the whole app can run as one process. Fails closed — a config write that fails validation never touches disk or systemd. |
| [`frontend`](./frontend) | React + Vite + Tailwind UI: a resizable two-pane layout with the instance list on the left and a form editor or stats/charts view on the right. |

```
.conf file  <──parse/serialize──>  JSON model  <──validate──>  {errors, warnings}
                                        │
                    backend/api (CRUD, systemd, health, stats, serves frontend build)
                                        │
                                   frontend (React UI)
```

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
