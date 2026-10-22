# rtl-airband-panel

[![CI](https://github.com/jschmall/rtl-airband-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/jschmall/rtl-airband-panel/actions/workflows/ci.yml)
[![License: GPL v2](https://img.shields.io/badge/License-GPLv2-blue.svg)](./LICENSE)

A web control panel for [RTLSDR-Airband](https://github.com/rtl-airband/RTLSDR-Airband) instances.

Each SDR runs as its own systemd-managed `rtl_airband` process with its own
`.conf` file — one service per instance. Editing those files by hand and
remembering which unit to restart doesn't scale much past a couple of
instances. This panel gives you one place to view, edit, and restart all of
them, with validation before anything is written to disk.

The panel is a single self-contained binary (`rtl-airband-panel`, about
10 MB) with its web UI built in. It's developed against
[`jschmall/RTLSDR-Airband`](https://github.com/jschmall/RTLSDR-Airband), a
fork that tracks upstream and adds live reconfiguration, rdio-scanner
uploads, cross-instance mixing and more. Most of the panel works with
upstream RTLSDR-Airband too; fork-only features are marked below.

## Project goals

- **Safe by default.** A config write that fails validation never touches
  disk or systemd — nothing runs until it's confirmed valid.
- **Minimal blast radius.** Editing one instance restarts only that
  instance's systemd unit, never anything else running on the box.
- **Honest about restarts.** RTLSDR-Airband reads most of its config once at
  startup. The fork can apply some changes live; for everything else the
  panel says up front that a restart is needed, and tracks which instances
  are still waiting for one instead of hiding it.
- **Configs stay readable.** Changes go through a JSON model and back out
  to a normal `.conf` file — not a black box. You can always open the file
  yourself and see exactly what changed.

## Features

**Config editing**
- Editor for devices, channels, mixers, and all seven RTLSDR-Airband output
  types (`pulse`, `file`, `rawfile`, `icecast`, `udp_stream`, `mixer`,
  `mixer_remote`), including rdio-scanner call uploads (rdio-scanner and
  `mixer_remote` need the fork)
- Live validation as you type, using the same validator the server runs
  before every save
- A change preview before you save: whether the edit can be applied to the
  running instance live or needs a restart, and what a live apply would
  briefly interrupt
- Drag-and-drop channel reordering (mouse, touch, and keyboard)
- Duplicate/clone buttons, and a "copy to channel" action for outputs
- Search across all instances by name, channel label, frequency, or
  modulation
- Works on a phone or tablet; navigation becomes a slide-out drawer

**Safety and validation**
- Checks for frequency-window and FFT bin collisions, CTCSS tone validity,
  per-output-type constraints, RTL-SDR's actual supported sample-rate
  ranges, and the split-file settings of RTLSDR-Airband v5.5+
- Settings the panel doesn't know about are kept, never silently dropped
- Secrets (stream passwords, API keys) redacted by default in the UI and API
- Automatic config backups on every save
- Optional login (HTTP Basic auth), required whenever the panel listens on
  anything other than localhost

**Operations**
- Overview of every instance: status, uptime, frequency range, problem
  counters
- Create, rename, and delete instances; the panel warns before anything
  that restarts or stops a unit
- Apply live: push changes to a running instance without a restart (fork)
- Pending-restart tracking, with one-click restart of everything waiting
- Live updates in the browser as unit status changes or someone else saves
- Config import and export
- Live, streaming log viewer per instance, with optional structured JSON
  logs (fork)
- Dark and light themes

**Monitoring**
- Historical charts: signal vs. squelch threshold per channel, buffer and
  overrun counters, mixer stats
- A `/metrics` endpoint in Prometheus format

## Installing

There are no prebuilt binaries yet, so you build from source. The build
takes a couple of minutes on a PC. On a Raspberry Pi it works natively but
is slow: expect tens of minutes on a Pi 4, with at least 2 GB of RAM.

**Build tools** (only on the machine you build on):

- **Rust 1.85 or newer**, via [rustup](https://rustup.rs):
  `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **A C compiler** (SQLite is compiled in):
  `sudo apt install build-essential` on Debian/Ubuntu/Raspberry Pi OS
- **Node.js 20 or newer, and npm**, to build the web UI that gets embedded
  in the binary. Check with `node --version`.

**Build:**

```bash
git clone https://github.com/jschmall/rtl-airband-panel.git
cd rtl-airband-panel
npm ci
npm run build --workspace=frontend  # the web UI, embedded at compile time
cargo build --release -p rtl-airband-panel
```

The order matters: Cargo embeds whatever is in `frontend/dist` when it
compiles, so build the frontend first, and rebuild the binary after any
frontend change. To build a specific version, check out its tag first
(every commit is tagged, e.g. `git checkout v0.4.112`).

The result is `target/release/rtl-airband-panel`. It depends only on the
system C library, so you can copy it to another machine with the same CPU
architecture and the same or a newer glibc. Install it with:

```bash
sudo install -m 0755 target/release/rtl-airband-panel /usr/local/bin/
rtl-airband-panel --version
```

## First run

Start it in mock mode against a **copy** of your instance configs:

```bash
mkdir -p ~/panel-test
cp /path/to/your/instances/*.conf ~/panel-test/
rtl-airband-panel --instances-dir ~/panel-test
```

Open `http://localhost:3000`. On a headless host, tunnel the port from your
desktop with `ssh -L 3000:localhost:3000 you@host` and open the same URL
locally.

By default:

- The panel only listens on `127.0.0.1`, reachable from this machine only.
- Systemd actions are simulated (mock mode): the panel never calls
  `systemctl`, and unit statuses read "Unknown" until you start or restart
  an instance from the UI. Saving does still write the `.conf` files in the
  instances directory, which is why this uses a copy.
- It looks for instance `.conf` files in `/etc/rtl-airband-panel/instances`
  unless you pass `--instances-dir`.

To run it for real (as a systemd service, reachable on your network,
controlling real units, or replacing an older Node.js install of this
panel), see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Configuration

The panel can be configured three ways, and they can be mixed:

- Command-line flags, e.g. `rtl-airband-panel --port 8080`
- Environment variables, e.g. `RTL_PANEL_PORT=8080 rtl-airband-panel`
- A `.env` file in the current directory, or a path given with
  `--env-file <path>`; under systemd, the unit's `EnvironmentFile=`

If the same setting is given more than one way, the order of precedence,
highest first, is: command-line flag, then environment variable, then
`.env` file, then the default below. See [`.env.example`](.env.example) for
a template, and `rtl-airband-panel --help` for the full flag list.

| Environment variable | Flag | Default | Purpose |
|---|---|---|---|
| `RTL_PANEL_INSTANCES_DIR` | `--instances-dir` | `/etc/rtl-airband-panel/instances` | Directory containing per-instance `.conf` files. The panel also keeps its own state here (`.pending-restarts.json`, `.instance-options.json`, `.running/`, `.backups/`); don't edit those by hand |
| `RTL_PANEL_UNIT_DIR` | `--unit-dir` | `/etc/systemd/system` | Where systemd unit files are installed |
| `RTL_PANEL_RTL_AIRBAND_BIN` | `--rtl-airband-bin` | `/usr/local/bin/rtl_airband` | Binary path used in generated unit files |
| `RTL_PANEL_SYSTEMD_MODE` | `--systemd-mode` | `mock` | `mock` (safe, no real systemctl calls) or `sudo` (real) |
| `RTL_PANEL_SUDO_UNIT_PREFIX` | `--sudo-unit-prefix` | `` (empty) | In `sudo` mode, only act on units named `<prefix>*.service`; empty means no restriction beyond the safe-name check. See [Systemd control](#systemd-control) |
| `RTL_PANEL_DEFAULT_SERVICE_USER` / `_GROUP` | `--default-service-user` / `--default-service-group` | unset | `User=`/`Group=` for generated instance units without a per-instance setting. Set to the panel's own user so live apply works (see [Live apply](#live-apply-without-a-restart)) |
| `RTL_PANEL_PORT` | `--port` | `3000` | Listen port |
| `RTL_PANEL_HOST` | `--host` | `127.0.0.1` | Listen address |
| `RTL_PANEL_ALLOWED_HOSTS` | `--allowed-hosts` | unset | Extra host names (comma-separated) a loopback-bound panel answers to, such as a reverse proxy's public name. See [DEPLOYMENT.md](./DEPLOYMENT.md#running-behind-a-reverse-proxy) |
| `RTL_PANEL_PASSWORD` | `--password` | unset | HTTP Basic auth password. Required when `RTL_PANEL_HOST` isn't a loopback address |
| `RTL_PANEL_USERNAME` | `--username` | `admin` | HTTP Basic auth username |
| `RTL_PANEL_ALLOW_UNAUTHENTICATED` | `--allow-unauthenticated` | `false` | Listen beyond localhost without a password. Anyone who can reach the port can then edit configs and restart units |
| `RTL_PANEL_LOG_LEVEL` | `--log-level` | `info` | Log filter: `error`, `warn`, `info`, `debug`, `trace`, or per-module, e.g. `panel=debug,info` |
| `RTL_PANEL_LOG_FILE` | `--log-file` | unset (stdout) | Write the panel's own logs (NDJSON) to this file instead of stdout. Doesn't affect `sudo`'s own syslog lines; see [Systemd control](#systemd-control) |
| `RTL_PANEL_FRONTEND_DIST` | `--frontend-dist` | unset | Serve the UI from this directory instead of the copy built into the binary (useful while developing the frontend) |
| `RTL_PANEL_STATS_DB_PATH` | `--stats-db-path` | `~/.rtl-airband-panel/stats.db` | SQLite file for historical stats samples |
| `RTL_PANEL_STATS_POLL_INTERVAL_MS` | `--stats-poll-interval-ms` | `15000` | How often each instance's stats are re-read |
| `RTL_PANEL_STATS_RETENTION_DAYS` | `--stats-retention-days` | `7` | Samples older than this are pruned; `0` disables pruning |
| `RTL_PANEL_STATS_PRUNE_INTERVAL_MS` | `--stats-prune-interval-ms` | `3600000` (1 hour) | Minimum time between prune passes over the stats DB |
| `RTL_PANEL_CONTROL_SOCKET_TIMEOUT_MS` | `--control-socket-timeout-ms` | `8000` | How long to wait for a live-apply response before giving up |

### Systemd control

Instance names map to config files and systemd units by a fixed convention:
`<name>.conf` ↔ `<name>.service`, matching basenames exactly, no `@`
templating. The name itself is entirely up to you — `rtl_151780`,
`office-scanner`, `151780`, whatever fits your own systemd units. Setting
`RTL_PANEL_SYSTEMD_MODE=sudo` (or `--systemd-mode sudo`) makes the panel
shell out to real `sudo systemctl` commands. Only turn this on once you're
ready to affect real running instances, and consider testing against a
non-critical instance first.

**Scoping sudo access to your instances.** By default
(`RTL_PANEL_SUDO_UNIT_PREFIX` unset), `sudo` mode will act on any unit
whose name passes the existing safe-name check — there's no naming
convention forced on you. That also means, on its own, sudo access isn't
scoped by *which* units they are, only by which `systemctl`/`journalctl`/
`tee`/`rm` commands the adapter is allowed to run at all (see the sudoers rule in
[DEPLOYMENT.md](./DEPLOYMENT.md#allowing-real-systemd-control-sudo-mode)).
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
it. The panel checks every instance's status in a single batched `sudo
systemctl show unit1 unit2 ...` call (every few seconds while a browser
is connected) rather than one call per instance, specifically to keep
this volume from scaling with instance count.

### Stats & graphing

RTLSDR-Airband writes each instance's `stats_filepath` in real Prometheus
text-exposition format (`# HELP`/`# TYPE` comments, `metric{labels}`
lines) — per-channel signal/noise/squelch levels and counters, plus
device/mixer overrun counters — but it rewrites the file in full on every
write (roughly every 15 seconds), so it holds only the latest snapshot, no
history.

The panel polls each running instance's stats on that same cadence and records every sample into a local SQLite database
(`RTL_PANEL_STATS_DB_PATH`), skipping a read if the file's modification
time hasn't changed (a stopped instance doesn't get repeated identical
rows). The Stats page charts signal-vs-squelch-threshold per channel over a
selectable time window, plus per-device and per-output counters, and the
Overview page totals each instance's problem counters.
Retention is capped by `RTL_PANEL_STATS_RETENTION_DAYS` (default 7 days).
Pruning itself runs on its own cadence, `RTL_PANEL_STATS_PRUNE_INTERVAL_MS`
(default 1 hour) — decoupled from the poll interval so a DB pass (which
scales with total accumulated row count, not with how often the poller
ticks) doesn't run every single poll cycle.

When an instance sets `stats_http_address`/`stats_http_port` (a fork
feature that has RTLSDR-Airband itself serve the stats file over HTTP),
the panel reads that endpoint instead of the file, so it doesn't need
read access to the file. RTLSDR-Airband's `stats_update_interval` (default
15 s) sets how often the snapshot changes.

## Live apply without a restart

Needs the [`jschmall/RTLSDR-Airband`](https://github.com/jschmall/RTLSDR-Airband)
fork, which gives each running instance a Unix domain control socket. Set
`control_socket_path` in an instance's config (a unique path per instance,
writable by the user the instance runs as, e.g.
`/run/rtl-airband/<name>.sock`). The editor then offers **Apply live** next
to Save and Save-and-restart. Against upstream RTLSDR-Airband, or when the
socket can't be reached, the panel falls back to a normal save.

**What can change live**, via the fork's `reload_diff` command:

- **Centerfreq** (a retune)
- **Sample rate** on rtlsdr and mirisdr devices. This briefly stops and
  reopens the whole device
- **Gain**, on rtlsdr and soapysdr devices (numeric gain only)
- **Tuner bandwidth**, on rtlsdr and soapysdr devices
- **Correction** (PPM), on rtlsdr devices
- Channel and mixer **enable/disable** (the `enabled` field; `disable`
  still means "not allocated at all")
- Adding, editing and removing **channels** within a device's
  `reserve_channels` headroom. Editing a channel re-creates it and every
  channel after it in the list, a brief interruption of those channels'
  audio. `reserve_inputs` gives a mixer matching headroom for channels
  routed into it

Everything else needs a restart, including any global setting, a mixer's
own outputs or filters, `remote_inputs`, device serial or buffers, and
adding or removing a device or mixer.

**The change preview tells you which applies before you save.** It mirrors
the fork's own comparison logic and also catches what `reload_diff` drops
without reporting, such as a change outside its scope, a setter the device's
driver doesn't support, or a non-integer `correction`/`bandwidth` (which
`reload_diff` would misread as MHz). "Restart pending" is cleared only when
both `reload_diff` and the preview agree everything was applied.

**Results.** After Apply live, the panel shows what applied, what still
needs a restart, and what didn't take but can simply be retried (a
transient hardware error, for example). None of these failures restart or
crash the instance; it keeps running on its previous settings. A
1-second per-instance cooldown throttles back-to-back clicks.

**The service user.** The control socket only accepts connections from the
same user `rtl_airband` runs as. Set each instance's service account on its
page, or `RTL_PANEL_DEFAULT_SERVICE_USER`/`_GROUP` for every unit the panel
generates, to the user the panel runs as. Otherwise the unit runs as root
and Apply live fails with a permission error (the edit page warns about
this).

**Predictions are exact once the panel has (re)started an instance.** It
records what each process was started with under `.running/` in the
instances directory. For an instance started some other way, it assumes
the config on disk is what's running, and says so.

## Cross-instance mixer input (`mixer_remote`)

Requires the [`jschmall/RTLSDR-Airband`](https://github.com/jschmall/RTLSDR-Airband)
fork (on its `main` since v5.5.0). Independent of live apply: the two
features don't require each other.

Lets a mixer in one instance absorb a live audio input streamed from a
channel in a *different* instance's process, over a Unix domain socket —
useful on a host that runs several instances and wants to combine channels
from separate SDRs into one mixed stream, without a network hop. The
transport is same-host and same-OS-user only: the receiving instance's
socket only accepts packets from a sender running as its own user (checked
via `SCM_CREDENTIALS`, the same trust model the control socket uses via
`SO_PEERCRED`), so there's no separate authentication step
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
The editor's change preview says so before you save, and Apply live
reports the mixer under "still needs a restart".

## Screenshots

The overview: every instance's status, uptime, frequency range and problem
counters, with the instance list and its status lights on the left:

![Overview](./docs/screenshots/main_page.png)

An instance's editor. The bar at the bottom shows the change preview: this
edit can be applied live, with the details expanded:

![Instance editor with change preview](./docs/screenshots/instance_example.png)

A channel expanded, showing its demodulation settings and outputs:

![Channel and output editor](./docs/screenshots/Individual_channel.png)

The stats page: device counters, a signal-vs-squelch-threshold chart for a
selected channel, mixer stats, and channel counters:

![Stats page](./docs/screenshots/stats.png)

## Current scope

The JSON model covers both `multichannel`- and `scan`-mode devices,
top-level mixer *definitions* (the `mixers: { ... }` group itself, not just
a channel routing into one by name, plus its `remote_inputs` block), all
seven RTLSDR-Airband output types (`pulse`, `file`, `rawfile`, `icecast`,
`udp_stream`, `mixer`, `mixer_remote`) including the rdio-scanner
call-upload block (this and `mixer_remote`/`remote_inputs` require the
RTLSDR-Airband fork), and per-channel options like
`highpass`/`lowpass`/`tau`/`label`/`labels`.

Settings the panel doesn't model yet (newer RTLSDR-Airband options,
hand-added keys) are kept exactly as written when you save, and listed as
warnings so you know they're there. Comments in a `.conf` file are not kept:
every save rewrites the file in the panel's canonical layout (backups of
the previous version are kept under `.backups/`).

## Learn more

- [DEPLOYMENT.md](./DEPLOYMENT.md): running this as a real service, with
  network exposure, reverse proxies, systemd and sudo, migrating from the
  Node.js panel, logs and backups.
- [CONTRIBUTING.md](./CONTRIBUTING.md): how the pieces fit together, the
  test suite, and the conventions a change is expected to follow.
- [CLAUDE.md](./CLAUDE.md): the fuller set of architectural constraints.

## License

[GPL-2.0](./LICENSE).
