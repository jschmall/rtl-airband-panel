# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project doesn't publish to a registry, so versions are tracked via git tags
(`vX.Y.Z`) rather than npm releases. Versions before 0.3.0 predate this file.

## [0.4.21] - 2026-07-26

Seventh batch from the full-system design review: accessibility
(Section G).

### Added

- `Collapsible` (used for nearly every device/channel/output/mixer)
  gained `aria-controls`, alongside the `aria-expanded` it already had.
- Every text/number/select input now has a visible focus ring, not just
  a subtle border-color change (which was the only indicator once
  `focus:outline-none` had removed the browser default).
- New `Tooltip` component replaces bare `title=` attributes throughout
  the app (field labels, checkbox labels, stat tiles, chart titles):
  shows on keyboard focus as well as mouse hover, is dismissible with
  Escape, and associates its text via `aria-describedby` + `role="tooltip"`
  so it's actually announced by a screen reader instead of silently
  skipped, the way a native `title` usually is.
- The pending-restart popover now sets `aria-haspopup`/`aria-expanded`
  on its trigger and `role="dialog"` on the panel, closes on Escape, and
  returns focus to the trigger when it does (previously: click-outside
  only, and closing lost your keyboard focus position entirely).

### Changed

- Raised low-contrast helper text to meet WCAG AA (4.5:1): field/checkbox
  labels (`text-slate-400` → `text-slate-300`, needed since some of those
  labels sit on the lighter `bg-slate-700` output-card background, where
  `slate-400` only reached ~4.0:1) and a handful of `text-slate-500`
  instances (stat tile sublabels, the channel-list filter count, the
  empty-chart message) bumped to `text-slate-400`.

## [0.4.20] - 2026-07-26

Sixth batch from the full-system design review: real-time feedback
(Section F).

### Fixed

- **Stats history no longer gets orphaned when a channel's label is
  added, changed, or removed.** RTLSDR-Airband's own Prometheus output
  only includes `label` once a channel has one set (`print_channel_metric`
  in output.cpp) -- its metric labels are just `freq` and, optionally,
  `label`. Editing a channel's label therefore changes its exact label
  set even though it's the same channel, and the stats store previously
  keyed history by that exact set, silently orphaning the old series.
  `StatsStore` now recognizes this as a continuation and carries the old
  series' history forward, but only when there's exactly one same-
  frequency series not reporting in the same poll batch -- more than one
  candidate means two channels share that frequency (RTLSDR-Airband
  doesn't put CTCSS or anything else in the metric labels to tell them
  apart), and guessing which one changed risks silently merging two
  different channels' history, so that case is deliberately left alone.
  Frequency changes are not tracked this way either, for the same reason:
  frequency is this fix's matching key, not a stable identity on its own.

### Added

- Instance list (sidebar dots, header pending-restart count) and each
  instance's health badge now poll in the background every 20s, matching
  the stats page's existing cadence, instead of only refreshing on
  in-app navigation.
- The stats history chart now refreshes on that same interval as the
  stat tiles above it, instead of only reloading when the selected
  instance/channel/time-range changed. (Found and fixed a real infinite-
  loop bug while wiring this up -- see below.)
- Restarting an instance (from the sidebar, or Save-and-restart on the
  edit page) now keeps polling health for a few seconds after the
  restart command returns, so the health badge shows the real
  activating -> active/failed transition instead of freezing on
  whatever snapshot the initial request happened to catch. The sidebar's
  Restart button also now reads "Restarting…" for the duration.

### Fixed (found while implementing the above)

- The stats chart's refresh effect closed over `selectedChannel`, a
  fresh object every time the stat tiles' data reloaded (even when it
  was still "the same" channel) -- making that effect depend on it
  directly, as the chart-refresh work above initially did, tore down and
  recreated the polling interval on every single tick, which re-fired
  the tile fetch, which changed `selectedChannel` again, in a tight loop
  (~130 requests/sec in local testing). Fixed by keeping the interval's
  own lifecycle keyed only on the selected instance, and reaching the
  current history-loader through a ref instead of a dependency.

