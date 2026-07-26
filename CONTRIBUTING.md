# Contributing

Thanks for taking a look at rtl-airband-panel. This file covers what you need
to know to make a change; see [README.md](./README.md) for install/run
instructions and [CLAUDE.md](./CLAUDE.md) for the fuller set of conventions
(originally written as agent instructions, but equally applicable to a human
making the same kind of change).

## Getting set up

Follow the [Prerequisites](./README.md#prerequisites) and
[Install](./README.md#install) sections of the README. After that:

```bash
npm run build:deps   # required before the first run, and after every git pull
npm test --workspace=backend/parser
npm test --workspace=backend/validate
npm test --workspace=backend/api
npm test --workspace=frontend
```

Frontend tests use Vitest + React Testing Library (`frontend/test/`, mirroring
the `frontend/src/` structure it covers) and run in a jsdom environment —
coverage is still thin, so growing it as you touch a component is welcome,
not just required for new ones. `tsc --noEmit` via
`npm run build --workspace=frontend` catches everything the test suite
doesn't yet.

## How the pieces fit together

See [How it's built](./README.md#how-its-built) in the README for the
package layout and data flow. The short version: `.conf` file <-> JSON model
(`backend/parser`) <-> semantic validation (`backend/validate`) <-> HTTP API
+ systemd control (`backend/api`) <-> React UI (`frontend`).

## Architecture constraints (please read before touching parser/validate/api)

- RTLSDR-Airband parses its config once at process startup into fixed-size
  arrays. There is no in-process reload path upstream. Any config change
  requires restarting that instance's systemd unit — never assume a signal
  or socket-based reload exists.
- FFT bin assignment is a function of a device's `centerfreq`, `correction`,
  and `sample_rate`. Adding or moving a channel can require recomputing bin
  occupancy for the whole device, not just the one entry you touched.
- One systemd unit per SDR instance. A config write must only ever restart
  the one unit it modifies — never a global restart.
- `libconfig++` does not preserve comments through a parse/serialize
  round-trip. If you're changing what gets written for a field, think about
  whether that's acceptable before assuming a targeted text patch is needed
  instead of a full regenerate.

## What to prioritize, in order

1. **Parser/serializer round-trip fidelity** (`backend/parser`) — this is the
   highest-risk component. A config that silently loses or corrupts data on
   a round-trip is worse than almost any other bug in this repo, since it
   can happen invisibly on a save the user never reviews byte-for-byte.
2. **Semantic validation** (`backend/validate`) — frequency-in-window,
   FFT bin collisions, CTCSS tone validity.
3. **API layer** (`backend/api`) — config CRUD, systemd restart, health
   checks. Fails closed on any validation error: a write that doesn't pass
   validation must never touch disk or systemd.
4. **Frontend** — renders the JSON model; never talks to libconfig directly.

## Testing expectations

- Every parser change needs a fixture-based round-trip test before it's
  considered done — not just a unit test on the specific field you changed.
- Config fixtures under [`fixtures/`](./fixtures) must be sanitized (no real
  server hostnames, mountpoints, or credentials) before being committed.
- If you find a real bug while writing a test for something else (this
  happens more than you'd expect in this codebase — see the CHANGELOG for
  examples), fix it in the same change and say so in the commit message,
  rather than filing it separately and moving on.

## Versioning and the changelog

Workspace packages (root + all 4 packages under `backend/`/`frontend`)
version in lockstep, tagged `vX.Y.Z` on `master`. **Every version bump needs
a matching [CHANGELOG.md](./CHANGELOG.md) entry in the same change** —
follow the existing format (`## [X.Y.Z] - date` with `Added`/`Changed`/
`Fixed` subsections). A version bump with no changelog entry is treated as
an incomplete change, not a shortcut.

## Submitting a change

- Open a pull request against `master`. Small, focused PRs are easier to
  review than one that bundles several unrelated changes.
- Describe *why*, not just *what* — the architecture constraints above mean
  a change that looks obviously correct in isolation can still be wrong for
  a reason that isn't visible in the diff.
- Make sure `npm run build` and the backend test suites pass before opening
  the PR.
