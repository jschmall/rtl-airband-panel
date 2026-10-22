# rtl-airband-panel

## What this is
A web control panel for RTLSDR-Airband instances. Each SDR runs as its
own systemd-managed rtl_airband process with its own .conf file
(one-service-per-instance). The panel reads/writes those config files
through a JSON intermediate model and either live-applies the change over
the instance's control socket or restarts only the affected systemd unit.

## Direction: bundled fork, not vanilla RTLSDR-Airband
The panel is moving away from supporting arbitrary/vanilla RTLSDR-Airband
builds. It ships with — and is developed against — a pinned build of the
jschmall/RTLSDR-Airband fork (github.com/jschmall/RTLSDR-Airband), which
itself tracks upstream rtl-airband/RTLSDR-Airband via periodic merges.
- Instances run the bundled `rtl_airband` binary. The panel verifies this
  via `rtl_airband -v` (prints a `git describe` version) rather than
  assuming it.
- Fork-only config features (control_socket_path / live reload,
  reserve_channels / reserve_inputs, rdio_scanner, mixer_remote,
  send_tx_tags, stats_http, `-j` JSON logging) are first-class, not
  optional extras.
- New firmware-side features land in the fork first, then the panel adds
  config support. When the fork changes, the panel's pinned fork ref is
  bumped in a single, dedicated commit (procedure to be documented once the
  `airband-bundle` branch lands — fork is planned as a git submodule at
  `vendor/RTLSDR-Airband`).
- End goal: a release tarball per architecture containing the panel binary,
  a static `rtl_airband` binary, and an `install.sh`.

## Architecture constraints (do not violate)
- RTLSDR-Airband config is parsed once at process startup into
  fixed-size arrays (devices, channels, FFT bins). The fork's control
  socket (`reload_diff`, retune, set_gain, etc.) can apply a subset of
  changes in-process; anything it reports under
  `skipped_requires_restart` (device/mixer count, driver, mode changes,
  channels beyond `reserve_channels`) still needs a restart of that
  instance's systemd unit.
- Live apply via the control socket is the preferred path when a tested
  decision function says a change is live-applicable; otherwise fall back
  to restarting that one unit. Never send SIGHUP (the fork's re-exec
  reload is superseded by the control socket and is not used by the
  panel).
- The control socket enforces same-UID peer credentials, so generated
  instance units must run as the same user as the panel (`User=`/`Group=`).
- FFT bin assignment is a function of a device's centerfreq,
  correction, and sample_rate. Adding/moving a channel can require
  recomputing bin occupancy for the whole device, not just one entry
  — validate this before treating any change as "cheap."
- One systemd unit per SDR instance. A config write must only ever
  restart the one unit it modifies — never a global restart.
- libconfig++ does not preserve comments through parse/serialize. The
  panel's parser keeps each value's raw text and assignment operator, but
  regenerates the whole file on write and drops comments — this is a
  deliberate decision; changing it is a parser change and needs fixture
  round-trip tests.
- The rtl_airband fork is a monolithic executable with global state; it is
  never linked into the panel. The panel controls it only from outside
  (systemd, control socket, stats file/HTTP, journal).

## Rust rewrite (in progress on the `rust` branch)
The panel is being rebuilt in Rust; the TypeScript backend on `master`
remains the shipping version until the `rust` branch reaches parity and is
merged. Planned layout (Cargo workspace at repo root):
- `crates/airband-config` — libconfig tokenizer/parser/AST, domain model,
  serializer (port of backend/parser). Must match TS serializer output
  byte-for-byte on fixtures before anything else is built on it.
- `crates/airband-validate` — semantic checks (port of backend/validate),
  also compiled to wasm so the frontend preview equals the backend verdict.
- `crates/airband-supervisor` — systemd unit management behind a trait,
  control-socket client, stats poller, journal follow, live-vs-restart
  decision function.
- `crates/panel` — axum binary: REST + single `/api/ws` hub, SQLite stats,
  auth, embedded frontend (rust-embed).
- `frontend/` stays React + TypeScript (types generated from Rust via
  ts-rs), restyled.
Design reference: TrunkRecorder/trunk-recorder-pro (GPL-3) — borrow
patterns, never copy code.

## Branches
- `master` — shipping version.
- `rust` — long-lived Rust rewrite; merged to master at parity.
- `airband-bundle` — fork bundling, static build, release workflow,
  install script; started after `rust` merges.
Confirm which branch new work targets before the first commit.

## Priorities, in order
1. Parser/serializer round-trip fidelity against real fixture files
   (backend/parser; crates/airband-config on the rust branch) — this is
   the highest-risk component; nothing else matters if this silently
   corrupts a config.
2. Semantic validation (backend/validate; crates/airband-validate) —
   frequency-in-window, bin-separation/collision checks, valid CTCSS/tone
   values.
3. API layer (backend/api; crates/panel + crates/airband-supervisor) —
   config CRUD + live apply / systemd restart + health check, fails closed
   on any validation error.
4. Frontend — renders the JSON model, never talks to libconfig
   directly.

## Conventions
- Config fixtures in fixtures/ should be sanitized (no real
  server/mountpoint credentials) before committing.
- Every parser change needs a fixture-based round-trip test before
  it's considered done.
- Every commit bumps the version — package.json (root + all workspaces)
  and, on the rust branch, every Cargo.toml move in lockstep by one patch
  version on every commit, no exceptions for "small" changes. Never commit
  without bumping.
- Version tags are a single global namespace across all branches. Before
  every bump on any branch, check the highest existing tag
  (`git tag --sort=-v:refname | head -1`) and use the next free number, not
  just current-branch-version + 1. A merge into master gets its own fresh
  version.
- Every version bump requires a matching CHANGELOG.md entry in the same
  commit — never bump versions without adding an entry above the previous
  one, following the existing format (## [X.Y.Z] - date,
  Added/Changed/Fixed subsections). A version bump with no changelog entry
  is an incomplete change, not a shortcut.
- Every commit that bumps the version also gets a matching `vX.Y.Z` git
  tag, pushed alongside the commit — tags are the versioning source of
  truth per the project's docs, so a bump without a tag silently breaks
  that.