## [0.4.19] - 2026-07-26

Two fixes from prod testing of v0.4.18's Section E changes.

### Added

- **Reveal-real-secret on "Show".** Clicking "Show" on the Icecast password
  or rdio-scanner API key now fetches and loads the *real* value from a new
  `GET /instances/:name/secrets` endpoint, instead of just toggling the
  input type on the server's fixed-length redaction placeholder (which
  made the masked view always show exactly 8 dots regardless of the real
  secret's length, and "revealed" view show the literal placeholder
  string). The new endpoint is deliberately separate from the main GET
  (which still always redacts) and only ever called on an explicit click;
  it's audit-logged like the other config-mutating actions. If the field
  hasn't been revealed, Show/Hide is unaffected and stays a plain,
  no-fetch toggle.

### Changed

- The channel search/filter box (added in v0.4.18) now always shows,
  instead of only once a device passed 5 channels.

### Fixed

- **Output type-switch remount bug**, found while testing the above:
  switching an output's type to one not yet visited this session called a
  `default*Output()` constructor, which mints a fresh identity key. That
  changed the key React sees for that list slot, so it tore the
  `OutputEditor` down and remounted it -- silently resetting the
  Collapsible's open state and, more importantly, wiping the very
  `lastByType` "remember values per type" cache this component depends on
  (the fix shipped several versions ago for the original data-loss
  report). Fixed by carrying the slot's existing identity key over onto
  the replacement value (`withSameUiKey` in `lib/keys.ts`) so a type
  switch never changes which list item React thinks it's looking at.

## [0.4.18] - 2026-07-26

Fifth batch from the full-system design review: frontend UX / creature
comforts (Section E).

### Added

- **Unsaved-changes warning.** Editing a config now sets a shared dirty
  flag; navigating away via the sidebar, header logo, or the "View stats"
  link asks for confirmation before discarding edits, and closing/
  refreshing the tab triggers the browser's own native prompt. Doesn't
  cover browser back/forward, which would need a bigger react-router
  data-router migration.
- **Duplicate/clone buttons** for devices, channels, outputs, and mixers.
  Mixer duplication blanks the copy's name (mixer names are referenced by
  exact match from channel outputs, so a raw clone would create an
  ambiguous duplicate).
- **Password show/hide toggle** for the Icecast password and rdio-scanner
  API key fields.
- **Ctrl/Cmd+S** saves without restarting (the less disruptive of the two
  actions). Save-and-restart stays a deliberate button click, since it
  interrupts live audio and already has its own confirm dialog.
