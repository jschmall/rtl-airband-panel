# Contributing

Thanks for taking a look at rtl-airband-panel. This file covers what you need
to know to make a change; see [README.md](./README.md) for building and
running it, and [CLAUDE.md](./CLAUDE.md) for the fuller set of conventions
(originally written as agent instructions, but equally applicable to a human
making the same kind of change).

## Getting set up

Install the build tools from [Installing](./README.md#installing) (Rust,
a C compiler, Node 20+), then:

```bash
npm ci
cargo test --workspace          # Rust crates (also regenerates frontend/src/generated)
npm test --workspace=frontend   # frontend unit tests
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

Nothing in the test suite touches real systemd or a real instances
directory: the Rust tests use a mock unit manager, temp directories, and
fake control-socket/stats servers. Frontend tests use Vitest + React Testing
Library in jsdom (`frontend/test/`, mirroring `frontend/src/`). `tsc
--noEmit`, via `npm run build --workspace=frontend`, catches what the tests
don't.

### Running the frontend with hot reload

```bash
# terminal 1: the panel, in mock mode, against some configs
cargo run -p rtl-airband-panel -- --instances-dir fixtures

# terminal 2: the frontend, with hot reload
npm run dev --workspace=frontend
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*`
(including the `/api/ws` WebSocket) to the panel at `http://127.0.0.1:3000`
(override with `VITE_API_PROXY_TARGET`). Point `--instances-dir` at a copy
if you plan to save; the panel writes the `.conf` files there.

To see a built frontend without rebuilding the binary, pass
`--frontend-dist frontend/dist`. Release builds embed `frontend/dist` at
compile time, so build the frontend before `cargo build --release`.

## How the pieces fit together

A Cargo workspace plus one npm workspace:

| Part | What it does |
|---|---|
| [`crates/airband-config`](./crates/airband-config) | Hand-rolled libconfig tokenizer/parser/serializer and the JSON domain model (`devices` → `channels` → `outputs`, `mixers`). Settings it doesn't model are kept verbatim. |
| [`crates/airband-validate`](./crates/airband-validate) | Semantic checks on the domain model, grounded in RTLSDR-Airband's own source: frequency window, FFT bin collisions, CTCSS tones, per-output-type and startup constraints, split-file settings. |
| [`crates/airband-supervisor`](./crates/airband-supervisor) | Everything that talks to RTLSDR-Airband from outside the process: systemd units (sudo or mock), the fork's control socket, stats, journal logs, unit files, and `plan_change`, the live-apply-vs-restart prediction. |
| [`crates/panel`](./crates/panel) | The `rtl-airband-panel` binary: axum HTTP API, `/api/ws` push channel, SQLite stats history, auth and request guards, the instance service, the embedded frontend. Fails closed: a write that fails validation never touches disk or systemd. |
| [`crates/airband-wasm`](./crates/airband-wasm) | `airband-validate` compiled to WebAssembly for live validation in the editor. |
| [`frontend`](./frontend) | React + Vite + Tailwind UI. Its config/validation types and constants are generated from the Rust crates into `frontend/src/generated`. |

```
.conf file  <──parse/serialize──>  domain model  <──validate──>  {errors, warnings}
                                        │                    (also in the browser via wasm)
                 panel: CRUD, systemd, control socket, stats, plan, serves frontend
                                        │
                                frontend (React UI)
```

### Generated files

- **TypeScript types** (`frontend/src/generated/*.ts`): written by
  `cargo test` from the `#[derive(TS)]` types (ts-rs). Commit the
  regenerated files with the Rust change that caused them; CI fails on
  drift. The UI imports them through `frontend/src/types/config.ts`.
- **Browser validator** (`frontend/src/generated/wasm`): rebuild with
  `scripts/build-wasm.sh` after any change to validation. It needs
  `rustup target add wasm32-unknown-unknown` and
  `cargo install wasm-bindgen-cli --version 0.2.129 --locked`.

Never hand-edit anything under `frontend/src/generated`.

## Architecture constraints (please read before touching config/validate/supervisor)

- RTLSDR-Airband parses its config once at startup into fixed-size arrays.
  The fork's control socket can apply a subset of changes live
  (`reload_diff`); everything else needs a restart of that instance's unit.
  `plan_change` must classify anything `reload_diff` doesn't apply, including
  what it silently ignores, as restart-required. Never send SIGHUP.
- FFT bin assignment is a function of a device's `centerfreq`, `correction`,
  and `sample_rate`. Adding or moving a channel can require recomputing bin
  occupancy for the whole device, not just the one entry you touched.
- One systemd unit per SDR instance. A config write must only ever restart
  the one unit it modifies, never a global restart.
- Comments in a `.conf` file are not kept: every save rewrites the whole
  file canonically (raw literal text of each value is kept). Changing that
  is a parser change and needs round-trip tests.

## What to prioritize, in order

1. **Parser/serializer round-trip fidelity** (`crates/airband-config`), the
   highest-risk component. A config that silently loses or corrupts data on
   a round trip is worse than almost any other bug here, since it can
   happen on a save nobody reviews byte for byte.
2. **Semantic validation** (`crates/airband-validate`).
3. **API and supervision** (`crates/panel`, `crates/airband-supervisor`):
   config CRUD, systemd, live apply, health. Fails closed on any validation
   error.
4. **Frontend**: renders the JSON model; never talks to libconfig directly.

## Testing expectations

- Every parser change needs a fixture-based round-trip test before it's
  considered done, not just a unit test on the field you changed.
- `crates/*/tests/golden/` hold the old TypeScript implementation's output
  for 115 inputs, recorded before it was removed (v0.4.110). They're frozen
  regression tests: don't regenerate them, and add new cases as ordinary
  tests.
- Config fixtures under [`fixtures/`](./fixtures) must be sanitized (no real
  server hostnames, mountpoints, or credentials) before being committed.
- Screenshot UI changes in a real browser before committing them, rather
  than relying on a type check.
- If you find a real bug while writing a test for something else, fix it in
  the same change and say so in the commit message.

## Versioning and the changelog

Every commit bumps the version: the root and `frontend` `package.json` and
the workspace `Cargo.toml` move in lockstep by one patch version, tagged
`vX.Y.Z`. **Every version bump needs a matching
[CHANGELOG.md](./CHANGELOG.md) entry in the same change.** Follow the
existing format (`## [X.Y.Z] - date` with `Added`/`Changed`/`Fixed`
subsections).

## Submitting a change

- Open a pull request against `master`. Small, focused PRs are easier to
  review than one that bundles several unrelated changes.
- Describe *why*, not just *what*: the architecture constraints above mean a
  change that looks obviously correct in isolation can still be wrong for a
  reason that isn't visible in the diff.
- Make sure the commands under [Getting set up](#getting-set-up) pass.
