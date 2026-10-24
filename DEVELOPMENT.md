# Development

How rtl-airband-panel is put together, how to build and test it, and how
the parts that matter most work inside. For using and deploying the panel,
see [README.md](./README.md) and [DEPLOYMENT.md](./DEPLOYMENT.md); for the
pull-request process, [CONTRIBUTING.md](./CONTRIBUTING.md).
[CLAUDE.md](./CLAUDE.md) holds the project's hard constraints and
conventions (written as agent instructions, equally binding for humans).

## Layout

A Cargo workspace plus one npm workspace (the frontend):

| Part | What it does |
|---|---|
| [`crates/airband-config`](./crates/airband-config) | Hand-rolled libconfig tokenizer/parser/serializer and the JSON domain model (`devices` → `channels` → `outputs`, `mixers`). |
| [`crates/airband-validate`](./crates/airband-validate) | Semantic checks on the domain model, grounded in RTLSDR-Airband's own source. |
| [`crates/airband-supervisor`](./crates/airband-supervisor) | Everything that talks to RTLSDR-Airband from outside the process: systemd units, the fork's control socket, stats, journal logs, unit files, and `plan_change` (the live-apply-vs-restart prediction). |
| [`crates/panel`](./crates/panel) | The `rtl-airband-panel` binary: axum HTTP API, `/api/ws` push channel, SQLite stats history, auth and request guards, the instance service, the embedded frontend. |
| [`crates/airband-wasm`](./crates/airband-wasm) | `airband-validate` compiled to WebAssembly for live validation in the editor. |
| [`frontend`](./frontend) | React + Vite + Tailwind UI. Its config/validation types and constants are generated from the Rust crates. |
| [`vendor/RTLSDR-Airband`](https://github.com/jschmall/RTLSDR-Airband) | The fork, as a git submodule pinned to a release tag. Only the release build uses it. |
| [`packaging`](./packaging) | Release build (`Dockerfile`), `install.sh`, the udev rule and kernel-driver blacklist. |

```
.conf file  <──parse/serialize──>  domain model  <──validate──>  {errors, warnings}
                                        │                    (also in the browser via wasm)
                 panel: CRUD, systemd, control socket, stats, plan, serves frontend
                                        │
                                frontend (React UI)
```

RTLSDR-Airband itself is never linked in: it's a monolithic C++ program
with global state that calls `_Exit()` on config errors, so the panel only
controls it from outside (systemd, the control socket, the stats file or
HTTP endpoint, the journal).

## Building and testing

Tools: Rust 1.85+, a C compiler (SQLite is bundled), Node.js 20+.

```bash
npm ci
cargo test --workspace          # Rust crates (also regenerates frontend/src/generated)
npm test --workspace=frontend   # frontend unit tests
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

Release build (what users run):

```bash
npm run build --workspace=frontend   # must come first, see below
cargo build --release -p rtl-airband-panel
```

Nothing in the test suite touches real systemd or a real instances
directory: the Rust tests use a mock unit manager, temp directories, and
fake control-socket/stats servers. Frontend tests use Vitest + React
Testing Library in jsdom (`frontend/test/`, mirroring `frontend/src/`);
`tsc --noEmit` (part of `npm run build --workspace=frontend`) catches what
they don't.

CI (`.github/workflows/ci.yml`) runs a `frontend` job (tests, build) and a
`rust` job (fmt, clippy, tests, generated-type drift, wasm build).

### Things that go stale silently

- **Release builds embed `frontend/dist` at compile time** (rust-embed).
  Build the frontend before `cargo build --release`, and rebuild the binary
  after any frontend change. Debug builds read `frontend/dist` from disk at
  runtime, which hides this during development.
- **`frontend/src/generated/*.ts`** are written by `cargo test` from the
  `#[derive(TS)]` types (ts-rs; the output directory is set in
  `.cargo/config.toml`). Commit the regenerated files with the Rust change
  that caused them; CI fails on drift. The UI imports them through
  `frontend/src/types/config.ts`, which also re-adds each output variant's
  `type` tag.
- **`frontend/src/generated/wasm`** is the browser validator. Rebuild it
  with `scripts/build-wasm.sh` after any change to validation (needs
  `rustup target add wasm32-unknown-unknown` and
  `cargo install wasm-bindgen-cli --version 0.2.129 --locked`). CI only
  checks that it builds. A rebuild from a clean cache changes the .wasm
  bytes even without source changes; don't commit byte-only churn.

Never hand-edit anything under `frontend/src/generated`.

### Running the frontend with hot reload

```bash
# terminal 1: the panel, in mock mode, against some configs
cargo run -p rtl-airband-panel -- --instances-dir fixtures

# terminal 2: the frontend, with hot reload
npm run dev --workspace=frontend
```

Open `http://localhost:5173`. Vite proxies `/api/*` (including the
`/api/ws` WebSocket) to the panel at `http://127.0.0.1:3000` (override with
`VITE_API_PROXY_TARGET`). Point `--instances-dir` at a copy if you plan to
save. To check a built frontend without rebuilding the binary, pass
`--frontend-dist frontend/dist`.

## Releases

A release is a tarball per architecture,
`rtl-airband-panel-vX.Y.Z-linux-{amd64,arm64}.tar.gz`, holding both
programs (`bin/`), `install.sh`, the files it installs (`deploy/`), the
docs, and a `VERSIONS` file. Both programs are fully static (musl), so one
tarball runs on any Linux distribution of that architecture.

### Building one

```bash
git submodule update --init      # once, after cloning
scripts/build-release.sh amd64   # or arm64; output in dist/
```

It needs Docker with buildx. Building for the other architecture works
through QEMU (`docker run --privileged --rm tonistiigi/binfmt --install
arm64`) but is slow: about 25 minutes for arm64 on a 4-core x86 machine,
with the dependency layers already cached.
`packaging/Dockerfile` does the work in stages:

- **`airband-deps`**: Alpine with static libraries for everything
  rtl_airband links. speex, rtl-sdr-blog's librtlsdr and libmirisdr-4 have
  no static Alpine packages, so they're built from source at pinned
  versions.
- **`airband`**: builds the submodule (exported with `git archive`, so the
  fork's version script reports the tag), runs its unit tests, and checks
  the binary has no dynamic dependencies. The fork's CMake isn't changed;
  the static link comes from the cache variables in the Dockerfile, which
  explains each one. One source patch is applied:
  `packaging/airband-static-drivers.patch`. The fork finds its input
  drivers with `dlsym()`, which can't work in a static binary, so the patch
  falls back to the drivers linked in. If a fork bump makes the patch fail
  to apply, the build stops there.
- **`frontend`**, **`panel`**: the frontend, then the panel with it
  embedded, for the musl target.

Bundled rtl_airband has NFM, rdio-scanner, RTL-SDR and Mirics support;
PulseAudio and SoapySDR are off (they need a sound server or runtime
plugins, neither of which fits a static binary).

### Publishing

The Release workflow (`.github/workflows/release.yml`) builds both
architectures on GitHub's runners for every `v*` tag push and keeps the
tarballs as workflow artifacts. Nothing is published automatically. To
publish, run the workflow by hand (Actions → Release → Run workflow) with
the tag. That creates the GitHub release from the tarballs and their
`.sha256` files, with that version's CHANGELOG entry as the notes.

### Bumping the bundled fork

The submodule is always pinned to a fork release tag:

```bash
git -C vendor/RTLSDR-Airband fetch --tags
git -C vendor/RTLSDR-Airband checkout vX.Y.Z
git add vendor/RTLSDR-Airband
```

Commit that on its own, with the usual version bump and a CHANGELOG entry
naming the old and new fork versions. In the same pass, check the fork's
changes for:

- new config settings (they're kept as unknown settings until the panel
  models them);
- new CMake options or libraries (`packaging/Dockerfile`);
- changes to `src/input-common.cpp` (the static-drivers patch).

Then run `scripts/build-release.sh amd64` and check its unit tests pass.

## How it works

### Config files

- **Parsing.** `airband-config` tokenizes and parses libconfig into an AST
  that keeps each value's literal text and assignment operator, then maps
  it to the domain model. Float frequencies are MHz and integer ones Hz,
  following RTLSDR-Airband's `parse_anynum2int()`; the model stores Hz.
- **Writing.** Saves serialize the domain model back to a canonical layout
  (two-space indent, one setting per line) and replace the whole file
  atomically (temp file + rename), after copying the old one to
  `.backups/<name>/` (last 10 kept). Comments are not kept; that's a
  deliberate decision, and changing it is a parser change that needs
  round-trip tests.
- **Unknown settings.** Anything the domain model doesn't know is kept in
  `unknown_settings` (as AST) on the group it appeared in and written back
  verbatim, after the group's known scalar fields. The validator lists
  them as warnings (`unknown-setting-preserved`; `squelch` gets
  RTLSDR-Airband's own deprecation message).
- **Versions.** Each file's version (ETag) is a 16-hex-digit SHA-256 prefix
  of its text; saves with a stale `If-Match` are refused with 409.
- **Secrets.** Icecast passwords and rdio-scanner API keys are replaced by
  `••••••••` in every API response and restored from disk when a client
  sends the sentinel back. Restoration runs on the request JSON before
  decoding, pairing outputs by the frontend's `_matchIndex` hint (load-time
  position, `-1` for a duplicate), channels by frequency, mixers by name.

### Instances and systemd

- An instance is `<name>.conf` in the instances directory and `<name>.service`
  in systemd, basenames matching exactly. Names are `[A-Za-z0-9_-]{1,64}`,
  minus a few reserved words that would shadow API routes.
- Systemd access goes through the `UnitManager` trait
  (`crates/airband-supervisor/src/systemd.rs`): `MockUnits` (records calls,
  the default) or `SudoSystemctl`, which runs `sudo -n systemctl ...` and
  `sudo -n journalctl ...`. `-n` makes a missing sudoers rule fail cleanly
  instead of prompting.
- **The argv is pinned to the sudoers file.** sudo matches arguments
  literally, so `SudoSystemctl` issues exactly what
  [`deploy/rtl-airband-panel.sudoers`](./deploy/rtl-airband-panel.sudoers)
  allows, and the `argv_matches_sudoers_rules` test pins the two together.
  Change both or neither.
- **Prefix scoping.** With `RTL_PANEL_SUDO_UNIT_PREFIX` set, the adapter
  refuses in-process to touch any unit not named `<prefix>...service`, and
  the sudoers glob should match. A mismatch fails closed on one side or the
  other, never open.
- **Status batching.** Every `sudo` invocation writes its own PAM
  session-open/close and audit lines to syslog, so all units' status comes
  from one `systemctl show unit1 unit2 ... --timestamp=utc` call, not one
  per unit.
- Generated unit files (`unit_file.rs`) run `rtl_airband -F -e [-j] -c
  <conf>` with `Restart=no` (an exit means misconfiguration or device
  failure), and `User=`/`Group=` from the instance's options or
  `RTL_PANEL_DEFAULT_SERVICE_USER`/`_GROUP`.

### Live apply and the change preview

The fork's control socket (`AF_UNIX`, one JSON object per line, same-UID
peers only) accepts `reload_diff`, which re-reads the `.conf` and applies
what it can. `plan_change` (`crates/airband-supervisor/src/plan.rs`)
predicts the outcome before anything is written, by mirroring the fork's
`compute_and_apply_diff()`:

- Only non-disabled devices, channels and mixers count. Device or mixer
  count, driver type or mode changes need a restart.
- Channels are compared by the fork's identity signature: every setting
  except `enabled`, rendered in source order, with floats formatted as C++
  `%g` (6 significant digits). The longest common prefix stays; the tail is
  torn down and re-created, within the device's channel capacity (startup
  channel count + `reserve_channels`, from the config the process was
  *started* with). Integer `5006` and string `"5006"` are different
  signatures to the fork, so a canonicalizing save can re-create channels.
- `centerfreq` and `sample_rate` are compared as the fork parses them
  (float MHz truncated, not rounded, to Hz). `gain`, `bandwidth` and
  `correction` are re-applied whenever present.

It also classifies as restart-required what `reload_diff` drops without
reporting:

- **Changes outside its scope:** every global setting, a mixer's outputs
  and filters, device serial/buffers/`reserve_channels`, and so on.
- **Setters a driver doesn't implement** (ENOTSUP): mirisdr has no live
  gain, bandwidth or correction; soapysdr has no live correction and
  refuses live sample-rate changes.
- **Non-integer `correction`/`bandwidth`,** which `reload_diff` reads with
  the frequency rule and would apply a million times too large.
- **Edits smaller than the `%g` signature can see.**

Values rtl_airband reads identically (`dest_port` as int or string) are
treated as equal outside channel signatures.

**Baselines.** `.running/<name>.started.conf` and `.applied.conf` record
what the process loaded at its last (re)start and after its last complete
live apply. The panel writes them on start/restart/create/rename, and on
the first overwrite of an instance with no record if nothing was pending
(the replaced file is then the best evidence of what's running).

**Pending restart** is set when a file is written, and cleared by a
restart, or by a live apply only when `reload_diff` skipped nothing *and*
the plan found nothing restart-only.

### Stats

RTLSDR-Airband rewrites its `stats_filepath` (Prometheus text format)
every `stats_update_interval` seconds (default 15), so the file only holds
the latest snapshot. The panel polls each instance on
`RTL_PANEL_STATS_POLL_INTERVAL_MS`:

- **Source.** It reads the fork's `stats_http_address:port` endpoint when
  set (no file permissions needed), otherwise the file.
- **Change detection.** A file whose mtime hasn't changed is skipped, so a
  stopped instance doesn't add duplicate rows.
- **Limits.** 5 MB size cap and 5 s timeout per read: `stats_filepath` comes
  from the config unchecked.

Samples go into SQLite (`stats_db.rs`), in the same schema the TypeScript
backend used:
- **Tables.** `series(id, instance, metric, labels)` interns each series
  once (labels as sorted-key JSON); `samples(series_id, value, ts)` holds
  the values.
- **Relabeled channels keep their history.** When a channel's label is
  added or edited, its exact label set changes. If exactly one series at
  the same frequency stopped reporting, the new label set takes over that
  series instead of starting a new one.
- **Pruning** deletes samples older than the retention window and
  orphaned series, on its own interval, followed by an incremental vacuum.

### Hardware page

`crates/panel/src/hardware.rs` builds one `HardwareSnapshot` across all
instances.

Each instance's config gives the device list: non-disabled devices and
channels, indexed the way rtl_airband indexes them. Where the instance has
`control_socket_path`, the panel queries the fork's read-only `status`
command (v6.4.0+, `ControlSocketClient::status`, timeout capped at 2 s)
and overlays the live readings.

Derived figures:
- **Headroom** is `-peak_dbfs`.
- **Noise floor** is the median of the enabled, tuned frequencies' noise.
- **Frequency error** is the median ppm (`freq_offset_hz / freq`) over
  frequencies that have had a transmission.
- **Suggested correction** is `correction - error`, rounded. It's only
  given for ppm drivers; mirisdr's correction is in Hz.
- **Counter rates** come from the previous snapshot, kept per instance and
  device. A counter that goes backwards (restart) gives no rate.

Instances that aren't live keep their config view, and carry a `reason`:
`no-control-socket`, `not-running`, `unsupported` (older binary),
`unreachable`, `protocol-error` or `config-error`.

The frontend page (`pages/HardwarePage.tsx`) opens its own `/api/ws`
connection and subscribes. It falls back to polling `GET /api/hardware`
every 2 s, and keeps a 5-minute client-side history for the sparklines.

How the fork measures:
- **ADC peak.** The largest |I|/|Q| over the last ~1 s of input, relative
  to full scale.
- **Carrier offset.** The power-weighted phase increment of each channel's
  FFT bin output while squelch is open, minus the rotation of a carrier
  exactly on frequency.

The offset estimate reads AM signals slightly low: the window weights the
sidebands unevenly. At 2+ Msps that's about 3%. At very low sample rates
(narrow FFT bins, e.g. 240 kHz) it can be 25%. Details are in the fork's
CLAUDE.md, item 43.

### HTTP API and live updates

The REST API is what the TypeScript backend served (same routes, shapes
and status codes; see `crates/panel/src/http/mod.rs`), plus:
- `POST /api/instances/:name/plan`;
- a `plan` field on save and apply-live results;
- `frequencies` on each instance in the list;
- `GET /api/hardware` (a `HardwareSnapshot`, see below).

Errors are `{ error }` with 400/404/409/422 (with `errors`)/502 (failed
systemd command, with `exitCode` and `stderr`).

`/api/ws` sends `hello`, then:
- `health` snapshots whenever a unit's status changes (checked every 5 s
  while anyone is connected);
- `instance-changed` after any mutation;
- `hardware` (a `HardwareSnapshot`) every `RTL_PANEL_HARDWARE_POLL_INTERVAL_MS`,
  only to clients that sent `{"type":"subscribe","topic":"hardware"}`. The
  watcher sends no control-socket traffic while nobody is subscribed. A new
  subscriber gets a frame right away.

A client that falls behind is disconnected, so it reconnects to fresh
state. The frontend merges `health` in place, refetches on
`instance-changed`, and falls back to 20 s polling without the socket.

Logs stream over SSE (`/api/instances/:name/logs/stream`, `journalctl -f`
underneath, a `: ping` comment every 15 s, a named `stream-error` event
on failure). Responses are gzip/brotli-compressed, except the SSE stream.

### Security

- **Auth.** Optional HTTP Basic auth, required when bound to a non-loopback
  address unless `--allow-unauthenticated`. `/api/health` is exempt.
- **Origin check.** State-changing requests and WebSocket upgrades must
  have no `Origin` or one matching `Host`.
- **DNS-rebinding guard.** A loopback-bound panel only answers loopback
  `Host` names plus `RTL_PANEL_ALLOWED_HOSTS`.
- **Rate limits** per client IP: 300/min overall, 60/min per mutating
  route.
- **Security headers.** helmet-equivalent, minus HSTS and
  upgrade-insecure-requests (plain-HTTP LANs), with `'wasm-unsafe-eval'`
  for the browser validator.
- **Request IDs.** Every response carries an `x-request-id`, which also
  tags the audit log line for mutating actions.

## Panel state files

All under the instances directory:

| File | Purpose |
|---|---|
| `<name>.conf` | The instance's config |
| `.backups/<name>/` | Previous versions, last 10 |
| `.pending-restarts.json` | Instances whose saved config isn't running yet |
| `.instance-options.json` | Per-instance panel settings: JSON logging, service user/group |
| `.running/<name>.{started,applied}.conf` | Live-apply baselines (above) |

The first three files have the same format the TypeScript backend used.

## Constraints and priorities

The hard rules are in [CLAUDE.md](./CLAUDE.md). The ones that shape most
changes:

- RTLSDR-Airband parses its config once at startup into fixed-size arrays.
  Only what `reload_diff` applies can change live; `plan_change` must
  classify everything else, including what `reload_diff` silently ignores,
  as restart-required. The panel never sends SIGHUP.
- FFT bin assignment depends on a device's `centerfreq`, `correction` and
  `sample_rate`; moving one channel can affect bin occupancy for the whole
  device.
- One systemd unit per instance, and a write only ever restarts that one.
- Every write fails closed: nothing touches disk or systemd until
  validation passes.

In priority order:
1. Parser/serializer round-trip fidelity (`airband-config`), the
   highest-risk component.
2. Semantic validation (`airband-validate`).
3. API and supervision (`panel`, `airband-supervisor`).
4. The frontend, which renders the JSON model and never touches libconfig.

## Tests worth knowing about

- `crates/airband-config/tests/parity.rs` and
  `crates/airband-validate/tests/parity.rs` replay the old TypeScript
  implementation's output for 115 inputs (`tests/golden/`, recorded before
  it was removed in v0.4.111). They're frozen: don't regenerate them, and
  add new cases as ordinary tests.
- `crates/airband-supervisor/tests/plan.rs` covers the live-apply
  prediction scenario by scenario.
- `crates/panel/tests/api.rs` drives the router end to end: auth, guards,
  plans and baselines against a fake control socket, the WebSocket.
- Every parser change needs a fixture-based round-trip test. Fixtures in
  [`fixtures/`](./fixtures) must be sanitized (no real hostnames,
  mountpoints or credentials).
- UI changes are checked with screenshots in a real (headless) browser,
  not just a type check.
