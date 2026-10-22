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
- New instances run the bundled `rtl_airband` binary (install.sh points
  `RTL_PANEL_RTL_AIRBAND_BIN` at it); existing instances keep whatever
  their unit's `ExecStart` runs. Never assume which build a unit runs:
  `rtl_airband -v` (`airband_supervisor::binary_version`) is how to find
  out. That check isn't surfaced in the panel yet.
- Fork-only config features (control_socket_path / live reload,
  reserve_channels / reserve_inputs, rdio_scanner, mixer_remote,
  send_tx_tags, stats_http, `-j` JSON logging) are first-class, not
  optional extras.
- New firmware-side features land in the fork first, then the panel adds
  config support. The fork is a git submodule at `vendor/RTLSDR-Airband`,
  pinned to a fork release tag (never a bare commit: the release names the
  rtl_airband version it ships, taken from the tag). Bumping the pin is its
  own commit: `git -C vendor/RTLSDR-Airband fetch --tags && git -C
  vendor/RTLSDR-Airband checkout vX.Y.Z && git add vendor/RTLSDR-Airband`,
  plus the usual version bump and a CHANGELOG entry naming the old and new
  fork versions. Check the fork's diff for new config keys (they survive as
  `unknown_settings` until modeled) and new CMake options/dependencies
  (packaging/Dockerfile) in the same pass.
- Releases: a tarball per architecture (amd64, arm64) with the static panel
  binary, a static `rtl_airband` built from the pinned fork, and
  `install.sh` (`scripts/build-release.sh`, `packaging/`, the Release
  workflow). Bundled builds have PulseAudio and SoapySDR off (runtime
  plugins/sound server); people who need those build rtl_airband themselves
  and point `RTL_PANEL_RTL_AIRBAND_BIN` at it.

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

## Layout
A Rust Cargo workspace (the panel) plus the React frontend. The TypeScript
backend (`backend/parser`, `backend/validate`, `backend/api`) was replaced
and removed in v0.4.111; its output for 115 inputs survives as frozen
golden files under `crates/*/tests/golden/` (never regenerate them; add new
cases as ordinary tests).
- `crates/airband-config` — libconfig tokenizer/parser/AST, domain model,
  serializer. Settings the model doesn't know are kept verbatim
  (`unknown_settings`), never dropped.
- `crates/airband-validate` — semantic checks; also compiled to wasm.
- `crates/airband-supervisor` — systemd units behind the `UnitManager`
  trait (sudo + mock), control-socket client, stats reader, journal, unit
  files, and `plan_change` (live-apply vs restart prediction, mirroring the
  fork's `reload_diff`, including what it silently ignores).
- `crates/panel` — the `rtl-airband-panel` binary: axum REST + `/api/ws`,
  SQLite stats, Basic auth + Origin/Host guards, embedded frontend
  (rust-embed; build the frontend before `cargo build --release`).
- `crates/airband-wasm` — the validator for the browser.
- `frontend/` — React + TypeScript. Its config/validation types and
  constants are generated from Rust into `frontend/src/generated` by
  `cargo test` (ts-rs; re-exported for the UI by
  `frontend/src/types/config.ts`) -- never hand-edit them, and commit the
  regenerated files with the Rust change that caused them (CI fails on
  drift). Rebuild `frontend/src/generated/wasm` with
  `scripts/build-wasm.sh` after any validation change.
- The sudo `UnitManager` issues exactly the argv
  `deploy/rtl-airband-panel.sudoers` allows (sudo matches literally); a
  test pins them together. Change both or neither.
Design reference: TrunkRecorder/trunk-recorder-pro (GPL-3) — borrow
patterns, never copy code.

## Branches
- `master` — shipping version.
- `airband-bundle` — fork bundling, static build, release workflow,
  install script (next).
Confirm which branch new work targets before the first commit.

## Priorities, in order
1. Parser/serializer round-trip fidelity against real fixture files
   (crates/airband-config) — this is the highest-risk component; nothing
   else matters if this silently corrupts a config.
2. Semantic validation (crates/airband-validate) — frequency-in-window,
   bin-separation/collision checks, valid CTCSS/tone values.
3. API layer (crates/panel + crates/airband-supervisor) — config CRUD +
   live apply / systemd restart + health check, fails closed on any
   validation error.
4. Frontend — renders the JSON model, never talks to libconfig
   directly.

## Conventions
- Config fixtures in fixtures/ should be sanitized (no real
  server/mountpoint credentials) before committing.
- Every parser change needs a fixture-based round-trip test before
  it's considered done.
- Screenshot UI changes in a real (headless) browser before committing.
- Every commit bumps the version — package.json (root + frontend) and the
  workspace Cargo.toml (`[workspace.package] version`) move in lockstep by
  one patch version on every commit, no exceptions for "small" changes.
  Never commit without bumping.
- Version tags are a single global namespace across all branches. Before
  every bump on any branch, check the highest existing tag
  (`git tag --sort=-v:refname | head -1`) and use the next free number, not
  just current-branch-version + 1. A merge into master gets its own fresh
  version.
- Every version bump requires a matching CHANGELOG.md entry in the same
  commit — never bump versions (package.json + Cargo.toml) without adding an
  entry above the previous one, following the existing format (## [X.Y.Z] - date,
  Added/Changed/Fixed subsections). A version bump with no changelog entry
  is an incomplete change, not a shortcut.
- Every commit that bumps the version also gets a matching `vX.Y.Z` git
  tag, pushed alongside the commit — tags are the versioning source of
  truth per the project's docs, so a bump without a tag silently breaks
  that.