- **Validation errors/warnings now show a human-readable path** (e.g.
  "Device 1 (rtlsdr, 151.780 MHz) → Channel 151.1750 MHz → Output 1
  (file) → post_write_script" instead of the raw JSON path) and are
  clickable: clicking one auto-expands exactly the Device/Channel/Output
  section it points at (leaving sibling sections collapsed) and scrolls
  it into view.
- **Channel search/filter.** Devices with more than 5 channels get a
  filter box (matches frequency or label) above the channel list, with a
  "Showing N of M channels" indicator. Filtering never renumbers edits —
  each rendered channel keeps its real index into the device's channel
  array. Clicking a validation-error jump-to-field link clears an active
  filter if it would otherwise hide the target channel.

### Fixed

- **Index-key bug**: device/mixer/channel/output lists were keyed by
  array index (`key={i}`). Deleting a middle item could make the next
  item inherit the previous one's `Collapsible` open/closed state and
  its type-dropdown remembered-value cache (from the last two versions'
  data-loss fixes), since both are scoped by position, not identity.
  Fixed with a symbol-keyed synthetic UI id (`lib/keys.ts`) assigned once
  per item on load and preserved through object-spread edits.

## [0.4.17] - 2026-07-26

### Fixed

- **Two real race conditions found and fixed while adding concurrency
  tests.** Both were genuine check-then-act windows, not just missing
  coverage:
  - `ConfigStore.write()` and `PendingRestartStore.persist()` generated
    temp filenames from `pid + Date.now()` only — two overlapping writes
    to the *same* instance within the same millisecond could generate the
    identical temp filename, so the loser's rename-into-place threw ENOENT
    after the winner's rename already consumed it. Now includes a
    `randomUUID()` component, making a collision impossible regardless of
    timing.
  - `createInstance` and `updateConfig`'s `ifMatch` check both read
    current state, then acted on it, with an await in between — two
    genuinely concurrent requests (not just close-in-sequence ones) could
    both pass the check before either wrote, so two overlapping creates
    for the same name could both succeed, and two overlapping saves
    against the same starting version could both go through instead of
    the second one getting `ConfigConflictError` as designed. Fixed with a
    new `KeyedMutex` that serializes create/update/restart/rename/delete
    per instance name (this app is a single process managing one systemd
    unit per instance, so an in-process mutex is a complete fix, not a
    partial one) — operations on different instances still run fully
    concurrently.

### Added

- Comprehensive unit tests for `instance-name.ts` (the path-traversal/
  shell-injection safety boundary: length limits, reserved names, path
  separators, shell metacharacters, unicode, null bytes) and
  `unit-template.ts`.
- A regression test that round-trips the real fixture, plus a hand-built
  config covering icecast/rdio_scanner/mixers/scan-mode, through
  `parseRtlAirbandConfigBody` and confirms nothing is dropped or altered —
  guards against `config-shape.ts` (the HTTP body validator) silently
  drifting from `mapper.ts`/`domain.ts` as fields get added, without the
  risk of unifying the two into one schema-driven implementation.
- `gracefulShutdown` extracted from `index.ts` into its own tested
  function, directly proving the exact ordering the earlier shutdown-race
  fix depends on (poller fully stopped before the stats DB closes).

### Note

A shared saga/rollback helper for `InstanceService` (`createInstance`/
`renameInstance`'s hand-rolled rollback logic) was considered and
deliberately skipped — the bug that originally motivated it (their
rollback thoroughness had diverged) is already fixed, and the current
code is simple, direct, and now covered by real concurrency tests; a
generic abstraction for two call sites isn't justified by anything
currently broken.

## [0.4.16] - 2026-07-26

### Changed

- **rdio-scanner output defaults**: port now defaults to 3000 (was 443) and
  "Use TLS" now defaults unchecked (was checked), matching a typical
  rdio-scanner server's actual defaults. Only affects the initial values
  shown when enabling "Upload to rdio-scanner" on a new output — doesn't
  touch any already-saved config.

## [0.4.15] - 2026-07-26

### Added

- **Real readiness check on `GET /health`.** Previously a static `{status:
  "ok"}` regardless of anything; now actually checks the instances
  directory is readable and the stats DB handle is usable, returning 503
  with the failing check named if not. Doesn't probe systemd/sudo — no
  unit-agnostic way to check that, and doing so on every health check
  (which a monitor might hit every few seconds) would mean shelling out to
  sudo that often for no benefit.
- **Structured audit log + request correlation.** Every config-mutating
  action (create/update/rename/delete/restart, individual or bulk) now
  logs one greppable line tagged `audit: true`, success or failure. Every
  response also carries an `x-request-id` header matching Fastify's own
  per-request log tag, so a reported problem can be traced to the exact
  action and log lines that caused it — there's still no per-user
  identity (no auth layer yet), but "what changed and when" is answerable.
- **Per-instance stats-poll health via the API.** `GET
  /instances/:name/stats/poll-status` surfaces a silently-broken poll
  pipeline for one instance among many — previously visible only in
  server logs.
- **Config backups before every overwrite.** Up to 10 prior versions of
  each instance's `.conf` are kept (in `<instancesDir>/.backups/<name>/`,
  never mistaken for an instance itself), pruned automatically. A save
  that's valid but wrong (bad frequency, wrong Icecast target, ...)
  previously had no way back except retyping it from memory.
- **Dry-run validation.** `POST /instances/:name/validate` runs the same
  checks `updateConfig` would, without writing anything or touching
  systemd — lets a client check "would this save?" before committing to a
  Save-and-restart, which interrupts live audio.
- **Bulk restart.** `POST /instances/restart-pending` restarts every
  instance currently marked pending-restart in one call, reporting each
  instance's outcome independently, instead of one request per instance.
- **Import/export of the whole instance set.** `GET /instances/export` /
  `POST /instances/import`, for migrating hosts or backing up before a
  risky change. Export is deliberately unredacted (a backup missing its
  Icecast passwords/rdio-scanner API keys isn't a usable backup); import
  skips (never overwrites) any name that already exists.
- **`/metrics` Prometheus endpoint**, at the root (the path every
  Prometheus-compatible scraper defaults to) rather than under `/api`,
  covering every managed instance's latest stats in one scrape, tagged by
  an `instance` label. This panel already parses Prometheus format from
  RTLSDR-Airband; it didn't expose any itself until now.
- `export`, `import`, and `restart-pending` are now reserved instance
  names (alongside the existing safe-slug check), so an instance can never
  be shadowed by — or shadow — one of these new static routes.

### Note

Stats retention downsampling and remote-host support were considered and
deliberately deferred (low priority / the systemd adapter interface is
already clean enough to add later without disruption) rather than
implemented in this pass.

## [0.4.14] - 2026-07-26

### Added

- **Optimistic concurrency control on config saves.** `GET /instances/:name`
  now returns an `ETag` header identifying the exact on-disk content; `PUT`
  accepts a matching `If-Match` header and rejects with 409 (new
  `ConfigConflictError`) if the config changed on disk since it was fetched
  — two browser tabs, or two people, editing the same instance no longer
  silently last-write-wins. The frontend now sends this automatically and
  shows a clear message (with the user's unsaved edits still in the form)
  when a save is rejected this way. Omitting `If-Match` skips the check
  entirely, so any existing API client that doesn't send it keeps the old
  behavior.
- **Stats file reads are now bounded.** `stats_filepath` is fully
  operator/API-controlled with no restriction on what it points at; the
  poller now refuses anything over 5MB (a real snapshot is a few KB) and
  times out a read after 5s, so one instance's bad or malicious
  `stats_filepath` can no longer stall or balloon memory for the whole poll
  cycle.

### Fixed

- **A failed restart no longer leaves an instance silently reported as
  in-sync.** `updateConfig` now marks the instance pending-restart as soon
  as the file is written, before attempting the restart — previously a
  restart failure skipped that bookkeeping entirely, so the file and the
  running process could silently diverge with the UI still showing "no
  pending changes."
- **A failed systemd/sudo call now surfaces as a 502 with exit code and
  stderr**, not a generic 500 — this is a routine operational occurrence
  (unit busy, device unplugged, permission denied), not a server bug.
- **`createInstance` now fully rolls back an already-installed unit file**
  if a later step (daemon-reload/enable/start) fails, instead of leaving an
  orphaned unit file referencing a just-deleted `.conf` — mirrors
  `renameInstance`'s more careful rollback, which didn't have this gap.
- **Fixed a shutdown race** between the stats poller and closing the stats
  DB: `poller.stop()` now waits for any in-flight poll to finish, and a
  `prune()` failure is caught instead of becoming an unhandled rejection.
- **Comma-list numeric fields (e.g. scan-mode frequencies) no longer let a
  typo silently save as `NaN`** — unparseable entries are dropped instead of
  passed through.

## [0.4.13] - 2026-07-26

### Added

- **Secrets no longer returned in plaintext by the API.** `GET /instances/:name`
  previously returned Icecast passwords and rdio-scanner API keys verbatim —
  now redacted to a sentinel value. Editing and saving a config that still
  has the sentinel (i.e. the user never touched that field) transparently
  restores the real on-disk value before writing, so normal edit-and-save
  workflows are unaffected; anything the user actually types through
  unchanged. This is defense-in-depth against incidental exposure (browser
  history, dev-tools network tabs, server logs) — it's not a substitute for
  real authentication, which this project still doesn't have.
- **`post_write_script` now surfaces a standing validation warning.** It's a
  legitimate documented RTLSDR-Airband feature, so this doesn't block
  save/restart — but it runs an arbitrary command after every file write,
  which combined with no auth layer is worth a persistent reminder rather
  than silence.
- **Rate-limiting and security headers on the API.** `@fastify/rate-limit`
  (300 req/min global default, 20 req/min on the config-write/restart/
  create/rename/delete routes specifically) and `@fastify/helmet` (default
  security headers) are now registered. No CORS plugin was added — this
  app is same-origin in both its deployment modes (single-process serving,
  or Vite's dev proxy), so the browser's default same-origin policy is
  already the correct posture; a permissive CORS policy would weaken it
  without a real need.

### Fixed

- Bumped `@fastify/static` to 10.1.2, resolving two high-severity advisories
  (auth bypass / path traversal via non-canonical URL paths) it shipped
  with. The remaining `npm audit` findings (a moderate react-router issue,
  and two transitive build-tooling deps) are left for a dedicated
  dependency-hygiene pass rather than bundled into a security-focused
  commit.

### Note

Two related, larger items were deliberately **not** attempted here and are
tracked in the backlog instead, since they're architectural decisions that
need direction rather than something to guess at: adding a real
authentication/authorization layer, and replacing the `sudo systemctl`
adapter with a least-privilege helper daemon or polkit rule (the sudoers
`tee` step can't restrict file *content*, only the destination path).

## [0.4.12] - 2026-07-26

### Added

- **Device Type/Mode switching no longer discards unsaved values.**
  Extends v0.4.11's per-output-type session cache to the two other
  destructive dropdowns in the editor:
  - **Type** (rtlsdr/mirisdr/soapysdr): switching away used to
    immediately drop type-specific fields (serial/index/buffers,
    device_string/channel/antenna) that don't apply to the new type —
    correct once you actually commit to that type, but previously
    permanent even if you switched right back. `DeviceEditor` now
    restores those fields from a cached snapshot when returning to a
    previously-visited type.
  - **Mode** (multichannel/scan): switching used to replace the whole
    `channels` array (and drop `centerfreq`) with that mode's defaults.
    Now restores the previous `channels`/`centerfreq` when switching
    back to a previously-visited mode.

  Both caches are session-local (component refs, not part of the saved
  config) and scoped per device — same model as the output-type cache,
  and independent of it, so switching Type doesn't disturb Mode/channels
  or vice versa.

## [0.4.11] - 2026-07-26

### Added

- **Output type switching no longer discards unsaved field values.**
  Changing an output's type dropdown used to reset it to that type's
  blank defaults, so switching from `pulse` to `file` and back to
  `pulse` lost whatever had been typed into the pulse fields. `OutputEditor`
  now remembers the last-edited values for every output type visited
  during the current editing session (in a component-local ref, not
  part of the saved config) and restores them when the type is switched
  back, instead of re-creating defaults. Purely a browser-session
  convenience — nothing here is written to the .conf, and it doesn't
  survive a page reload.

## [0.4.10] - 2026-07-26

### Fixed

- **Top-level checkboxes in a 2x2 grid, not a single column.** The
  bottom-right cell from v0.4.9 stacked all four checkboxes vertically,
  which made that cell (and the whole top-level section) taller than it
  needed to be. Switched it to a 2x2 grid, shrinking the section back
  down to two rows with no wasted space.

## [0.4.9] - 2026-07-26

### Fixed

- **Top-level config checkbox grouping.** v0.4.8 grouped the four
  top-level checkboxes into their own column, but that column sat
  entirely below the 5-field text column rather than beside it, since
  the fields and checkboxes were two separate stacks in a 2-column grid
  instead of one shared grid. Flattened them into a single `grid-cols-2`
  so the fields fill left-to-right/top-to-bottom (Stats, FFT / PID,
  Shout / Tau, checkboxes), landing the checkbox group in the
  bottom-right cell next to Tau as intended.

## [0.4.8] - 2026-07-26

### Added

- **Squelch threshold / SNR threshold mutual-exclusion check.** Upstream
  RTLSDR-Airband only warns when both `squelch_threshold` and
  `squelch_snr_threshold` are set on the same channel and silently picks
  one; the panel now fails validation instead, since a saved config that
  leaves it ambiguous which threshold governs squelch is never what was
  intended. Both fields' tooltips now call out the conflict.

### Changed

- **Config editor layout cleanup**, based on prod feedback after v0.4.7:
  - The four top-level checkboxes (multiple demod/output threads,
    localtime, log scan activity) are now grouped together to the right
    of the global fields column instead of interleaved into the same
    2-column grid, so they read as one cluster next to Tau.
  - Trimmed several field labels down to just their essential
    "(optional...)" qualifier, moving the trimmed detail into the
    existing tooltip: channel/scan-channel Tau no longer repeats
    "falls back to device/global" in the label, and channel Squelch
    threshold no longer repeats the SNR mutual-exclusion note (both now
    live only in the tooltip).
  - Dropped the redundant "Hz" from Highpass/Lowpass labels (channel,
    scan-channel, and mixer) — the unit is still documented in each
    field's tooltip.
  - The output "Output type" `<select>` no longer stretches across the
    full panel width; it's now sized like the text fields in the same
    section.

## [0.4.7] - 2026-07-26

### Fixed

- **Reverted most of the v0.4.6 grid-alignment fix.** The reserved
  two-line label area on every `Field` and the `alignWithField` spacer
  on `BoolField` produced a much bigger visual regression than the
  misalignment they fixed — every label/input pair now read as
  double-spaced throughout the config editor. Reverted `Field.tsx`,
  `BoolField`, and all `alignWithField` call sites back to their
  pre-0.4.6 form, and reverted the shortened "Squelch threshold, dBFS"
  label back to its longer wording. Kept the one part of 0.4.6 that was
  a clean win: `inputClass` still sets an explicit height so `<select>`
  dropdowns match text inputs.

## [0.4.6] - 2026-07-26

### Fixed

- **Config editor grid alignment.** Several small visual misalignments in
  the config editor forms: `<select>` dropdowns rendered at a different
  height than text inputs (no explicit height on either, so browsers sized
  them slightly differently); fields whose label wrapped onto a second
  line pushed their own input lower than same-row siblings with a shorter
  label; and checkboxes (`BoolField`) sharing a grid row with a taller
  label+input `Field` sat higher than that row's input. Fixed by giving
  every input/select a fixed height, reserving a consistent two-line-tall
  label area on every `Field`, and giving `BoolField` an opt-in
  `alignWithField` prop that reserves the same label-height space when it's
  used inside a field grid (left off for its other use as a standalone
  "Disable" toggle in a section header, where the reserved space would
  look wrong). Also shortened the one channel label long enough to wrap to
  three lines instead of two (`Squelch threshold, dBFS`), moving the
  trimmed detail into its existing tooltip.

## [0.4.5] - 2026-07-26

### Added

- **Validate config values that would crash RTLSDR-Airband at startup.**
  RTLSDR-Airband parses its config once at process start and hard-exits on
  many invalid values (non-power-of-two `fft_size`, negative `ampfactor`,
  `lowpass` below `highpass`, an unrecognized `modulation`, out-of-range
  `shout_metadata_delay`/`squelch_threshold`/`squelch_snr_threshold`/
  `notch_q`, mixer-nested output rules, etc.), which fails the systemd unit
  this panel manages. `backend/validate` only caught a subset of these;
  every remaining gap is now checked, each verified against the actual
  upstream C++ source (`config.cpp`, `rtl_airband.cpp`, `input-*.cpp`)
  rather than just the wiki, so every new check traces to a real fatal
  check upstream. Also adds HTML5 `min`/`max`/`step` hints on the
  frontend's plain numeric inputs for immediate feedback, backstopped by
  the same backend checks.

## [0.4.4] - 2026-07-26

### Fixed

- **Pending-restart tracking moved to the server.** Previously tracked as
  React state on the edit page, so restarting a *different* instance would
  clear the "changes pending restart" notice for the one actually still
  pending. Now persisted server-side in a small JSON file next to each
  instance's `.conf` (survives page refresh, browser close, and API
  process restarts), scoped correctly per instance.

### Added

- **Sidebar green dot + header pending-restart count.** Any instance with
  an unapplied save shows a green dot (with tooltip) next to its name in
  the sidebar; the header shows a click-to-expand count of how many
  instances are pending, backed by a shared `InstanceListContext` so the
  two never drift out of sync.

## [0.4.3] - 2026-07-25

### Added

- **Split "Save" from "Save and restart".** `Save` writes the config to the
  instance's `.conf` file without touching the running systemd unit — the
  process keeps running on its old in-memory config until an explicit
  restart, since RTLSDR-Airband has no live-reload. `Save and restart`
  (styled red, since it interrupts live audio) does both, behind a
  confirmation prompt. After a plain `Save`, a "Changes pending restart"
  badge appears next to the page title until the instance is restarted.
  Backend: `PUT /instances/:name` now accepts `?restart=false`
  (`InstanceService.updateConfig` takes a `{ restart }` option, defaulting
  to `true` to preserve existing behavior for any other caller).

## [0.4.2] - 2026-07-25

### Fixed

- **Unchecking "Upload to rdio-scanner" no longer discards the entered
  `rdio_scanner` fields.** Server, API key, talkgroup ID, etc. used to be
  wiped the instant the checkbox was unchecked, since the whole config
  block was set to `undefined`. It's now tracked with its own panel-only
  `disable` flag (`RdioScannerConfig.disable`, `backend/parser`): unchecking
  keeps the entered values and only flips that flag, so re-checking restores
  them instantly. RTLSDR-Airband itself has no concept of a "present but
  disabled" `rdio_scanner` block (its mere presence enables uploading), so
  the serializer omits the block from the written `.conf` whenever
  `disable` is true — functionally disabled on disk, exactly as before,
  just without losing the mid-edit form data. `backend/validate`'s
  `rdio_scanner`-requires-`split_on_transmission` check now also skips
  disabled blocks, since they won't be written and can't violate it.

## [0.4.1] - 2026-07-25

### Added

- **Collapsible devices, channels, and outputs.** Every device, channel/scan
  channel, output, and mixer in the config editor now renders as a
  collapsible section (chevron + one-line summary) and starts collapsed on
  page load. Expanding a device leaves its channels collapsed; expanding a
  channel leaves its outputs collapsed — each section tracks its own
  open/closed state independently. Aimed at busy instances where a device
  can carry a dozen-plus channels and the full field grid for all of them
  used to render at once.

### Changed

- **`Disable` moved into the section header**, next to `Remove`, for
  devices, channels/scan channels, outputs, and mixers — visible without
  expanding the section, instead of buried in the settings grid.

### Fixed

- **rdio-scanner `Talkgroup ID` field no longer starts pre-filled.** The
  input was bound directly to the required numeric field (seeded at `0`
  when rdio-scanner upload is enabled) with no empty-value handling, so it
  always showed a digit that had to be manually cleared before typing a
  real talkgroup ID. It now renders blank when unset and only writes a
  real value once the user types one.

## [0.4.0] - 2026-07-23

### Added

- **rdio-scanner call-upload support**, tracking the native support added in
  the [`rdio_api`](https://github.com/jschmall/RTLSDR-Airband/tree/rdio_api)
  fork branch. A `file` output can now carry a nested `rdio_scanner` block
  (`server`, `port`, `use_tls`, `api_key`, `system_id`, `system_label`,
  `talkgroup_id`, `talkgroup_label`, `talkgroup_tag`, `talkgroup_group`,
  `source_id`, `delete_after_upload`, `timeout_ms`, `max_retries`) that
  uploads each completed transmission to a
  [rdio-scanner](https://github.com/chuot/rdio-scanner) instance's
  call-upload API, in place of the old `post_write_script` + external CSV
  workaround. Covered end to end: parser round-trip (`backend/parser`), HTTP
  body shape validation (`backend/api`), a new semantic check enforcing that
  `rdio_scanner` requires `split_on_transmission` on the same output
  (matching RTLSDR-Airband's own startup validation, `backend/validate`),
  and a collapsible editor section on file outputs with tooltips for every
  field (`frontend`). Only takes effect against an RTLSDR-Airband binary
  built with `-DRDIO_SCANNER=ON` from that fork branch — the panel change
  alone has no effect on existing configs that don't set `rdio_scanner`.

## [0.3.1] - 2026-07-22

### Added

- **Hover tooltips on every config field.** The device, channel/scan-channel,
  output, mixer, and global settings editors now show a plain-language
  explanation on hover (`title` attribute + dotted-underline hint, matching
  the existing Stats page convention), sourced from a new
  `config-descriptions.ts`. Field labels are unchanged — tooltips add depth
  without cluttering the visible label text.
- **Device fields now adapt to device type and channel mode.** `Serial`/
  `Index` are hidden for SoapySDR devices (which are identified by
  `device_string` instead); `Center frequency` is hidden in scan mode
  (the dongle retunes per frequency, so it's unused). Switching a device's
  `type` or `mode` now strips fields that no longer apply (e.g. `buffers`,
  `device_string`, `centerfreq`) instead of leaving stale values sitting in
  the saved config.

### Fixed

- MiriSDR's `correction` field was labeled "ppm" like rtlsdr/soapysdr, but
  RTLSDR-Airband documents it in Hz for that device type. The label (and
  its tooltip) now switch units based on the selected device type.

## [0.3.0] - 2026-07-22

### Added

- **Scan-mode support.** Devices can now be configured with `mode = "scan"`
  and a single channel using `freqs` instead of `freq`. Per-frequency
  fields (`ampfactor`, `ctcss`, `notch`, `notch_q`, `bandwidth`,
  `squelch_threshold`, `squelch_snr_threshold`) accept either one value
  (applied to every scanned frequency) or a comma-separated list with one
  entry per frequency, matching RTLSDR-Airband's own config grammar —
  including the `0`/`-1.0` sentinel values scan mode uses to mean
  "auto-squelch" / "skip this frequency" / "keep the default". `labels`
  and `modulations` lists are also supported.
- **`squelch_threshold`**, alongside the existing `squelch_snr_threshold`,
  on both multichannel and scan-mode channels.
- **Top-level `mixers` block.** Channel outputs of type `mixer` can now
  route into an actual mixer definition (`name`, `disable`, `highpass`,
  `lowpass`, `outputs`) instead of a name with nothing behind it.
- New channel fields: `label`, `notch_q`, `highpass`, `lowpass`, `tau`,
  `disable`.
- New device fields: `mode`, `tau`, `disable`, and type-specific fields —
  `buffers` (rtlsdr), `num_buffers` (mirisdr), `device_string`/`channel`/
  `antenna` (soapysdr). The device type picker in the UI is now a dropdown
  (rtlsdr / mirisdr / soapysdr) instead of free text, and `gain` accepts
  either a number or a SoapySDR `component=value` string (omit entirely to
  enable AGC).
- New global fields: `pidfile`, `log_scan_activity`, `shout_metadata_delay`,
  `tau`.
- New semantic validation checks: scan-mode structural rules (exactly one
  channel per scan-mode device, per-frequency list lengths), device
  field requirements by type/mode (`gain`, `centerfreq`, `device_string`),
  mixer name references, and the `disable` cascade (at least one active
  device/channel/output, per RTLSDR-Airband's own startup constraints).

### Changed

- `Channel` is now a `MultichannelChannel | ScanChannel` union throughout
  the parser, validator, API, and frontend.
