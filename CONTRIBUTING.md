# Contributing

Thanks for taking a look at rtl-airband-panel.

- [DEVELOPMENT.md](./DEVELOPMENT.md) covers building, testing, the code
  layout and how the important parts work. Read its "Constraints and
  priorities" section before changing the parser, validator or supervisor.
- [CLAUDE.md](./CLAUDE.md) holds the project's hard rules (originally
  written as agent instructions, equally binding for humans).

## Before you open a pull request

- Run the checks from [DEVELOPMENT.md](./DEVELOPMENT.md#building-and-testing):
  `cargo test --workspace`, `npm test --workspace=frontend`, clippy and
  rustfmt.
- Commit regenerated files with the change that caused them:
  `frontend/src/generated` (from `cargo test`), and
  `frontend/src/generated/wasm` (`scripts/build-wasm.sh`) if you changed
  validation.
- Parser changes need a fixture-based round-trip test. Fixtures must be
  sanitized (no real hostnames, mountpoints or credentials).
- UI changes: include a screenshot.
- If you find a real bug while working on something else, fix it in the
  same change and say so in the description.

## Versioning and the changelog

Every commit bumps the version: the root and `frontend` `package.json` and
the workspace `Cargo.toml` move together by one patch version, tagged
`vX.Y.Z`. Every bump needs a matching [CHANGELOG.md](./CHANGELOG.md) entry
in the same commit, in the existing format (`## [X.Y.Z] - date` with
`Added`/`Changed`/`Fixed` subsections).

## Submitting

- Open a pull request against `master`. Small, focused changes are easier
  to review than ones that bundle several unrelated things.
- Describe *why*, not just *what*. The constraints in DEVELOPMENT.md mean a
  change that looks obviously correct in isolation can still be wrong for a
  reason that isn't visible in the diff.
