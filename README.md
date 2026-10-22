# rtl-airband-panel

[![CI](https://github.com/jschmall/rtl-airband-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/jschmall/rtl-airband-panel/actions/workflows/ci.yml)
[![License: GPL v2](https://img.shields.io/badge/License-GPLv2-blue.svg)](./LICENSE)

A web control panel for [RTLSDR-Airband](https://github.com/rtl-airband/RTLSDR-Airband) instances.

Each SDR runs as its own systemd-managed `rtl_airband` process with its own
`.conf` file — one service per instance. Editing those files by hand and
remembering which unit to restart doesn't scale much past a couple of
instances. This panel gives you one place to view, edit, and restart all of
them, with validation before anything is written to disk.

> **`rust` branch:** the panel is being rebuilt as a single Rust binary
> (`rtl-airband-panel`) that serves the same API and the same web UI. To try
> it, see [Rust panel: download, build, and run](#rust-panel-download-build-and-run).
> The Node.js instructions further down still work on this branch and
> describe the TypeScript backend the Rust binary replaces.

## Project goals

- **Safe by default.** A config write that fails validation never touches
  disk or systemd — nothing runs until it's confirmed valid.
- **Minimal blast radius.** Editing one instance restarts only that
  instance's systemd unit, never anything else running on the box.
- **No pretending upstream can hot-reload.** RTLSDR-Airband reads its
  config once at startup and has no live-reload path, so the panel is
  upfront about needing a restart after a change, and tracks which
  instances are waiting for one instead of hiding it.
- **Configs stay readable.** Changes go through a JSON model and back out
  to a normal `.conf` file — not a black box. You can always open the file
  yourself and see exactly what changed.

## Features

**Config editing**
- Editor for devices, channels, mixers, and all seven RTLSDR-Airband output
  types (`pulse`, `file`, `rawfile`, `icecast`, `udp_stream`, `mixer`,
  `mixer_remote`), including rdio-scanner call uploads — that output type
  and `mixer_remote` (plus a mixer's `remote_inputs` block) both require
  [this fork](https://github.com/jschmall/RTLSDR-Airband) of RTLSDR-Airband,
  not the upstream project
- Drag-and-drop channel reordering (mouse, touch, and keyboard)
- Duplicate/clone buttons, and a "copy to channel" action for outputs
- Search across all instances by frequency, modulation, or device
- Usable on a phone or tablet, not just desktop — the sidebar becomes a
  slide-out drawer and dense field grids stack to fewer columns below a
  tablet-ish width

**Safety and validation**
- Inline validation with human-readable messages before you save
- Checks for frequency-window and FFT bin collisions, CTCSS tone validity,
  per-output-type constraints, and RTL-SDR's actual supported sample-rate
  ranges
- Secrets (stream passwords, etc.) redacted by default in the UI and API
- Automatic config backups kept on every save

**Operations**
- Create, rename, and delete instances — renaming or deleting restarts or
  stops the underlying systemd unit, and the panel warns you before it does
- Pending-restart tracking, with one-click bulk restart for everything
  waiting
- Config import and export
- Live, streaming log viewer per instance, with an optional structured
  JSON log format (requires the same RTLSDR-Airband fork noted above)
- Per-instance health checks

**Monitoring**
- Historical charts: signal vs. squelch threshold per channel, buffer and
  overrun counters, mixer stats
- A `/metrics` endpoint in Prometheus format

## Live apply without a restart

Requires an RTLSDR-Airband build from
[`jschmall/RTLSDR-Airband`](https://github.com/jschmall/RTLSDR-Airband)
(merged to that fork's `main` — [PR #18](https://github.com/jschmall/RTLSDR-Airband/pull/18)),
which gives a running instance a Unix domain control socket for live
retune/reconfiguration — so some config changes can take effect without the
full restart cycle every other change still requires. Not available against
upstream RTLSDR-Airband, or against a fork build older than that merge —
older/non-fork `rtl_airband` builds simply don't understand the protocol at
all, and the panel falls back to a normal restart-based save whenever the
socket is unreachable.

### New config fields

- **`control_socket_path`** (new top-level config field) — set this to the
  same Unix domain socket path the RTLSDR-Airband process is configured to
  listen on, and the panel gains a new **Apply live** button (next to Save
  and Save-and-restart). The path itself is arbitrary — any filesystem
  location works, there's no required directory or name — but it must be
  **unique per instance** (it's a real `bind()`; two instances sharing a
  path silently lose the race, see "Failure behavior" below) and writable
  by whichever user the instance's systemd unit runs as. Something like
  `/run/rtl-airband/<instance-name>.sock` per instance keeps this
  self-documenting. The panel does not check uniqueness across instances
  for you — only that the field isn't empty.
- **`bandwidth`** on a device (rtlsdr only) — the tuner's hardware capture
  bandwidth in Hz, `0`/blank for automatic. Distinct from a channel's own
  `bandwidth`, which is a post-demodulation audio filter, not a capture
  setting.
- **`correction`** on a device — frequency correction (PPM for
  rtlsdr/mirisdr, ppm-as-float for soapysdr). Already supported for a
  normal restart-based save even without the fork; the control socket is
  what makes changing it take effect live.
- **`enabled` field** on channels and mixers — distinct from the existing
  `disable`: `disable` permanently skips allocating that channel/mixer at
  parse time, while `enabled = false` still allocates it but starts it
  live-off, so it can be flipped on later via the control socket with no
  restart.
- **`reserve_channels` field** on devices (multichannel only) — reserves
  extra channel-array headroom at startup so a device's `channels` list can
  be edited later and picked up live via the same `reload_diff` command, no
  restart, as long as growth stays within the reserved headroom. This
  covers more than a tail append: adding, removing, and editing an existing
  channel's fields (freq/modulation/bandwidth/squelch/notch/ctcss/outputs)
  all apply live now, anywhere in the list — a non-tail change tears down
  and rebuilds every channel after the point of divergence (a brief
  interruption, not data loss) as a side effect. `reserve_inputs` (below)
  covers the equivalent headroom for a mixer's inputs. Adding a mixer or
  device that wasn't in the original config still requires a restart.
- **`reserve_inputs` field** on mixers — the mixer-side counterpart to
  `reserve_channels`: reserves extra mixer-input headroom so a
  dynamically-added or -edited channel whose output routes into this mixer
  (`type: "mixer"`) can connect live, within that headroom, no restart.
- **`mixer_remote` output type / mixers' `remote_inputs` field** — a
  separate, non-upstream RTLSDR-Airband fork feature (needs a build from
  its `mixer_remote_input` branch specifically, not the `dynamic_reload`
  one this section is otherwise about). The two halves behave differently
  under Apply live: a `mixer_remote` output is an ordinary output like any
  other, so editing or removing one on an existing channel applies live
  within that device's `reserve_channels` headroom same as always — but a
  mixer's `remote_inputs` entries are always restart-only, since
  RTLSDR-Airband only ever connects those slots once, at startup. See
  [Cross-instance mixer input](#cross-instance-mixer-input-mixer_remote)
  below for what it does and how to configure it.

### What Apply live can push without a restart

Clicking **Apply live** saves the config, then asks the running process to
live-apply whatever it safely can via `reload_diff` (which re-reads the
`.conf` file this just wrote), reporting back exactly what applied and
what's still pending. Currently live-appliable, all via that one
`reload_diff` call:

- **Centerfreq** (device retune)
- **Sample rate** — expensive (a full RX-thread stop/reopen/restart under
  the hood), but no longer restart-only
- **Gain**
- **Bandwidth** (rtlsdr tuner bandwidth, above)
- **Correction** (PPM, above)
- Channel/mixer **enable/disable** (the `enabled` field, above)
- Channel **add/edit/remove**, within a device's `reserve_channels`
  headroom (above)

Everything else — device/mixer count, driver `type`, `mode`, and any field
not listed above — still requires a restart.

**Failure behavior.** A field that's present in the config but fails to
apply at the hardware level (a transient i2c error, an unreachable device,
a socket-path collision leaving that instance's control socket never
started, etc.) is reported back distinctly from a field that's simply not
live-appliable at all: the Apply live result splits into "still needs a
restart" and "didn't take — no restart needed, just click Apply live
again" sections, so a flaky retry doesn't get conflated with something
that genuinely requires stopping the unit. None of these failures crash or
restart the instance on their own — RTLSDR-Airband keeps running at its
previous settings and simply reports the attempt as unsuccessful.

### Operational details

- Talks to the socket directly (`backend/api/src/control-socket/`). The
  control socket's `SO_PEERCRED` check requires an *exact* UID match
  against the daemon's own process, so the systemd unit needs an explicit
  `User=`/`Group=` matching whatever account the panel connects as — set
  via the opt-in "Service account" fields on each instance's edit page
  (`serviceUser`/`serviceGroup`, panel-only settings, not part of the
  `.conf` file). Left unset, the unit runs as root and Apply live fails
  with a permission error; the edit page warns inline when this applies.
- A 1-second per-instance cooldown throttles back-to-back Apply live
  clicks against the same instance (the config is still saved to disk
  either way; only the live-apply attempt itself is skipped and reported
  as "applied too recently").
- The fork tracks a `centerfreq_retune_failure_count` metric per device
  (surfaced on the stats page and `/metrics`) — how many live retune
  attempts (from Apply live, or the fork's own scan-mode frequency
  hopping) failed at the hardware level. A climbing count on otherwise
  healthy hardware points at a flaky tuner or i2c bus, not a crash risk.

### What's not here yet

The control socket also exposes `retune`, `set_gain`, `set_bandwidth`,
`set_correction`, `set_sample_rate`, `channel_enable`/`channel_disable`,
and `mixer_enable`/`mixer_disable` as individual live-control commands —
the panel only wires up the coarser `reload_diff` command, not per-field
live controls. Mixer/device add still always requires a restart. See
[issue #4](https://github.com/jschmall/rtl-airband-panel/issues/4) for a
known follow-up (page-level test coverage for the Apply live button).

## Cross-instance mixer input (`mixer_remote`)

Requires an RTLSDR-Airband build from
[`jschmall/RTLSDR-Airband`](https://github.com/jschmall/RTLSDR-Airband)'s
`mixer_remote_input` branch — a separate fork feature from the live-apply
one above (different branch, not yet merged to that fork's `main`); the two
aren't related and don't require each other.

Lets a mixer in one instance absorb a live audio input streamed from a
channel in a *different* instance's process, over a Unix domain socket —
useful on a host that runs several instances and wants to combine channels
from separate SDRs into one mixed stream, without a network hop. The
transport is same-host and same-OS-user only: the receiving instance's
socket only accepts packets from a sender running as its own user (checked
via `SCM_CREDENTIALS`, the same trust model `dynamic_reload`'s control
socket uses via `SO_PEERCRED`), so there's no separate authentication step
to configure and no exposure beyond the local machine.

**Sending side** — any channel (a device channel, or a mixer's own
embedded channel) gets a `mixer_remote` output, chosen from the same
output-type dropdown as every other output type:

```
outputs: (
  { type = "mixer_remote"; dest_path = "/run/rtl-airband/other-instance.sock"; stream_id = 0; }
);
```

**Receiving side** — the mixer that should absorb the input gets an entry
in its "Remote inputs" section, editable alongside its regular outputs;
each entry reserves one mixer-input slot:

```
mixers: {
  mymix: {
    remote_inputs: (
      { listen_path = "/run/rtl-airband/mymix.sock"; stream_id = 0; ampfactor = 1.0; balance = 0.0; label = "site2 ch1"; }
    );
    outputs: ( /* ... */ );
  };
};
```

`dest_path` on the sender must match `listen_path` on the receiver
exactly, and `stream_id` must match too — that's how the receiver tells
multiple senders apart when several share one `listen_path`. The panel
validates both: a negative `stream_id`, an out-of-range `balance`, or two
`remote_inputs` entries reusing the same `(listen_path, stream_id)` pair
anywhere in the instance's config (not just within one mixer — the fork
shares one listener registry per `listen_path` across every mixer) are all
flagged before you can save. Keep `dest_path`/`listen_path` short — these
are real Unix domain socket paths, capped at 107 bytes by the OS.

**Live apply.** The two sides behave differently. A `mixer_remote`
output is an ordinary channel output like any other, so editing or
removing one on an *existing* channel applies live via Apply live, within
that device's `reserve_channels` headroom, same as any other output-field
change — no special restriction. A mixer's `remote_inputs` entries are
different: RTLSDR-Airband only ever connects those slots once, at
startup (`parse_mixers()`), so there's no live-apply path for them at
all — adding, removing, or editing an entry always requires a restart.
Editing `remote_inputs` and clicking Apply live still saves the config
and reports the mixer correctly under "still needs a restart" (the fork's
`reload_diff` was fixed to detect and report this explicitly, rather than
silently doing nothing) — it just won't take effect until that restart
happens.

## Screenshots

The instance list, with the cross-instance search bar in the header and
each instance's live systemd status next to it:

![Instance list](./docs/screenshots/main_page.png)

An instance's config editor: its one device, and the channels defined on
it:

![Device and channel list](./docs/screenshots/instance_example.png)

A channel expanded, showing its demodulation settings and its outputs
(here, a mixer, a file, and a UDP stream):

![Channel and output editor](./docs/screenshots/Individual_channel.png)

The stats page: device counters, a signal-vs-squelch-threshold chart for a
selected channel, mixer stats, and channel counters:

![Stats page](./docs/screenshots/stats.png)

## Rust panel: download, build, and run

The Rust panel is one ~12 MB executable with the web UI and SQLite built in.
It serves the same API as the TypeScript backend, so the same browser UI works
against it. It reads and writes the same files (instance `.conf`s,
`.pending-restarts.json`, `.instance-options.json`, `.backups/`, the stats
database), so it can take over an existing install in place. Node.js is only
needed to *build* it, not to run it.

New compared to the TypeScript backend:

- **Change preview.** The editor shows, before you save, whether a change can
  be applied live over the control socket or needs a restart, and what a live
  apply would briefly interrupt. It accounts for what RTLSDR-Airband's
  `reload_diff` silently ignores, so a live apply no longer reports success
  for a change that never reached the running process.
- **Live updates.** Status changes and other users' edits arrive as they
  happen (a WebSocket at `/api/ws`), instead of a 20-second poll.
- **Login.** HTTP Basic auth (`RTL_PANEL_PASSWORD`). The panel refuses to
  listen on anything other than localhost without it.
- **New UI.** Status lights per instance, an overview of every instance, and
  a light theme.
- **Unknown settings are kept.** Config keys the panel doesn't model (newer
  RTLSDR-Airband options, hand-added keys) are written back unchanged instead
  of being dropped on save.

### 1. Get the source

```bash
git clone --branch rust https://github.com/jschmall/rtl-airband-panel.git
cd rtl-airband-panel
```

To build a specific version instead of the branch tip, check out its tag
(every commit is tagged, e.g. `git checkout v0.4.109`), or download that
tag's source archive from
`https://github.com/jschmall/rtl-airband-panel/archive/refs/tags/<tag>.tar.gz`.
There are no prebuilt binaries yet; the release workflow that will produce
them is planned for the `airband-bundle` branch.

### 2. Install the build tools

On the machine you build on:

- **Rust 1.85 or newer**, via [rustup](https://rustup.rs):
  `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **A C compiler** (SQLite is compiled in):
  `sudo apt install build-essential` on Debian/Ubuntu/Raspberry Pi OS
- **Node.js 20+ and npm**, to build the web UI that gets embedded in the
  binary (see [Installing](#installing) for checking your version)

Building natively on a Raspberry Pi works but is slow (expect tens of
minutes on a Pi 4) and wants at least 2 GB of RAM.

### 3. Build

```bash
npm ci
npm run build:deps                  # TypeScript packages the UI still takes types from
npm run build --workspace=frontend  # the web UI, embedded at compile time
cargo build --release -p rtl-airband-panel
```

The order matters. Cargo embeds whatever is in `frontend/dist` when it
compiles, so build the frontend first, and rebuild the binary after any
frontend change.

The result is `target/release/rtl-airband-panel`. It depends only on the
system C library, so you can copy it to another machine with the same CPU
architecture and the same or a newer glibc (for example, build on one
x86_64 Debian 12 box and run on another). Check it with:

```bash
./target/release/rtl-airband-panel --version
./target/release/rtl-airband-panel --help
```

### 4. Try it without touching anything live

Run it in mock mode against a **copy** of your instance configs. Mock mode
(the default) never calls `systemctl`, but saving in the UI does write
`.conf` files in the instances directory, which is why this uses a copy:

```bash
mkdir -p ~/panel-test
cp /path/to/your/instances/*.conf ~/panel-test/
./target/release/rtl-airband-panel --instances-dir ~/panel-test --port 3100
```

Open `http://localhost:3100`. On a headless host, tunnel the port from your
desktop with `ssh -L 3100:localhost:3100 you@host` and open the same URL
locally. In mock mode, unit statuses read "Unknown" until you start or
restart an instance from the UI. This can run alongside an existing panel on
a different port.

### 5. Install it as a service

These steps replace the TypeScript backend's `rtl-airband-panel.service`
(see [DEPLOYMENT.md](./DEPLOYMENT.md)) with the binary. Both use the same
files, so you can switch back by reversing them.

1. **Stop the Node.js panel** if it's running, so two panels never manage
   the same directory at once:

   ```bash
   sudo systemctl disable --now rtl-airband-panel
   ```

2. **Install the binary and unit:**

   ```bash
   sudo install -m 0755 target/release/rtl-airband-panel /usr/local/bin/
   sudo cp deploy/rtl-airband-panel-rust.service /etc/systemd/system/rtl-airband-panel.service
   ```

   Edit `User=` in the unit if your panel doesn't run as `rtl-airband-panel`.

3. **Write its settings** to `/etc/rtl-airband-panel/panel.env`. It's
   readable only by the panel's user because it holds the password:

   ```bash
   sudo install -m 0600 -o rtl-airband-panel /dev/null /etc/rtl-airband-panel/panel.env
   sudoedit /etc/rtl-airband-panel/panel.env
   ```

   For example:

   ```ini
   RTL_PANEL_INSTANCES_DIR=/etc/rtl-airband-panel/instances
   RTL_PANEL_STATS_DB_PATH=/home/rtl-airband-panel/.rtl-airband-panel/stats.db
   RTL_PANEL_HOST=0.0.0.0
   RTL_PANEL_PASSWORD=pick-a-long-password
   RTL_PANEL_SYSTEMD_MODE=sudo
   RTL_PANEL_SUDO_UNIT_PREFIX=rtl_
   RTL_PANEL_RTL_AIRBAND_BIN=/usr/local/bin/rtl_airband
   RTL_PANEL_DEFAULT_SERVICE_USER=rtl-airband-panel
   ```

   Point `RTL_PANEL_INSTANCES_DIR` and `RTL_PANEL_STATS_DB_PATH` at your
   existing ones to keep your instances, pending-restart state, backups and
   stats history. See [.env.example](./.env.example) for every setting.

4. **Update the sudoers rule.** This step is required in sudo mode, even if
   you already have the rule from the Node.js panel. The panel's status
   query now asks systemd for when each unit started, and sudo matches
   arguments exactly. Without the new line every status check is refused.
   Reinstall the rule from this branch:

   ```bash
   sudo cp deploy/rtl-airband-panel.sudoers /etc/sudoers.d/rtl-airband-panel
   sudo chmod 0440 /etc/sudoers.d/rtl-airband-panel
   sudo visudo -cf /etc/sudoers.d/rtl-airband-panel
   ```

   Re-apply any edits you made to the old copy, such as the username, the
   `rtl_` unit prefix, or the unit directory.

5. **Start it:**

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now rtl-airband-panel
   journalctl -u rtl-airband-panel -f
   ```

   Your browser asks for the username (`admin` unless you set
   `RTL_PANEL_USERNAME`) and password. Basic auth sends the password with
   every request, so put the panel behind an HTTPS reverse proxy
   ([DEPLOYMENT.md](./DEPLOYMENT.md)) if it's reachable beyond a trusted LAN.

**Live apply and the service user.** The control socket only accepts
connections from the same user `rtl_airband` runs as. Units the panel
generates get `User=`/`Group=` from the instance's own setting (instance page
→ Service account) or, failing that, from `RTL_PANEL_DEFAULT_SERVICE_USER`/
`_GROUP`. Existing units keep whatever they were installed with until you
save that instance's service account or options again.

### Settings that differ from the TypeScript backend

Everything in the [Configuration](#configuration) table works the same way,
by flag or environment variable. The Rust panel adds:

| Environment variable | Flag | Default | Purpose |
|---|---|---|---|
| `RTL_PANEL_PASSWORD` | `--password` | unset | HTTP Basic auth password; required when `RTL_PANEL_HOST` isn't loopback |
| `RTL_PANEL_USERNAME` | `--username` | `admin` | HTTP Basic auth username |
| `RTL_PANEL_ALLOW_UNAUTHENTICATED` | `--allow-unauthenticated` | `false` | Listen beyond localhost without a password (anyone who can reach the port can edit configs and restart units) |
| `RTL_PANEL_DEFAULT_SERVICE_USER` / `_GROUP` | `--default-service-user` / `--default-service-group` | unset | `User=`/`Group=` for generated instance units without a per-instance setting |
| `RTL_PANEL_CONTROL_SOCKET_TIMEOUT_MS` | `--control-socket-timeout-ms` | `8000` | How long to wait for a live-apply response before giving up |

And changes two existing settings:

- `RTL_PANEL_LOG_LEVEL` takes a filter such as `info`, `debug`, or
  `panel=debug,info`.
- `RTL_PANEL_FRONTEND_DIST` is optional. By default the UI built into the
  binary is served.

The `.env` file is read from the current directory (or `--env-file`), then
real environment variables, then flags, highest last, the same as before.

### Reporting problems

Include `rtl-airband-panel --version`, the relevant lines from
`journalctl -u rtl-airband-panel`, and the `x-request-id` response header of
a failed request if you have it. That id also tags the panel's audit log
line for the action.

## Installing

**Prerequisites:** Node.js 20 or newer, and npm. Check what you have:

```bash
node --version
npm --version
```

This is a hard requirement — the app will fail to start on Node 18.

To control real systemd units (start/stop/restart actual `rtl_airband`
services), the user running the panel needs `sudo` access to `systemctl`.
This is optional — see [Systemd control](#systemd-control) below. Without
it, the panel still runs fully in a safe simulated mode.

Clone the repository and install:

```bash
git clone https://github.com/jschmall/rtl-airband-panel.git
cd rtl-airband-panel
npm install
npm run build:deps
```

`npm run build:deps` builds the internal packages the rest of the app
depends on. It's required before the first run, and after every
`git pull` — skipping it is the most common cause of "I fixed it but it's
still broken."

## First run

Build and start the server:

```bash
npm run build
npm start --workspace=backend/api
```

Open `http://localhost:3000` in a browser.

By default:

- The server only listens on `127.0.0.1`, reachable from this machine only.
- Systemd actions are simulated, not real — the panel logs what it would do
  instead of calling `systemctl`. Nothing on the real system is touched.
- It looks for instance `.conf` files in
  `/etc/rtl-airband-panel/instances`.

All of this is configurable — see [Configuration](#configuration) below.

To run this for real — reachable on your network, as a systemd service,
behind a reverse proxy, or with real systemd control enabled — see
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Configuration

The server can be configured three ways, and they can be mixed:

- Command-line flags, e.g. `npm start --workspace=backend/api -- --port 8080`
- Environment variables, e.g. `RTL_PANEL_PORT=8080 npm start --workspace=backend/api`
- A `.env` file in the directory you invoke `npm`/`node` from (or a custom
  path via `--env-file <path>`)

If the same setting is given more than one way, the order of precedence,
highest first, is: command-line flag, then environment variable, then
`.env` file, then the default below. A missing `.env` file is not an
error — it's simply skipped.

See [`.env.example`](.env.example) in the repo root for a template covering
every setting — copy it to `.env` in the directory you run
`npm start --workspace=backend/api` from, and adjust as needed (only the
settings you want to override need to be present).

Run `node backend/api/dist/index.js --help` after building to see the full
flag list.

| Environment variable | Flag | Default | Purpose |
|---|---|---|---|
| `RTL_PANEL_INSTANCES_DIR` | `--instances-dir` | `/etc/rtl-airband-panel/instances` | Directory containing per-instance `.conf` files. Also holds a `.pending-restarts.json` written by the panel itself, tracking which instances have a saved config their running unit hasn't picked up yet — safe to ignore, don't edit it by hand |
| `RTL_PANEL_UNIT_DIR` | `--unit-dir` | `/etc/systemd/system` | Where systemd unit files are installed |
| `RTL_PANEL_RTL_AIRBAND_BIN` | `--rtl-airband-bin` | `/usr/local/bin/rtl_airband` | Binary path used in generated unit files |
| `RTL_PANEL_SYSTEMD_MODE` | `--systemd-mode` | `mock` | `mock` (safe, no real systemctl calls) or `sudo` (real) |
| `RTL_PANEL_SUDO_UNIT_PREFIX` | `--sudo-unit-prefix` | `` (empty) | In `sudo` mode, only act on units named `<prefix>*.service`; empty means no restriction beyond the existing safe-name check. See [Systemd control](#systemd-control) |
| `RTL_PANEL_PORT` | `--port` | `3000` | API listen port |
| `RTL_PANEL_HOST` | `--host` | `127.0.0.1` | API listen host |
| `RTL_PANEL_LOG_LEVEL` | `--log-level` | `info` | Pino log level for the panel's own process: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent` |
| `RTL_PANEL_LOG_FILE` | `--log-file` | unset (stdout) | Write the panel's own logs (NDJSON) to this file instead of stdout. Only affects the panel's own request/audit logging — it does not touch `sudo`'s own PAM/session-accounting lines in syslog, which the OS writes regardless of this setting; see [Systemd control](#systemd-control) for why those exist and how `sudo`-mode health polling minimizes them |
| `RTL_PANEL_FRONTEND_DIST` | `--frontend-dist` | `frontend/dist` (repo-relative) | Where to look for the frontend's build to serve as a single process; a missing build is not an error, it just falls back to API-only |
| `RTL_PANEL_STATS_DB_PATH` | `--stats-db-path` | `~/.rtl-airband-panel/stats.db` | SQLite file the stats poller writes historical samples to |
| `RTL_PANEL_STATS_POLL_INTERVAL_MS` | `--stats-poll-interval-ms` | `15000` | How often each instance's stats file is re-read |
| `RTL_PANEL_STATS_RETENTION_DAYS` | `--stats-retention-days` | `7` | Samples older than this are eligible for pruning; `0` or negative disables pruning |
| `RTL_PANEL_STATS_PRUNE_INTERVAL_MS` | `--stats-prune-interval-ms` | `3600000` (1 hour) | Minimum time between prune passes over the stats DB, independent of how often the poll cycle itself runs |

### Systemd control

Instance names map to config files and systemd units by a fixed convention:
`<name>.conf` ↔ `<name>.service`, matching basenames exactly, no `@`
templating. The name itself is entirely up to you — `rtl_151780`,
`office-scanner`, `151780`, whatever fits your own systemd units. Setting
`RTL_PANEL_SYSTEMD_MODE=sudo` (or `--systemd-mode sudo`) makes the backend
shell out to real `sudo systemctl` commands. Only turn this on once you're
ready to affect real running instances, and consider testing against a
non-critical instance first.

**Scoping sudo access to your instances.** By default
(`RTL_PANEL_SUDO_UNIT_PREFIX` unset), `sudo` mode will act on any unit
whose name passes the existing safe-name check — there's no naming
convention forced on you. That also means, on its own, sudo access isn't
scoped by *which* units they are, only by which `systemctl`/`journalctl`/
`tee`/`rm` commands the adapter is allowed to run at all (see the sudoers rule in
[DEPLOYMENT.md](./DEPLOYMENT.md#running-the-panel-as-a-systemd-service)).
If you'd rather the panel's sudo grant be provably limited to only the
units it manages, set `RTL_PANEL_SUDO_UNIT_PREFIX` to a prefix your
instance names always start with (e.g. `rtl_` if you name instances
`rtl_151780`, `rtl_office`, etc.) — the adapter will then refuse
in-process to act on any unit not starting with it, and you write a
matching glob into the sudoers rule (see
[`deploy/rtl-airband-panel.sudoers`](./deploy/rtl-airband-panel.sudoers),
which uses `rtl_` as its example). The two checks — the adapter's
in-process prefix check and the sudoers glob — need to agree for an action
to reach systemd; a mismatch fails closed (the adapter rejects, or sudo
denies), never open. If your instances don't share a common prefix, leave
it unset and rely on the command-scoping alone.

**Syslog volume from `sudo` mode.** Every `sudo systemctl ...` the adapter
runs gets its own PAM session-open/close pair and command-audit line from
`sudo` itself, written straight to syslog by the OS — that's independent
of the panel's own logger and `RTL_PANEL_LOG_FILE` above has no effect on
it. The frontend's background health poll (the sidebar's per-instance
status dots) checks every instance in a single batched `sudo systemctl
show unit1 unit2 ...` call per poll cycle rather than one call per
instance, specifically to keep this volume from scaling with instance
count.

### Stats & graphing

RTLSDR-Airband writes each instance's `stats_filepath` in real Prometheus
text-exposition format (`# HELP`/`# TYPE` comments, `metric{labels}`
lines) — per-channel signal/noise/squelch levels and counters, plus
device/mixer overrun counters — but it rewrites the file in full on every
write (roughly every 15 seconds), so it holds only the latest snapshot, no
history.

`backend/api` polls each running instance's stats file on that same
cadence and records every sample into a local SQLite database
(`RTL_PANEL_STATS_DB_PATH`), skipping a read if the file's modification
time hasn't changed (a stopped instance doesn't get repeated identical
rows). The Stats page charts signal-vs-squelch-threshold per channel over a
selectable time window, plus per-channel and per-device counters as tiles.
Retention is capped by `RTL_PANEL_STATS_RETENTION_DAYS` (default 7 days).
Pruning itself runs on its own cadence, `RTL_PANEL_STATS_PRUNE_INTERVAL_MS`
(default 1 hour) — decoupled from the poll interval so a DB pass (which
scales with total accumulated row count, not with how often the poller
ticks) doesn't run every single poll cycle.

The panel's own polling always reads the stats file straight off local
disk. Separately, on the RTLSDR-Airband fork noted under
[Features](#features), a device can optionally set `stats_http_address`/
`stats_http_port` to have RTLSDR-Airband itself serve that same file's
contents over HTTP — a different mechanism, useful if you want to scrape
an instance's stats from somewhere other than this panel.

## Current scope

The JSON model covers both `multichannel`- and `scan`-mode devices,
top-level mixer *definitions* (the `mixers: { ... }` group itself, not just
a channel routing into one by name, plus its `remote_inputs` block), all
seven RTLSDR-Airband output types (`pulse`, `file`, `rawfile`, `icecast`,
`udp_stream`, `mixer`, `mixer_remote`) including the rdio-scanner
call-upload block (see the note under [Features](#features) — this and
`mixer_remote`/`remote_inputs` require the non-upstream RTLSDR-Airband
fork), and per-channel options like
`highpass`/`lowpass`/`tau`/`label`/`labels`.

## Learn more

- [DEPLOYMENT.md](./DEPLOYMENT.md) — running this as a real service:
  network exposure, reverse proxies, systemd, logs and backups.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — how the pieces fit together, the
  test suite, and the conventions a change is expected to follow.
- [CLAUDE.md](./CLAUDE.md) — the fuller set of architectural constraints.

## License

[GPL-2.0](./LICENSE).
