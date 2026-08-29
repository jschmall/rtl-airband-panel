# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project doesn't publish to a registry, so versions are tracked via git tags
(`vX.Y.Z`) rather than npm releases. Versions before 0.3.0 predate this file.

## [0.4.101] - 2026-08-29

### Added

- **Device edit page shows an at-a-glance channel frequency-range summary.**
  Above each device's channel list, a new line shows the lowest/highest
  configured channel frequency (e.g. "Channels: 146.8000–147.0000 MHz")
  alongside the device's usable tuning window (e.g. "device window:
  146.2700–147.5300 MHz") — useful for spotting free room when adding a new
  channel. The window figure reuses `backend/validate`'s
  `checkFrequencyWindow` formula exactly (its `SOFT_BW_THRESHOLD` constant
  is now a public export for this purpose), so it can never disagree with
  that check's own `frequency-out-of-window` warning. Scan-mode devices show
  the occupied range across their scan list but no window, matching that
  check's own exclusion (no fixed capture window in scan mode). New pure
  helpers `channelFrequencyRangeHz()`/`deviceUsableWindowHz()` in
  `frontend/src/lib/frequency-range.ts`.

## [0.4.100] - 2026-08-29

### Changed

- **Reworked the Stats page layout.** The signal/squelch chart now sits at
  the top of the page (below the instance/channel/range pickers), since
  it's the most useful info at a glance; the device counters and output
  stats sections both moved below it and are now collapsible, collapsed by
  default, using the shared `Collapsible` component instead of (for output
  stats) a bespoke local toggle.
- **Device counters are now a table, not a tile grid.** The old
  `BufferHealthTile`/`StatTile` grid is replaced by a new
  `DeviceCountersTable`: one row per device, one column per device-scoped
  counter (columns derived from whatever metrics are actually present, so a
  new device metric just becomes a new trailing column), with a small
  process-wide caption below the table for metrics with no `device` label
  (currently just CPU time).
- **Output stats labeling is friendlier.** Device-channel group titles now
  show the channel's configured label when it has one, falling back to
  "Channel N" (position among that device's enabled channels) instead of
  raw "Device X, Channel Y" indices; metric names throughout (device
  counters table and output stats cards) use a new `friendlyMetricLabel()`
  plain-English map instead of the naive title-cased metric name, falling
  back to the old title-casing for anything not in the map.

### Fixed

- Migrating the output stats group cards onto the shared `Collapsible`
  component surfaced a narrow-viewport layout bug: a long group title could
  wrap onto two lines while the summary line (rendered as a flex sibling,
  not inside the title's own wrapping flow) vertically centered into the
  gap between them, visually overlapping the title. Fixed by keeping the
  group title on one line with truncation instead of wrapping.

## [0.4.99] - 2026-08-09

### Fixed

- **Stage 4 (final) of the deferred `React.memo` editor-tree refactor
  (item 7, tracked in #7): mixer level.** `MixerEditor` is now wrapped in
  `React.memo` and takes a new required `mixerIndex` prop; `ConfigEditor`'s
  mixers list passes it three stable `useCallback` handlers (keyed by
  `uiKeyOf`, looked up via `configRef`) instead of a fresh
  `onChange`/`onRemove`/`onDuplicate` closure per mixer per render,
  mirroring Stage 1's device-level treatment (including the
  name-blanking-on-duplicate special case). Editing one mixer's field no
  longer re-renders its sibling mixers. Verified live against a 3-mixer
  fixture: only the edited mixer re-rendered; duplicate/remove round-
  tripped correctly (3→4→3) with the blank-name-on-duplicate behavior
  intact.

  This closes out the item 7 rollout across all four levels (device,
  channel, output, mixer) of the config editor tree. `MixerRemoteInputFields`
  (the small `remote_inputs` list) and `OutputEditor`'s 7 per-type field
  sub-components remain intentionally un-memoized — see #7 for the
  reasoning.

## [0.4.98] - 2026-08-09

### Fixed

- **Stage 3 of the deferred `React.memo` editor-tree refactor (item 7,
  tracked in #7): output level.** `OutputEditor` is now wrapped in
  `React.memo` and takes a new required `outputIndex` prop; `ChannelEditor`,
  `ScanChannelEditor`, and `MixerEditor` each pass it three stable
  `useCallback` handlers (keyed by `uiKeyOf`, looked up via a new
  per-component ref at call time) instead of a fresh
  `onChange`/`onRemove`/`onDuplicate` closure per output per render. The
  `onCopyToChannel` wrapper closure (`(target) => onCopyOutputToChannel(output, target)`,
  recreated per output per render at all three call sites) is gone too —
  `OutputEditor` now takes `onCopyOutputToChannel` directly and supplies
  `output` itself, so the already-stable instance-wide handler can be
  passed straight through unwrapped.
- **Fixed `ChannelEditor`/`ScanChannelEditor`'s `copyTargets`**, which was
  a plain `.filter()` over `channelTargets` computed fresh in the render
  body — a new array reference every render regardless of content, which
  alone defeated `OutputEditor`'s new `React.memo` for every output in a
  channel whenever any field in that channel changed. Now `useMemo`'d.
  Found the same way as the `onRevealSecret` fix in v0.4.96: a live
  render-count check against a channel with 4 outputs showed all 4
  re-rendering on a single-output edit until this was fixed, then only
  the edited one.

## [0.4.97] - 2026-08-09

### Fixed

- **Stage 2 of the deferred `React.memo` editor-tree refactor (item 7,
  tracked in #7): channel and scan-channel level.** `ChannelEditor` and
  `ScanChannelEditor` are now wrapped in `React.memo`, and `DeviceEditor`
  passes `ChannelEditor` three stable callbacks (keyed by `uiKeyOf`,
  looked up via a new `deviceRef` at call time) instead of a fresh
  `onChange`/`onRemove`/`onDuplicate` closure per channel per render.
  Editing one channel's field (e.g. bandwidth, CTCSS, label) no longer
  re-renders its sibling channels. Verified live: only the edited
  channel re-rendered on a non-identifying field edit; editing a
  channel's frequency/label, or reordering channels, still correctly
  cascades to every channel in the instance, because `channelTargets`
  (the instance-wide "copy output to channel…" list) encodes each
  channel's current index and label, so those two kinds of edits
  legitimately invalidate it for everyone — not a memoization gap.

## [0.4.96] - 2026-08-09

### Fixed

- **Stage 1 of the deferred `React.memo` editor-tree refactor (item 7 from
  the 0.4.94 performance pass, tracked in #7): device-level memoization.**
  `DeviceEditor` is now wrapped in `React.memo`, and `ConfigEditor`'s
  devices list passes it three stable callbacks (keyed by each device's
  `uiKeyOf` identity, looked up via `configRef` at call time) instead of a
  fresh `onChange`/`onRemove`/`onDuplicate` closure per device per render.
  Editing one device's field no longer re-renders every other device in
  the instance. Verified live against a 3-device fixture instance:
  React-render-count instrumentation confirmed only the edited device
  re-rendered after this change (both siblings re-rendered on every
  keystroke before it).
- **`InstanceEditPage`'s `revealSecret` callback is now a stable
  `useCallback`** instead of a plain function re-created every render.
  This was an unrelated-looking prop (`onRevealSecret`) that silently
  defeated the `React.memo` work above for every device, since a
  memoized component still re-renders if *any* prop's identity changes,
  not just the ones this refactor targeted directly — found via the live
  verification above, not by static reading.

## [0.4.95] - 2026-08-09

### Added

- **Merged `mixer_remote_input` into `master`.** Brings in the whole
  feature set documented in the 0.4.91–0.4.94 entries directly below: the
  `mixer_remote` output type and mixers' `remote_inputs` block for
  cross-instance mixer routing, plus the config-cache/prune-interval/
  tokenizer backend performance fixes and the frontend re-render fan-out
  fixes from the 0.4.94 performance pass. `master` hadn't diverged since
  the previous merge (`dynamic_reload`, v0.4.90), so this merge commit is
  simply versioned one past `mixer_remote_input`'s own highest number
  (0.4.94) rather than reconciling two independent sequences.

## [0.4.94] - 2026-08-09

### Fixed

- **Eliminated the redundant per-instance config re-parsing that was the
  likely cause of periodic CPU spikes on multi-instance deployments.**
  `ConfigStore` had no cache, so every stats-poll tick (every 15s) and every
  `GET /instances` call re-read and re-parsed **every** instance's `.conf`
  file from disk, even though nothing had changed — with N instances
  configured, that's N full libconfig-style parses every 15-20 seconds,
  clustered into the same event-loop tick. `ConfigStore` now caches each
  instance's parsed config keyed on the file's mtime/size, invalidating only
  on an actual write, rename, or external change.
- **Fixed a roughly-quadratic tokenizer bug.** The number/identifier token
  branches did `source.slice(i)` on every single token — re-copying the
  entire remainder of the file each time — making one full parse cost scale
  with file size squared rather than linearly. Replaced with a sticky (`y`
  flag) regex that matches in place. This compounds with the cache fix above:
  every parse that does still happen (cold cache, first load) is now cheap
  too.
- **Decoupled the stats DB prune pass from the poll interval.** `prune()`
  (a `DELETE` over the whole samples table, an anti-join `DELETE` over
  series, and an incremental vacuum — all synchronous, all blocking the
  event loop) ran unconditionally on every single stats-poll tick regardless
  of whether anything was actually expired. It now runs on its own cadence,
  `RTL_PANEL_STATS_PRUNE_INTERVAL_MS` (default 1 hour, new CLI flag
  `--stats-prune-interval-ms`), independent of `RTL_PANEL_STATS_POLL_INTERVAL_MS`.
- **Stopped the frontend's background instance-list poll from cascading a
  re-render through the whole app shell every 20 seconds regardless of
  whether anything changed.** `InstanceListContext` now compares the freshly
  polled list against the current one and only replaces state (and thus only
  changes the context value's identity) when something actually differs.
- **Memoized `InstanceEditPage`'s unsaved-changes check**, which did two full
  `JSON.stringify` passes over the whole instance config on every render,
  including renders caused by the unrelated background list poll while a
  user was mid-edit.
- **Merged `InstanceHealthOverview`'s independent 20s poll timer into the
  same clock `InstanceListContext` already runs**, instead of two
  independently-phased timers producing app re-renders roughly every 10
  seconds on average.
- **Removed `StatsPage`'s redundant `listInstances()` fetch** — it now reads
  from the same shared `InstanceListContext` every other page already uses,
  instead of duplicating the request (and, pre-cache-fix above, duplicating
  a full re-parse of every instance's config) on every mount.
- Fixed an unstable array-index React key on the Stats page's device-counter
  tiles; stabilized `ConfigEditor`'s `channelTargets`/copy-to-channel handler
  so they don't change identity on every keystroke.

## [0.4.93] - 2026-08-07

### Fixed

- **Corrected an inaccurate "always requires a restart" claim for
  `mixer_remote` outputs.** Traced against three new commits on the fork's
  `mixer_remote_input` branch (`5821116`, `a6bc9e3`, `61ed62e`): a memory
  leak fix confirmed that editing or removing a `mixer_remote` output on
  an *existing* channel was always meant to apply live via the existing
  generic channel-edit path (`reserve_channels` headroom), exactly like
  any other output type — it was only ever restart-only because of the
  leak bug, now fixed upstream. Only a mixer's `remote_inputs` entries
  remain genuinely restart-only (RTLSDR-Airband connects those slots once,
  at startup, with no live-apply primitive at all — separately confirmed
  by the fork's `reload_diff` now correctly detecting and reporting a
  changed `remote_inputs` block under "skipped, needs restart" instead of
  silently no-op'ing). Updated the `mixer_remote` output tooltip and both
  the "New config fields" bullet and the dedicated "Cross-instance mixer
  input" README section to reflect this split accurately. No functional
  panel code changes were needed — the panel already applies whatever
  `reload_diff` reports generically, with no live-appliable classification
  table of its own to update.

## [0.4.92] - 2026-08-07

### Changed

- Gave the 0.4.91 `mixer_remote`/`remote_inputs` feature its own top-level
  README section ("Cross-instance mixer input") instead of a single bullet
  buried in the `dynamic_reload` live-apply writeup — it's an unrelated
  fork branch and deserved its own explanation of the transport, the
  sending/receiving config syntax, and the cross-mixer duplicate-route
  validation, rather than reading as a footnote to live-apply.

## [0.4.91] - 2026-08-07

### Added

- **`mixer_remote` output type and mixers' `remote_inputs` block.** Lets a
  mixer in one RTLSDR-Airband instance absorb a live audio input streamed
  from a channel in a *different* instance's process, over a same-host,
  same-user Unix domain socket — useful for combining channels from
  separate SDR instances into one mixed stream on hosts that run several
  instances. On the sending side, any channel (device or a mixer's own
  embedded channel) can add a `mixer_remote` output (`dest_path`,
  `stream_id`); on the receiving side, a mixer's new `remote_inputs` list
  reserves one input slot per entry (`listen_path`, `stream_id`, optional
  `ampfactor`/`balance`/`label`). Fork-only — requires an RTLSDR-Airband
  build from `jschmall/RTLSDR-Airband`'s `mixer_remote_input` branch. No
  live-creation path: adding, removing, or editing either side always
  requires a restart, even on an otherwise Apply-live-capable instance.
  Also fixes the mixer-input stats numbering (`buildMixerLookups()`) to
  account for `remote_inputs` entries claiming the first N input indices on
  a mixer, ahead of channel-routed `type: "mixer"` inputs, matching the
  fork's `parse_mixers()`-before-`parse_devices()` connection order.

## [0.4.90] - 2026-08-06

### Added

- **Merged `dynamic_reload` into `master`.** Brings in the whole live-apply
  feature set documented in the 0.4.79–0.4.89 entries directly below: the
  `control_socket_path`/`enabled`/`reserve_channels`/`reserve_inputs`/
  `bandwidth` config fields, the **Apply live** button and its
  `reload_diff`-backed live-apply path (centerfreq, sample_rate, gain,
  tuner bandwidth, correction, channel/mixer enable, and channel
  add/edit/remove within reserved headroom), the retryable-vs-restart-
  required failure split, the per-instance live-apply cooldown, and the
  `serviceUser`/`serviceGroup` opt-in instance options the control
  socket's UID check requires. Requires an RTLSDR-Airband build from the
  fork's now-merged-to-`main` `dynamic_reload` branch — see that repo's
  [PR #18](https://github.com/jschmall/RTLSDR-Airband/pull/18).
- Reconciles the two independent version sequences `master` and
  `dynamic_reload` had been keeping since `dynamic_reload` branched off
  (see the 0.4.76 entry's note below) — this merge commit is versioned
  past both sides' highest prior number (`master` at 0.4.78,
  `dynamic_reload` at 0.4.89) rather than continuing either chain alone.

## [0.4.89] - 2026-08-06

### Changed

- **Rewrote the README's `dynamic_reload` section** to cover the full
  current feature set instead of its original, now-stale snapshot. Fixes
  the same "sample rate always needs a restart" claim already corrected in
  the in-app dialog (0.4.88) — it was still wrong here too. Adds: the new
  `bandwidth`/`correction` config fields, an explicit "what Apply live can
  push live" list (centerfreq, sample_rate, gain, bandwidth, correction,
  channel/mixer enable, channel add/edit/remove), a "Failure behavior"
  note explaining the retryable-vs-restart-required split (0.4.85) so a
  transient hardware failure isn't confused with something that needs a
  restart, explicit guidance that `control_socket_path` is an arbitrary
  but must-be-unique-per-instance path (prompted by a real question about
  running 12 concurrent instances — a same-path collision fails closed
  and silently, not with a crash), the 1s live-apply cooldown (0.4.84),
  and the `centerfreq_retune_failure_count` metric (0.4.83). Also brings
  the "what's not here yet" standalone-command list up to date
  (`set_correction`/`set_sample_rate` existed but weren't listed).

## [0.4.88] - 2026-08-06

### Added

- **Device-level `bandwidth` (rtlsdr tuner bandwidth) support**, tracking the
  fork's `dynamic_reload` branch commits `80ee2bc` (live tuner bandwidth
  control), `686b283` (live frequency correction), and `343be38` (live
  `sample_rate` change). `correction` and `sample_rate` were already modeled
  and needed no new fields; `bandwidth` — an rtlsdr-only device-level key,
  distinct from the pre-existing per-channel `bandwidth` (a post-demod audio
  filter) — was entirely missing. Added to the parser domain model
  (`backend/parser/src/domain.ts`), its libconfig mapper read/write
  (`mapper.ts`), the API's independent request-body shape validator
  (`backend/api/src/config-shape.ts` — caught by the existing
  `config-shape-parity` test, which round-trips the `fork-features` fixture
  through both parsers and diffs the result), a `bandwidth >= 0` check
  (`backend/validate/src/checks/device-requirements.ts`, mirroring
  RTLSDR-Airband's own `rtlsdr_parse_config()` rejection), and a new
  rtlsdr-only field in `DeviceEditor.tsx` (cleared/restored on device-type
  switch, same as `buffers`/`serial`/`index`). Unlike `centerfreq`/
  `sample_rate`, RTLSDR-Airband reads this key via a plain `(int)` cast, not
  `parse_anynum2int()` — no float-means-MHz shorthand — so the mapper
  deliberately uses `optionalNumber`, not `optionalHzNumber`; a dedicated
  round-trip test locks this in.

### Fixed

- **"Apply live?" confirmation copy still claimed `sample rate` always needs
  a restart.** True before `343be38`; now live-appliable like everything
  else in that list. Updated `InstanceEditPage.tsx`'s confirm dialog to
  match, and added `bandwidth`/`correction` to the same list.

## [0.4.87] - 2026-08-06

### Fixed

- **`sudo` mode's CLI log garbling, and a missing `journalctl` sudoers
  grant.** After 0.4.86's `pino-pretty` fix, foreground CLI logs still
  showed periodic gaps mid-stream in `sudo` mode — a run of blank
  characters roughly the width of the previous line, then the next log
  line continuing mid-row. Root cause: `sudo`, on its own, never respects
  piped stdio for a password prompt — it opens `/dev/tty` directly and
  writes there regardless of how the child's stdin/stdout/stderr are
  redirected, specifically so a prompt can't be silently hidden. Every
  `sudo systemctl`/`journalctl`/`tee`/`rm` call `SudoSystemctlAdapter`
  (`backend/api/src/systemd/sudo-adapter.ts`) shells out to was missing
  `-n`, so a call that couldn't authenticate without a prompt — which,
  for `journalctl`, was *every* call, since the shipped
  `deploy/rtl-airband-panel.sudoers` example only ever granted
  `systemctl`/`tee`/`rm`, never `journalctl` — would have `sudo` write its
  prompt straight to the controlling terminal, uncoordinated with and
  interleaved into this process's own stdout writes. Only reachable at a
  real foreground terminal (a controlling tty to write to at all);
  invisible under systemd, matching exactly how the symptom was
  originally reported. Added the missing `RTL_PANEL_JOURNALCTL` grant to
  the sudoers template, and `-n` to every `sudo` invocation the adapter
  makes, so any future sudoers gap fails as a clean, piped, loggable
  error instead of ever reaching for `/dev/tty` again.

## [0.4.86] - 2026-08-06

### Added

- **Pretty, single-line logging when running the API directly from a
  terminal.** `backend/api`'s Pino logger (`app.ts`) previously always
  emitted raw NDJSON, regardless of how the process was started. Each
  entry genuinely was one newline-terminated line, but the JSON is long
  enough that it visually wraps across terminal rows during interactive
  CLI use (`npm start --workspace=backend/api` in the foreground), which
  read as hard-to-follow, spaced-out logs. Added a `pino-pretty`
  transport (`singleLine: true`, colorized, short timestamps), enabled
  only when `process.stdout.isTTY` is true and no `logFile` override is
  set — never under systemd (no TTY there; goes to the journal as before)
  and never when `RTL_PANEL_LOG_FILE`/`--log-file` is set (stays raw
  NDJSON, since that path must remain machine-readable).

## [0.4.85] - 2026-08-06

### Fixed

- **`LiveApplyBanner` no longer tells the user to restart right next to a
  message saying not to.** The RTLSDR-Airband fork's `dynamic_reload`
  branch (commit `743ccde1`) fixed `reload_diff` under-reporting retune
  failures as `"applied"`: `compute_and_apply_diff()` now waits for the
  demod thread to actually confirm a centerfreq change before reporting
  it, and a confirmed hardware failure lands in `skipped_requires_restart`
  with a message ending "no restart needed, retry reload_diff" — a case
  that array never carried before. The panel's `LiveApplyBanner`
  (`frontend/src/pages/InstanceEditPage.tsx`) had a single hardcoded
  header ("N still need a restart:") above the raw list of messages,
  which now directly contradicted this new message's own text. Added
  `classifySkippedRequiresRestart()` (`frontend/src/lib/live-apply.ts`),
  splitting on the fork-guaranteed "no restart needed" substring (locked
  in by the fork's own `test_live_reconfig.cpp` regression test), so
  genuinely restart-required items and transient/retryable failures each
  get their own section with accurate copy. `pendingRestartStore`
  semantics are unchanged — it already tracked "on-disk config not yet
  fully reflected in the running process," which is still true for the
  retryable case; only the UI copy was wrong.

## [0.4.84] - 2026-08-06

### Added

- **A 1-second per-instance cooldown on live-apply (`reload_diff`)
  requests.** `applyConfigLive` (`backend/api/src/instance-service.ts`)
  has no dedicated "retune" command — every call writes the whole config
  and asks the running process to `reload_diff` it, and the fork's diff
  mechanism (see 0.4.82) can cascade into retuning several devices from a
  single call. Nothing previously stopped back-to-back calls against the
  same instance (a stuck retry loop, a fast double "Apply live", scripted
  misuse) from firing faster than hardware can recover from a transient
  retune fault — the kind the fork's `centerfreq_retune_failure_count`
  metric (0.4.83) already tolerates as non-fatal, but not instantaneous.
  `InstanceService` now tracks the last `reload_diff` attempt per
  instance name in memory and skips the socket call — while still writing
  the config to disk, same as any other live-apply outcome — if another
  attempt on the same instance lands within 1000ms, reporting
  `liveApply: { attempted: false, reason: "cooldown" }`. The frontend's
  `LiveApplyBanner` (`frontend/src/pages/InstanceEditPage.tsx`) shows this
  as a distinct amber "applied too recently" message rather than the
  generic red failure banner. This is a defense-in-depth safety floor, not
  a fix for a known bug — a real-world stress test (400 live retunes over
  2 minutes against actual hardware) already ran with zero issues.

## [0.4.83] - 2026-08-06

### Changed

- **Added a tooltip for the fork's new `centerfreq_retune_failure_count`
  metric.** The RTLSDR-Airband fork's `dynamic_reload` branch (commit
  `b165376`) stopped a transient hardware retune/gain/bandwidth failure
  from marking a device's input as failed (previously this could cascade
  into the whole process exiting if it was the last running device) and
  started emitting a per-device `centerfreq_retune_failure_count` counter
  alongside the existing `buffer_underrun_count`/`buffer_overflow_count`
  metrics. The panel's stats parsing and per-device tile rendering are
  already fully generic (no metric allowlist), so the new metric showed
  up automatically — this just adds an entry to
  `DEVICE_METRIC_TOOLTIPS` (`frontend/src/lib/stats-descriptions.ts`) so
  it gets an explanatory tooltip like its siblings instead of falling
  back to a bare titleized name. No control-socket or config-schema
  change on the panel side: the fork commit didn't change any command
  names, request/response shapes, or file formats the panel depends on.

## [0.4.82] - 2026-08-06

### Changed

- **Documentation/copy updated to reflect that live channel edit and
  removal now work via `reload_diff`, not just tail append.** The
  RTLSDR-Airband fork's `dynamic_reload` branch generalized its diff
  mechanism from "compare channel counts" to "find the longest common
  prefix by content, tear down and rebuild everything after the point of
  divergence" — so adding, removing (anywhere in a device's channel list,
  not just the tail), and editing an existing channel's fields can now all
  apply live, within `reserve_channels` headroom, no restart. The panel
  never predicted this client-side to begin with (it always just fires the
  bare `reload_diff` command and displays whatever the running process
  reports back), so no behavior changed here — only the copy that
  undersold what's possible: the Apply-live confirm dialog
  (`InstanceEditPage.tsx`), the `README.md` `dynamic_reload` section, and
  `DEVICE_TOOLTIPS.reserveChannels`. The README's `dynamic_reload` section
  also gained a `reserve_inputs` bullet (v0.4.80) and dropped its now-
  inaccurate "no elevated privileges needed" claim in favor of describing
  the new `serviceUser`/`serviceGroup` setting (v0.4.81).

## [0.4.81] - 2026-08-06

### Added

- **Opt-in `serviceUser`/`serviceGroup` instance options, so the generated
  systemd unit can set `User=`/`Group=`.** The RTLSDR-Airband fork's own
  docs now spell out a requirement that was previously undocumented on the
  panel side: its `dynamic_reload` control socket's `SO_PEERCRED` check
  requires an *exact* UID match against the daemon's own `getuid()`, so a
  unit left to run as root (the default when `User=`/`Group=` are unset,
  which is every unit this panel has generated until now) locks out any
  non-root client — including this panel's own `reload_diff` calls, i.e.
  the entire Apply live feature. Added a new `serviceUser`/`serviceGroup`
  pair to `InstanceOptions` (`backend/api/src/instance-options-store.ts`),
  threaded through `UnitTemplateOptions`/`renderUnitFile`
  (`backend/api/src/unit-template.ts`) and every call site in
  `instance-service.ts`, following the exact same opt-in, per-instance,
  never-defaulted pattern `jsonLogging` already established — this is
  never turned on implicitly, since the panel has no way to know what
  account an operator's deployment actually uses. A new "Service account"
  section in the frontend (`InstanceServiceAccount.tsx`, next to the
  existing Logs/JSON-logging section) edits both fields and warns inline
  when the instance's config sets `control_socket_path` but no account is
  configured — the exact failure mode this closes.

## [0.4.80] - 2026-08-06

### Added

- **`reserve_inputs` mixer config field, matching the RTLSDR-Airband fork's
  `dynamic_reload` branch fix for a mixer-input live-append data race.**
  The fork's `mixer_connect_input()` used to grow a mixer's input array
  with an unconditional `realloc` that was only safe during single-threaded
  startup — a real use-after-free once a dynamically-appended channel's
  `type: "mixer"` output could reach it post-startup via `reload_diff`.
  The fix sizes headroom upfront via a new mixer-level `reserve_inputs`
  int (default 0), finalized once after startup connections, mirroring
  `reserve_channels`' device-level headroom model. `reserve_inputs` is now
  modeled end-to-end: parsed/serialized in `backend/parser`, validated in
  `backend/validate` (negative values rejected as errors, matching the
  fork's own startup-time rejection), and editable per mixer in the
  frontend's MixerEditor, right alongside Highpass/Lowpass.

## [0.4.79] - 2026-08-04

### Added

- **`reserve_channels` device config field, matching the RTLSDR-Airband
  fork's `dynamic_reload` branch support for live channel add.** The fork
  now lets an operator append a channel to a multichannel device's
  `channels` list and pick it up live via the existing `reload_diff`
  control-socket command (no restart), as long as the device was started
  with spare `reserve_channels` headroom and the addition is a pure tail
  append. `reserve_channels` is now modeled end-to-end: parsed/serialized
  in `backend/parser`, validated in `backend/validate` (negative values,
  and non-zero values on scan-mode devices, are rejected as errors —
  matching the fork's own startup-time rejections), and editable per
  multichannel device in the frontend's DeviceEditor. The Apply live
  button's confirm-dialog copy and the `dynamic_reload` README section are
  updated to reflect that channel-count changes are no longer always
  restart-only.

## [0.4.77] - 2026-08-04

### Changed

- **Reverted `send_tx_tags` (v0.4.75) from this branch.** It was mistakenly
  committed to `dynamic_reload` instead of `master` — it's unrelated to
  this branch's `reload_diff` work. Landed on `master` instead as v0.4.76.

## [0.4.74] - 2026-08-02

### Added

- **README section documenting this branch's `dynamic_reload` integration.**
  A new top-level "🧪 `dynamic_reload` branch" section explains the
  `control_socket_path`/`enabled` config fields, the new Apply live button,
  what's deliberately out of scope (the control socket's five other
  live-control commands), and that this branch requires an RTLSDR-Airband
  build from the fork's `dynamic_reload` branch specifically.

## [0.4.73] - 2026-08-02

### Added

- **`dynamic_reload` branch: initial support for the RTLSDR-Airband fork's live
  retune/reconfiguration control socket, via its `reload_diff` command.** The
  fork's `dynamic_reload` branch adds a same-host-only Unix domain control
  socket (gated behind a new `control_socket_path` config option) so a running
  instance can pick up some config changes without a full systemd restart.
  This is a **separate long-lived branch, not merged to `master`** — the fork
  feature itself isn't upstream yet, and the socket protocol is not something
  older/non-fork rtl_airband builds understand.
  - New `control_socket_path` top-level config field, and a new per-channel/
    per-mixer `enabled` field (distinct from the existing `disable`: `disable`
    permanently skips allocating the channel/mixer, `enabled = false` still
    allocates it but starts it live-off so it can be toggled on later without
    a restart). Both round-trip through the parser and are editable in the UI.
  - New `POST /instances/:name/apply-live` endpoint and matching **Apply
    live** button (shown only when the instance's saved config has
    `control_socket_path` set): writes the config, then asks the running
    process's control socket to live-apply whatever it safely can via
    `reload_diff`, reporting back what applied vs. what still needs a restart.
    Falls back gracefully (saves to disk, same as a restart-free save) if the
    socket is unreachable or the running process doesn't support it.
  - New `backend/api/src/control-socket/` module (`UnixControlSocketClient`)
    speaks the fork's newline-delimited JSON wire protocol directly; no
    privileged proxy needed since the panel's backend runs as the same uid as
    the rtl_airband instances it manages.
  - Deliberately out of scope for this branch: the control socket's other five
    commands (`retune`, `set_gain`, `set_bandwidth`, `channel_enable`/
    `channel_disable`, `mixer_enable`/`mixer_disable`) and any granular
    per-field live-control UI — only the coarser `reload_diff` path is wired
    up for now.
## [0.4.78] - 2026-08-04

### Changed

- **Icecast output form layout.** "Send tx tags" now sits to the left of
  "Send scan freq tags", and both checkboxes are grouped in the same row
  as the TLS dropdown (vertically centered against it) instead of
  "Send tx tags" falling into its own row below. Purely visual — no
  effect on the underlying config or validation.

## [0.4.76] - 2026-08-04

_Note: v0.4.73–v0.4.75 are used by the separate `dynamic_reload` branch
(not merged to `master`); this branch's version jumps from 0.4.72 to
0.4.76 to keep `vX.Y.Z` tags globally unique across both lines._

### Added

- **`send_tx_tags` icecast output option.** Supports the fork's new
  per-transmission Icecast metadata tagging (PR #16): pushes a channel's
  (or, for a mixer, whichever source channel is currently talking)
  configured label as the stream's title metadata when a transmission
  starts, clearing it when it ends. Independent of the existing
  `send_scan_freq_tags` and works on plain multichannel channels and
  mixers — rejected by a new validation check when set on a scan-mode
  channel's icecast output, mirroring the fork's own config-parse-time
  rejection.

## [0.4.72] - 2026-08-01

### Fixed

- **Stats page showed a flood of tiles, one per channel per output-failure
  metric.** v0.4.71 gave `output_overrun_count`/output-failure counters a
  collapsed per-mixer card when labeled `{mixer, output}`, but the
  `{device, channel, output}`-labeled variant (a channel's own
  icecast/file/lame/udp_stream/pulse output with no mixer involved) still
  fell through to the generic flat `StatTile` grid -- with several channels
  each reporting several of these counters, that grid exploded into dozens
  of tiles. `MixerStats` is renamed `OutputStats` and now groups all three
  shapes (mixer, device+channel, and the label-less process-wide
  `rdio_scanner_*` counters) into the same collapsed-by-default,
  expand-for-detail cards, so the Stats page scales with channel count
  again instead of channel count × metric count.

## [0.4.71] - 2026-08-01

### Added

- **Output-failure counters from the RTLSDR-Airband fork's "failure/health
  counters for every output type" change** (`icecast_disconnect_count`,
  `icecast_backlog_exceeded_count`, `lame_encode_failure_count`,
  `file_write_failure_count`, `udp_stream_dropped_packet_count`,
  `pulse_underflow_count`, `pulse_overflow_count`, `pulse_disconnect_count`,
  `rdio_scanner_queue_drop_count`, `rdio_scanner_upload_failure_count`) are
  now recognized throughout the panel. `InstanceStatsSummary` gains a new
  `outputFailureTotal` field (sum of the actual-failure subset, excluding
  the backlog-exceeded/underflow/overflow counters that are subsets or
  expected under normal load) shown as a new **Output failures** column on
  the landing-page instance health dashboard. Every new metric also has a
  tooltip on the Stats page.

### Fixed

- **Mixer-attached output counters (icecast/lame/file/udp_stream/pulse) were
  silently dropped from the Stats page.** Any sample carrying a `mixer`
  label was routed to `MixerStats` for its own section, but `MixerStats`
  only recognized `output_overrun_count`/`input_overrun_count` and threw
  everything else away. Mixer cards now show every other mixer/output
  counter in their expanded view, plus a collapsed-state failure count.
- **`StatTile`'s label/sublabel overlapped and wrapped illegibly for
  device+channel+output-labeled samples** (e.g. `Udp Stream Dropped Packet`
  paired with `Channel 0, Device 0, Output 1`) -- the fixed-width sublabel
  forced the label into a narrow column, wrapping every word onto its own
  line. Surfaced by testing the new output-failure counters, the first
  metrics to combine a long title with a long device+channel+output
  sublabel in the generic tile fallback. The top row now wraps the sublabel
  onto its own line instead of squeezing the label.

## [0.4.70] - 2026-08-01

### Changed

- **Device-counter tile layout on the Stats page.** `StatTile` and
  `BufferHealthTile` now put the device/mixer sublabel (e.g. "Device 0") on
  the same top row as the stat name instead of below the value, freeing the
  bottom of the tile for the number itself.
- **`process_cpu_seconds_total` is now rounded to the nearest hundredth on
  the Stats page** (`formatCpuSeconds()`, already used for the same metric
  on the landing-page dashboard since v0.4.69), instead of showing the raw
  unrounded value.

## [0.4.69] - 2026-08-01

### Added

- **CPU (s) column on the landing-page instance health dashboard.** `InstanceHealthOverview`
  now shows each instance's `process_cpu_seconds_total`, rounded to the nearest hundredth
  (`formatCpuSeconds()` in `stats-format.ts`), rendered neutral (not amber-highlighted --
  it's informational, not a problem counter) and as "—" for instances whose build doesn't
  report it yet.

### Changed

- **Combined `buffer_overflow_count` and `buffer_underrun_count` into one "Buffer Health"
  tile per device on the per-instance Stats page**, instead of two separate tiles a reader
  had to mentally correlate -- the two are meant to be read together (see the v0.4.68
  tooltip note: a device where Underrun goes flat while Overflow climbs signals CPU
  saturation rather than USB/host starvation). New `BufferHealthTile` component; the
  combined description lives in `BUFFER_HEALTH_TOOLTIP` (`stats-descriptions.ts`).
- **Both counters in that tile render compactly** (`formatCompactCount()`, e.g. `48213` ->
  "48.2K", `1432905` -> "1.4M") with the exact value one hover away via a tooltip
  (`exactCount()`, thousands-separated). `buffer_underrun_count` in particular is expected
  to climb continuously under healthy operation (see its tooltip), so on a long-uptime,
  rarely-restarted instance the raw counter would otherwise grow into an unreadable
  multi-million-value string.

## [0.4.68] - 2026-08-01

### Added

- **Display support for the two new stats-file metrics added upstream in the
  `jschmall/RTLSDR-Airband` fork** (`buffer_underrun_count{device}` and the
  label-less `process_cpu_seconds_total`, commit `3babde1`). The stats
  pipeline (Prometheus-text parser, SQLite store, `/instances/:name/stats/*`
  API) is already metric-agnostic, so both flow through unchanged; this adds
  the presentation-layer pieces that are hand-authored per metric: tile
  tooltips in `stats-descriptions.ts` explaining what each one means
  (`buffer_underrun_count` climbs steadily under healthy load and should be
  read as a trend, not an absolute value -- correlate a flat trend against a
  climbing `buffer_overflow_count` to spot CPU saturation vs. USB/host
  starvation), and a `titleCaseMetric()` fix so a `_total`-suffixed metric
  name renders as "Process Cpu Seconds" instead of literally including
  "Total". `process_cpu_seconds_total` is also notable as the first
  label-less (non-device, non-channel) sample the Stats page's device-tile
  grid renders -- the existing generic rendering path already tolerated this
  correctly, so no frontend structural change was needed, just a test
  proving it. Deliberately not added to the landing-page
  `InstanceHealthOverview` rollup: that table's amber-on-nonzero styling is
  for problem counters, and `buffer_underrun_count` is expected to be
  nonzero constantly under normal operation, so it would flag every healthy
  instance.

## [0.4.67] - 2026-07-31

### Added

- **At-a-glance instance health dashboard on the landing page.** `WelcomePage`
  now renders `InstanceHealthOverview` -- a table of every managed instance
  (name, status, uptime, active-since, buffer overflows, output overruns) --
  instead of a static placeholder, when at least one instance exists (a
  brand-new deployment with zero instances still sees the original "select
  an instance"/"+ New instance" hints, centered). Status/uptime ride along
  on the already-polled shared instance list; the buffer-overflow/output-
  overrun columns poll the new `GET /instances/stats-summary` on the same
  `AUTO_REFRESH_MS` cadence used everywhere else. Both count columns render
  neutral at 0 and amber once nonzero, so problem instances stand out
  without scanning every row.
- **`frontend/src/lib/time-format.ts`.** `formatUptime()` (e.g. "3h 22m",
  "5d 1h", "—" if never active) and `formatDateTime()` (e.g.
  "2026-07-31 14:03", "Never" if unset) -- small, dependency-free
  formatters shared by the new dashboard.

This completes the landing-page instance health dashboard (#3) -- sections
A (v0.4.65) and B (v0.4.66) landed in prior commits.

## [0.4.66] - 2026-07-31

### Added

- **`GET /instances/stats-summary`.** A JSON sibling of `GET /metrics`:
  one call returns every managed instance's rolled-up problem-metric
  totals -- `bufferOverflowTotal` (sum of `buffer_overflow_count` across
  all devices), `outputOverrunTotal` (sum of `output_overrun_count`
  across *both* device- and mixer-labeled series -- RTLSDR-Airband emits
  this metric either way depending on whether a mixer feeds that
  device's output), and `inputsDroppingCount` (count of
  `input_overrun_count` series currently nonzero, not their sum).
  `StatsService.latestSummaries()` reuses the same
  `configStore.list()` + `statsStore.latest(name)` loop `metricsText()`
  already runs. `stats-summary` is reserved alongside `export`/`import`/
  `restart-pending`/`health` so it can never collide with a real
  instance name.

Section B of the landing-page instance health dashboard (#3) -- the
dashboard UI itself lands in a follow-up commit.

## [0.4.65] - 2026-07-31

### Added

- **`UnitStatus.activeEnterTimestamp`.** Both `SudoSystemctlAdapter` and
  `MockSystemdAdapter` now report when a unit last transitioned to active --
  the same underlying data point as both "uptime" (`now - this`) and "last
  (re)started at". `SudoSystemctlAdapter` requests `ActiveEnterTimestamp`
  alongside the existing `ActiveState`/`SubState` properties and parses
  systemd's raw timestamp format into ISO 8601, falling back to `undefined`
  on an empty (never-active) or unparseable value. `MockSystemdAdapter`
  stamps a fresh timestamp on `start()`/`restart()` and preserves the
  previous one across `stop()`, matching real systemd (which doesn't clear
  `ActiveEnterTimestamp` when a unit stops).
- **`InstanceSummary.status`.** `GET /instances` (`InstanceService.listInstances()`)
  now includes each instance's systemd status, fetched via one batched
  `statusMany()` call for the whole list rather than one call per instance --
  same reasoning as `getAllHealth()`'s existing batching (v0.4.64): avoids
  reintroducing N `sudo systemctl show` invocations per request.

### Changed

- **`InstanceSidebar` reads status from the shared instance list** instead
  of polling `GET /instances/health` separately -- now that `GET /instances`
  carries status directly, the sidebar's own fetch was a redundant second
  request every refresh cycle. `GET /instances/health` /
  `InstanceService.getAllHealth()` remain as a standalone endpoint for other
  callers.

First step of the landing-page instance health dashboard (#3, section A) --
the dashboard itself lands in a follow-up commit.

## [0.4.64] - 2026-07-31

### Added

- **`RTL_PANEL_LOG_FILE` / `--log-file`.** The panel's own Pino logger can
  now write NDJSON to a definable file path instead of stdout. Only
  relocates the panel's own request/audit/warn/error logging -- it has no
  effect on `sudo`'s own PAM session-accounting lines under `sudo` systemd
  mode, since those are written by the OS's `sudo`/PAM stack directly to
  syslog, independent of the panel's process.

### Changed

- **Batched the sidebar's background health poll into one `sudo systemctl
  show` call per cycle instead of one per instance.** Previously, every
  ~20s refresh fanned out `GET /instances/:name/health` once per instance
  (`InstanceSidebar.tsx`), and under `sudo` systemd mode each of those was
  its own `sudo systemctl show <unit>` subprocess -- with N instances, that
  meant N sudo invocations every poll cycle, each logging its own PAM
  session-open/session-close pair plus a command-audit line to syslog (3N
  lines per cycle). `SystemdAdapter` gained `statusMany(units)`, backed in
  `SudoSystemctlAdapter` by a single `systemctl show unit1 unit2 ...` call
  (systemd prints each unit's properties back-to-back, in argument order,
  separated by a blank line), and a new `GET /instances/health` /
  `InstanceService.getAllHealth()` return every instance's status in one
  response. The sidebar now calls that once per refresh instead of fanning
  out -- syslog volume from this path no longer scales with instance count.

## [0.4.63] - 2026-07-31

### Reverted

- **Reverted v0.4.62's channel drag-handle alignment change.** That fix
  measurably centered the handle against the title, but the user
  preferred the channel list's previous look and asked to put the
  broader alignment/padding cleanup on hold. `Collapsible.tsx`,
  `ChannelEditor.tsx`, and `DeviceEditor.tsx` are back to their v0.4.61
  state (the `dragHandle` slot on `Collapsible` is gone).

## [0.4.62] - 2026-07-31

### Fixed

- **Channel drag handle is now exactly centered against its channel's title,
  at any header height.** It previously lived in a sibling column outside
  the channel's card (`DeviceEditor.tsx`), vertically positioned by a
  hand-tuned margin measured against one specific (collapsed, single-line)
  row height -- confirmed via real pixel measurement to be off by several
  pixels, and it would have drifted further whenever a header wrapped to
  two lines or the channel was expanded, since the margin was fixed but
  the sibling row's height wasn't. `Collapsible` (shared by every
  Device/Channel/Output/Mixer header) now takes an optional `dragHandle`
  slot rendered inside its own header row, so it's `items-center`-aligned
  with the title by the same flexbox that already aligns everything else
  in that row -- correct by construction, not by tuning. Verified live:
  0px difference between the handle's and title's vertical centers, both
  collapsed and expanded.

## [0.4.61] - 2026-07-31

### Changed

- **README caught up to recent functionality.** Added: the mobile/tablet
  responsive layout (Section M), instance create/rename/delete as an
  Operations feature (renaming/deleting restarts or stops the unit, and
  the panel warns first), the structured JSON log format toggle, the
  RTL-SDR sample-rate range check, and the fork's optional
  `stats_http_address`/`stats_http_port` HTTP endpoint (a separate
  mechanism from the panel's own disk-polling). Also fixed two stale
  "requires the `rdio_api` branch" references — that branch was merged to
  the fork's `main` a while ago; it now just says "this fork" (which is
  what the link already pointed to).

## [0.4.60] - 2026-07-31

### Changed

- **Raised the mutating-route rate limit from 20/min to 60/min.** This
  tier (`MUTATING_ROUTE_OPTS` in `backend/api/src/routes.ts`) covers
  save/restart/rename/create/delete/bulk-restart/import/options-patch,
  and — since Fastify registers one parameterized route per action, not
  one per instance name — each action's budget is shared across every
  instance in the deployment, not per-instance. 20/min was too tight for
  legitimate multi-instance batch work (restarting most of a ~12-instance
  deployment in one sitting, or several saves during a tuning session);
  60/min gives real headroom for that while still tripping within
  seconds on an actual runaway or malicious client. The global read-only
  tier (300/min) is unchanged.

## [0.4.59] - 2026-07-31

Section M, Phase 4 (GitHub issue #2) -- the last phase of the mobile
layout plan.

### Changed

- **Channel drag-and-drop now has a real touch input path.** Replaced the
  single `PointerSensor` with separate `MouseSensor`/`TouchSensor`
  registrations so each input modality gets its own activation
  constraint -- touch gets a 150ms press-and-hold + 5px tolerance (so a
  vertical swipe-to-scroll on the channel list isn't mistaken for a
  drag-start), mouse keeps the existing instant 4px-distance constraint.
  Registering `PointerSensor` alongside a `TouchSensor` was considered and
  rejected: modern touchscreens fire both pointer and touch events for
  the same gesture, so the two sensors would race for the same
  interaction rather than cleanly dividing the work. Also enlarged the
  drag handle's padding (`p-2` → `p-3`) closer to the ~44px touch-target
  guideline. Verified live with both real mouse-drag (regression check)
  and emulated touch-drag (Chromium touch events via CDP) reordering
  channels correctly.

This closes out Section M -- all four phases of the mobile-friendly
layout plan (issue #2) are shipped.

## [0.4.58] - 2026-07-31

Section M, Phase 3 (GitHub issue #2) -- the largest phase of the mobile
layout plan: the sidebar is now reachable below `md:`.

### Added

- **Sidebar → slide-over drawer below `md:`.** The fixed-width resizable
  sidebar (`TwoPaneLayout.tsx`) is now entirely absent from the layout
  below `md:` (not just visually hidden) and replaced by a hamburger
  button in the header (new, `App.tsx`) that opens `InstanceSidebar.tsx`
  -- unchanged -- inside a slide-over drawer with a dimming backdrop.
  Closes three ways: the drawer's own ✕ button, clicking the backdrop, or
  Escape (which also returns focus to the hamburger, matching
  `PendingRestartIndicator`'s existing popover convention); also
  auto-closes on any route change, so picking an instance from the drawer
  takes you straight to it. New `frontend/src/state/MobileNavContext.tsx`
  shares the open/closed state between the header (which owns the
  hamburger) and `TwoPaneLayout` (which owns the drawer) -- they aren't
  otherwise in a parent/child relationship, since the header sits above
  the routed `<Outlet>`. No open/close animation for now -- immediate
  show/hide, kept deliberately simple with no new transition/animation
  pattern introduced for a single call site.

## [0.4.57] - 2026-07-31

Section M, Phase 2 (GitHub issue #2): the top header now stacks below
`md:` instead of squeezing the search box down to nothing.

### Changed

- **Header/search now stack on narrow viewports.** Below `md:`, the
  actions row (pending-restart pill + search) drops to its own full-width
  line under the title instead of sharing a row with it; the search input
  grows to fill that row (`min-w-0 flex-1`) instead of staying pinned at
  a fixed 192px. Unchanged at `md:` and wider -- single row, search back
  to its fixed compact width next to the pill. No hamburger/nav control
  added yet -- that's Phase 3, once there's an actual drawer for it to
  open.

## [0.4.56] - 2026-07-31

Section M, Phase 1 (GitHub issue #2): the app's dense field grids are now
responsive below a single `md:` (768px) breakpoint -- the first step
toward a usable mobile layout, ahead of the sidebar/header work in the
phases that follow.

### Added

- **Responsive grid constants** (`responsiveGrid2`/`3`/`4` in
  `frontend/src/components/styles.ts`) swapped into the ~15 non-responsive
  `grid-cols-2/3/4` occurrences across `ChannelEditor`, `ScanChannelEditor`,
  `OutputEditor`, `DeviceEditor`, `MixerEditor`, and (by hand, since their
  gap/container classes don't cleanly fit the shared constants)
  `ConfigEditor`'s two global-settings grids. Stacks to one column below
  `md:` (two, for the densest 4-up channel-field grid, since those labels
  are short enough to still read fine 2-across even on a phone);
  unchanged at `md:` and wider.

### Fixed

- **Every `Collapsible` header (Device/Channel/Output/Mixer/Logs) could
  squeeze its own title button to zero width on a narrow viewport.**
  Found empirically while testing Phase 1 at real phone/tablet widths, not
  in the original design review: the header row's `headerActions` cluster
  (Disable checkbox + Duplicate/Remove buttons) had no wrap strategy, so
  on a narrow screen it could force the adjacent `flex-1` title button
  down to 0px -- unclickable and invisible, not just cramped. Added
  `flex-wrap` to `Collapsible`'s header row (one shared fix for every
  caller) and to five other section-header rows with the same unwrapped
  `flex items-center justify-between` shape (`ConfigEditor`'s
  Devices/Mixers headers, `MixerEditor`/`ScanChannelEditor`/`ChannelEditor`'s
  Outputs headers, `InstanceEditPage`'s title row). Also fixed
  `DeviceEditor`'s channel-filter input, which had a fixed `w-56` that
  caused real horizontal overflow rather than wrapping; it's now
  `w-full sm:w-56`.

## [0.4.55] - 2026-07-31

### Added

- **RTL-SDR sample rate is now a dropdown of common rates (in MSPS), not a
  free-text Hz field.** Researched against librtlsdr's own documented valid
  ranges (rtl-sdr.h: 225001-300000 Hz or 900001-3200000 Hz, with a dead zone
  in between that the driver rejects) and RTLSDR-Airband's `input-rtlsdr.cpp`
  (which does no upfront validation itself -- it just passes the value
  through to the driver). The dropdown offers a curated list of common
  in-range rates plus "Default" and "Custom…" (free-text, for any other
  in-range value); selecting a value outside the curated list keeps the
  field in Custom mode rather than snapping back. MiriSDR and SoapySDR keep
  today's plain Hz free-text field unchanged -- MiriSDR has no documented
  valid-rate range in either this project or the RTLSDR-Airband fork, and
  SoapySDR's valid rates are proven hardware-dependent
  (`input-soapysdr.cpp` queries `SoapySDRDevice_getSampleRateRange` against
  the live connected device), so no fixed list is possible without hardware
  access this panel doesn't have.
- **New backend validation: RTL-SDR sample_rate in librtlsdr's dead zone is
  now a save-blocking error**, not just the existing `> 16000` floor check
  (which is a RTLSDR-Airband-imposed floor, unrelated to and much looser
  than librtlsdr's own hardware constraint). `RTLSDR_SAMPLE_RATE_DEAD_ZONE`/
  `RTLSDR_COMMON_SAMPLE_RATES_HZ` (`backend/validate/src/rtlsdr-defaults.ts`)
  are shared between this new check and the frontend dropdown, so they can't
  drift apart. MiriSDR/SoapySDR are deliberately exempt from the new
  dead-zone check, for the same reason they keep free-text input.

## [0.4.54] - 2026-07-31

### Added

- **Duplicating a channel now briefly highlights the new copy.** A bright
  ring appears around the just-duplicated channel's box so it's obvious
  which one is new among the rest of the list, fading out after ~2.5s.
  Scoped to channel duplication only (not device/mixer/output).

### Changed

- **Renaming an instance now warns that it restarts the instance.** Rename
  had no confirmation at all, unlike every other restart-triggering action
  in the app (delete, restart, save-and-restart, the JSON-logging toggle) --
  `renameInstanceLocked` unconditionally stops the old unit and starts the
  new one whenever the name actually changes. The new confirm only fires
  when the name is actually changing, matching the backend's own no-op
  short-circuit for an unchanged name.

## [0.4.53] - 2026-07-31

### Fixed

- **"Copy to channel…" now matches the Escape-to-dismiss / focus-return
  convention every other popover in the app follows.** The inline picker
  (added v0.4.32) had no keyboard dismissal and no `aria-expanded`/
  `aria-haspopup` on its trigger, unlike the Tooltip and pending-restart
  popover conventions established in the accessibility pass (v0.4.21).
  Escape now closes it and returns focus to the "Copy to channel…"
  button (same as Confirm/Cancel), clicking outside the output's own
  action row closes it too, and the picker row itself is now an
  `aria-label`led `role="group"`. Verified live: opens, Escape closes it,
  and focus lands back on the trigger.

## [0.4.52] - 2026-07-31

### Fixed

- **The streaming log viewer's connection state is now announced to
  screen readers.** Added `role="status"`/`aria-live="polite"` to the
  Connecting…/● Live/Reconnecting…/Connection failed label (added
  v0.4.39), which previously had no ARIA wiring at all. Deliberately not
  applied to the scrolling log buffer itself, which would announce every
  streamed line -- it keeps its existing (silent) default and gained only
  a plain `aria-label` for context.

## [0.4.51] - 2026-07-31

### Fixed

- **Channel drag-and-drop reordering is now keyboard-operable.** The
  `@dnd-kit` sortable list (added v0.4.38) only registered a
  `PointerSensor` -- a keyboard-only user had no way to reorder channels
  at all. Added a `KeyboardSensor` (Tab to a channel's drag handle, Space
  to pick up, arrow keys to move, Space to drop), verified live end to
  end. Also enlarged the drag handle's touch/click target with padding,
  which was previously a bare glyph well under typical hit-target
  guidance.

### Added

- **Test coverage for two previously-implicit safety guarantees.** A
  concurrent config save and options patch on the same instance already
  serialized correctly through the per-instance `KeyedMutex`, but nothing
  proved it -- added a `concurrency.test.ts` case firing both at once and
  checking neither's on-disk state (config, options, pending-restart flag)
  came out corrupted. Also added rate-limit-tier assertions confirming
  `/logs` stays on the global (300/min) tier while the mutating
  `PATCH /options` route is on the tighter (20/min) tier, same as every
  other config-mutating route.

## [0.4.49] - 2026-07-31

### Changed

- **`/logs` and `/logs/stream` now match the audit-logging and
  error-handling conventions every other route already follows.** Both
  read a systemd unit's journal, the same sensitivity class as
  `/instances/:name/secrets`, but neither logged an audit line. Added one
  on a successful one-shot fetch and on opening/closing the SSE stream
  (success and failure). `/logs/stream`'s error path was also
  self-contained by necessity (the reply is hijacked before
  `installErrorHandler` could ever see a thrown error), so a failed
  `journalctl` invocation silently lost its exit code/stderr detail that
  every other route's `CommandError` handling surfaces -- the SSE
  `stream-error` payload now includes them too, and the failure is logged
  server-side the same way `installErrorHandler` logs any other
  `CommandError`.

## [0.4.48] - 2026-07-31

### Fixed

- **Fixed silent secret cross-contamination when an output or mixer was
  duplicated, copied, or removed.** `backend/api/src/secrets.ts` already
  paired channels across an edit by frequency (added for channel
  drag-and-drop) so reordering couldn't misattribute a still-redacted
  Icecast password or rdio-scanner API key -- but outputs within a
  channel/mixer, and mixers themselves, were still paired by raw array
  index. "Duplicate output", "Copy to channel…", and "Remove output" all
  insert/delete at an index, shifting every later output -- so saving
  could silently swap an *unrelated, untouched* output's real secret onto
  the wrong output, or blank it, not just leave the new copy blank as the
  older known issue (v0.4.32) described. Fixed by having the frontend
  stamp each output with its load-time array position (`_matchIndex`,
  `frontend/src/lib/keys.ts`), explicitly marked as "no match" on every
  duplicate/copy so a copy can never inherit a stranger's secret; mixers
  are now matched by their real `name` field instead of position, mirroring
  the channel fix. Backward compatible: a request that omits
  `_matchIndex` entirely still falls back to today's positional pairing.

### Fixed

- **Stats-page channel dropdown now matches the instance view's channel
  order.** `discoverChannels` in `StatsPage.tsx` was re-sorting the channel
  list by ascending frequency, so a channel reorder made in the instance
  editor (which is array-order, saved and serialized to the `.conf` file
  as-is -- see `DeviceEditor.tsx`'s drag-and-drop and the parser's
  `serializeList`) would never be reflected in the stats dropdown even
  after saving and restarting. The stats samples RTLSDR-Airband writes are
  already in the process's channel-definition order, so the fix is to stop
  re-sorting and just preserve first-seen sample order.

## [0.4.46] - 2026-07-30

### Changed

- **Documented why the panel doesn't use the fork's new SIGHUP reload.**
  The jschmall/RTLSDR-Airband fork added a re-exec-based SIGHUP reload in
  some builds, but the panel has no way to know which binary a given
  instance is actually running -- sending SIGHUP (or adding `ExecReload=`)
  on that assumption would kill a vanilla-upstream instance outright, since
  units are `Restart=no`. CLAUDE.md's existing "never assume a signal or
  socket-based reload path exists" architecture constraint now says so
  explicitly, so the reasoning stays discoverable instead of only living in
  this version's PR history. No code changes -- restart-only remains the
  only lifecycle operation the panel performs, for every instance
  regardless of build.

## [0.4.45] - 2026-07-30

### Added

- **New `fixtures/fork-features.conf` fixture and round-trip/validate
  coverage.** The only existing fixture, `151719.conf`, exercised none of
  `rdio_scanner`, `bit_depth`, or `mixers` -- meaning none of the fork-only
  config surface (existing or added over the last several versions) had
  fixture-based round-trip coverage, only inline synthetic TS objects in
  test files. The new synthetic (not from a real deployment), sanitized
  fixture exercises an `rdio_scanner` output block, a `udp_stream` output
  with `bit_depth` and `sample_rate`, a `mixers` block, and the
  `stats_http_address`/`stats_http_port`/`rdio_scanner_queue_depth` globals
  together in one config, with matching round-trip tests in
  `backend/parser` and a `validateConfig` no-errors test in
  `backend/validate`.

## [0.4.44] - 2026-07-30

### Added

- **Structured JSON logging toggle per instance.** Tracks the
  jschmall/RTLSDR-Airband fork's new opt-in `-j` flag (single-line JSON log
  records instead of plain text). Since `-j` is a CLI flag, not a `.conf`
  key, it's tracked in a new panel-only `InstanceOptionsStore` sidecar file
  (mirroring `PendingRestartStore`'s pattern) rather than the domain model —
  the panel never reads back an installed unit file's content, so this had
  to be durable on its own. A new "JSON logging" toggle on the instance edit
  page's Logs section (`PATCH /instances/:name/options`) regenerates and
  reinstalls the unit with `-j` added/removed, marks the instance
  pending-restart, and restarts by default (same as a config save). The log
  viewer parses each line as the fork's JSON record when enabled, falling
  back to plain text otherwise — every instance defaults to off, so nothing
  changes unless explicitly opted into.

## [0.4.43] - 2026-07-30

### Added

- **New fork-only `sample_rate` field on `udp_stream` outputs.** Tracks the
  jschmall/RTLSDR-Airband fork's new configurable udp_stream resampling:
  omitted (or set equal to the device's own sample rate) sends unresampled
  audio at no extra cost; setting it to a different rate resamples before
  sending. Applies to both device/channel-routed and mixer-routed
  `udp_stream` outputs, since it's a field on the shared output type. A new
  `checkUdpStreamSampleRate` validation mirrors the fork's own `> 0` check.
  Optional and omitted from the serialized `.conf` when unset, so
  vanilla-upstream deployments are unaffected.

### Changed

- **`bit_depth`'s doc comment now flags it as fork-only**, matching
  `rdio_scanner`'s existing annotation — it previously read as if it were a
  standard upstream RTLSDR-Airband field, which it isn't.

## [0.4.42] - 2026-07-30

### Changed

- **Hardened rdio_scanner validation to match the fork's own startup
  checks.** The jschmall/RTLSDR-Airband fork now rejects three previously-
  silently-broken rdio_scanner configurations at process startup:
  `timeout_ms <= 0` (0 means libcurl never times out, hanging a worker
  thread indefinitely), `max_retries < 0`, and `rdio_scanner` set on a
  scan-mode device's channel (talkgroup_id/labels are fixed at config time
  and can't track which frequency is currently being scanned — mixer-routed
  rdio_scanner outputs are exempt, since mixers have no scan-mode concept).
  `checkRdioScanner` now catches all three in the panel UI before ever
  writing a config that would fail to start, plus a new bounds check on
  `rdio_scanner_queue_depth`. Purely additive: any config that was already
  valid stays valid.

## [0.4.41] - 2026-07-30

### Added

- **New fork-only global config fields: `rdio_scanner_queue_depth` and
  `stats_http_address`/`stats_http_port`.** Tracks two new features added
  in the jschmall/RTLSDR-Airband fork: `rdio_scanner_queue_depth` caps the
  max pending rdio-scanner uploads before new ones are dropped (defaults to
  64, matching the previous hardcoded constant it replaces); `stats_http_address`
  + `stats_http_port` (must be set together) enable an HTTP endpoint on the
  RTLSDR-Airband process itself serving the current contents of
  `stats_filepath` to any request — a separate mechanism from the panel's own
  stats polling, which still reads `stats_filepath` off local disk regardless.
  A new `checkStatsHttp` validation enforces both-set-together and a valid
  port range. Both fields are optional and omitted from the serialized
  `.conf` when unset, so vanilla-upstream RTLSDR-Airband deployments are
  unaffected.

## [0.4.40] - 2026-07-29

### Changed

- **Moved the Logs section above the device list.** It now renders between
  the global settings grid and "Devices" (previously it sat below the
  whole config editor, after Mixers). `ConfigEditor` gained an
  `afterGlobalSettings` slot so it stays purely about rendering the
  config model, without needing to know about the log viewer itself.

## [0.4.39] - 2026-07-29

### Changed

- **Log viewer now streams live instead of manual-refresh-only.** The
  "Logs" section on an instance's edit page now tails `journalctl -u
  <unit> -f` over Server-Sent Events, appending new lines as they're
  written instead of requiring a click to refresh. Backed by a new
  `GET /instances/:name/logs/stream` endpoint; the existing one-shot
  `GET /instances/:name/logs` is unchanged for anything still using it
  directly. The panel auto-scrolls to the newest line unless you've
  scrolled up to read history, and caps the in-browser buffer at 500
  lines. If you run this behind nginx or a similar reverse proxy, see
  the new "Running behind a reverse proxy" section in the README —
  proxy response buffering needs to be disabled for the stream to
  actually arrive live rather than in delayed bursts.

## [0.4.38] - 2026-07-29

### Added

- **Drag-and-drop channel reordering.** Channels within a device can now be
  dragged into a new order via a grip handle, which rewrites the order
  channels appear in the written `.conf` file (FFT bin assignment is purely
  a function of frequency/centerfreq/sample_rate, so reordering never
  requires bin recomputation). Outputs are not draggable, only channels.
  Fixed a related bug this surfaced: secret restoration on save
  (`restoreSecrets`) paired channels against the previous on-disk config by
  raw array index, so reordering channels before saving could splice an
  icecast password or rdio-scanner API key onto the wrong channel. Channels
  are now matched by frequency first, falling back to positional pairing
  only when a frequency isn't uniquely resolvable.
- **Per-instance journal log viewer.** A new "Logs" section on the instance
  edit page fetches the unit's recent `journalctl` output (via a new
  `GET /instances/:name/logs` endpoint, reusing the existing sudo-scoped
  systemd adapter) so you can confirm a device/channel loaded correctly
  after a restart. Fetches once when first expanded plus a manual Refresh
  button — no background polling.

## [0.4.37] - 2026-07-28

### Fixed

- **Validation banner leaked warnings/errors across instances.** Save,
  restart, and "Check config" results were kept in page-level state that
  was never reset or scoped to the instance that produced it, and the
  instance edit page doesn't remount when you switch instances (React
  Router reuses it, only the `:name` param changes). Save/restart instance
  A, get a warning, then navigate to instance B, and the banner kept
  showing A's warnings — mislabeled using B's freshly-loaded config, or
  overwritten by whatever B's own last check happened to be. Warnings,
  errors, and the saved-message banner now reset whenever the edited
  instance changes, and an in-flight save/check request whose instance no
  longer matches the page being shown is dropped instead of applied.

## [0.4.36] - 2026-07-28

### Added

- **Dedicated "Mixer stats" section on the stats page.** Mixer-labeled
  counters (`output_overrun_count{mixer=...}`, `input_overrun_count`) used
  to render alongside device counters as one `StatTile` per sample — fine
  for one or two mixers, but a mixer with a dozen inputs (a real config had
  11) buried the rest of the page in tiles. These now get their own section
  below the signal/squelch chart: one row per mixer, collapsed by default to
  a one-line summary (output overrun count, and how many of its inputs are
  currently dropping), expanding to a compact table of every feeding
  channel's overrun count with non-zero values highlighted.

## [0.4.35] - 2026-07-28

### Changed

- **Versioning convention tightened: every commit bumps the version.**
  Previously a version bump was a judgment call ("does this change deserve
  one?"), which is what let git tags silently drift behind package.json on
  two separate occasions (v0.4.24-27, then again v0.4.30-33 — both caught
  late and backfilled). From now on every commit bumps package.json in
  lockstep across the root and all workspaces, adds a CHANGELOG entry, and
  gets a pushed `vX.Y.Z` tag — no exceptions, no judgment call. Documented
  in CLAUDE.md's Conventions section.

## [0.4.34] - 2026-07-28

### Changed

- **Stats page resolves mixer input indices to channel names.** RTLSDR-Airband's
  stats file identifies mixers and mixer inputs by bare position (`mixer="0"`,
  `input="1"`), not name — so an instance with several channels feeding one
  mixer showed a pile of identically-titled "Input Overrun" tiles,
  differentiated only by raw index. The stats page now replays the same
  numbering RTLSDR-Airband itself uses (`config.cpp`'s
  `parse_mixers`/`mixer_connect_input`, skipping disabled devices/channels/
  outputs/mixers) against the instance's own config to resolve each tile's
  sublabel to the actual mixer name and feeding channel (e.g. "bcfy_1 —
  151.1900 MHz — CDF - Tac 4"), falling back to the raw indices if the config
  and running stats fall out of sync.

## [0.4.33] - 2026-07-28

### Added

- **`bit_depth` option for UDP stream outputs.** Matches the new
  `bit_depth` config field added upstream in this project's
  RTLSDR-Airband fork (32/16/8, defaulting to 32/float when unset). The
  UDP output editor now has a "Bit depth (optional)" dropdown alongside
  destination address/port and continuous, and the value round-trips
  through parsing, the API's JSON shape validation, and serialization
  back to the `.conf` file. An out-of-range value (anything other than
  32, 16, or 8) is rejected the same way an invalid Icecast `tls` value
  already is.

## [0.4.32] - 2026-07-28

### Added

- **"Copy to channel…" action on every output.** Re-entering the same
  Icecast/pulse/etc. settings by hand on every channel that needs them was
  the only option before. Each output editor (on a regular channel, a
  scan-mode channel, or a mixer) now has a "Copy to channel…" button that
  expands an inline picker listing every other channel on the instance
  (across all devices, including scan-mode channels) and appends a copy of
  the output's settings onto whichever one is selected. It only ever
  appends -- it never replaces an existing output -- mirroring how
  "Duplicate output" already behaves, just targeting a different channel
  instead of the same one.

### Known issue (pre-existing, not introduced by this release)

- Copying (or duplicating) an output whose Icecast password or
  rdio-scanner API key is still showing the redacted placeholder --
  i.e. hasn't been revealed via "Show" in this editing session -- saves
  the new copy with that field blanked out instead of the real secret.
  The backend's redaction-restore logic (`backend/api/src/secrets.ts`)
  matches redacted fields back to their real values positionally
  (device/channel/output index against the on-disk config), so any
  action that inserts an output at a new index -- "Duplicate output" has
  always had this same gap -- has nothing at that position to restore
  from. Tracked as a follow-up; fixing it properly means changing how
  secrets are matched back on save, not something to bundle into this
  change.

## [0.4.31] - 2026-07-28

### Changed

- **journalctl no longer gets a JSON line for every HTTP request.** The
  panel's own service logged via Fastify's default logger
  (`logger: true`), which emits an "incoming request"/"request completed"
  line per request -- at the frontend's 20-second polling cadence for the
  instance list and stats pages, this drowned the journal in noise with no
  way to turn it down. Request-level access logging is now off by default
  (`logController` with `disableRequestLogging`); the existing audit log
  (one line per mutating action), and warning/error logging, are
  unchanged. A new `RTL_PANEL_LOG_LEVEL` env var / `--log-level` flag
  (default `info`) controls the pino log level for further tuning. The
  example systemd unit now also sets `SyslogIdentifier=rtl-airband-panel`
  so the panel's journal entries are tagged distinctly from the generic
  `node` identifier, enabling `journalctl -t rtl-airband-panel`. No file
  logging under `/var/log` was added -- journald already owns rotation,
  and a new file would need its own logrotate config and permissions
  story for no real benefit over the level/identifier changes above.

## [0.4.30] - 2026-07-28

### Fixed

- **Saving a config with a mixer that nothing routes into is now rejected.**
  RTLSDR-Airband's mixer thread has nothing to write to a mixer with zero
  inbound channel outputs, and exits at startup -- but the validator only
  ever checked the *forward* direction (a channel output naming a mixer that
  must exist), never the reverse. A new `checkMixerUnused` check errors on
  any non-disabled mixer with no channel output routed into it, mirroring
  `checkMixerReferences` from the other side of the same edge. Disabled
  mixers are exempt, and a mixer whose own outputs are all disabled is left
  to the existing `checkDisableCascade` error rather than being flagged
  twice for the same root cause.

### Added

- **"Check config" button on the instance edit page.** The
  `POST /instances/:name/validate` endpoint already existed and ran the
  same validation a save would, without writing anything, but nothing in
  the UI called it. A new button next to Save / Save-and-restart lets you
  catch validation errors (including the new mixer-unused check above)
  before committing to a save that restarts the unit and interrupts live
  audio.

## [0.4.29] - 2026-07-27

### Fixed

- **Mixer definitions were written in a syntax RTLSDR-Airband can't parse.**
  The panel serialized top-level mixers as a `mixers: ( { name = "..."; ... } )`
  list, mirroring devices/channels/outputs, but RTLSDR-Airband actually
  expects `mixers` to be a *group* keyed by mixer name (`mixers: { mixer1:
  { ... } };`) with no `name` field inside -- so any mixer created or edited
  through the GUI produced a config that failed to load. The parser now
  reads and writes mixers in that group-keyed form; the JSON domain model
  (`Mixer.name`) is unchanged, only the .conf text shape. Verified against
  the `mixers.conf` and `big_mixer.conf` example configs from the upstream
  RTLSDR-Airband repo. Along the way, the parser was also tightened to
  accept `,` as a group-setting separator (not just `;`), since those same
  upstream example files use commas between sibling mixer definitions and
  libconfig accepts both.

## [0.4.28] - 2026-07-27

### Changed

- **Global search now matches frequency, modulation, and device identifiers,
  not just instance name and channel labels.** `GET /instances` replaces
  `channelLabels` with `searchFields` (channel labels, each channel's
  frequency formatted in MHz, modulation, and each device's `type`/`serial`),
  and the sidebar search filters against all of it -- e.g. typing `146.94`,
  `nfm`, or `rtlsdr` now surfaces the right instance, not just a label or
  name match. The "Matches: ..." line under a matched row is deduplicated,
  since a frequency or modulation (unlike most labels) can otherwise repeat
  once per matching channel on the same instance.

## [0.4.27] - 2026-07-27

### Fixed

- **Global search bar is now system-wide.** It previously matched only the
  instance name; typing a channel label (e.g. `CHP`, `CDF`) found nothing
  unless it happened to also be in the instance name. `GET /instances` now
  includes each instance's `channelLabels` (collected from both
  multichannel `label` and scan-mode `labels[]` fields), and the sidebar
  filter matches against name OR any channel label. When a match comes
  from a label rather than the name, the sidebar row shows which label(s)
  matched (`Matches channel: ...`) so it's clear why an instance with an
  unrelated name showed up -- e.g. a talkgroup like CHP or CDF split
  across several site instances.

## [0.4.26] - 2026-07-27

### Added

- **Screenshots** in the README: instance editor overview, a channel/output
  editor, and the stats page's signal-history chart. All three use the
  repo's existing sanitized test fixture (`fixtures/151719.conf`) as
  placeholder data, not a real deployment.

## [0.4.25] - 2026-07-27

General README polish pass.

### Changed

- **Testing section** was missing the `frontend` workspace's test command
  (added in Section I, v0.4.23) -- now lists all four, matching
  CONTRIBUTING.md.
- **`backend/validate`'s row** in the "How it's built" table only described
  3 of its 15 checks (frequency-in-window, FFT bin collisions, CTCSS) --
  now also mentions filter cutoff ordering, per-output-type constraints,
  and the standing `post_write_script` security warning.
- Added **CI and license badges** under the title, and **Contributing**/
  **License** sections at the bottom linking to `CONTRIBUTING.md` and
  `LICENSE` -- both existed since Section I but weren't referenced
  anywhere in the README.
- Minor wording fix in the Node 20 upgrade note.

## [0.4.24] - 2026-07-27

Section J from the project to-do list (GitHub issue #1): fixes and UX
requests from a user testing pass against the running v0.4.23 build.

### Fixed

- **False-positive `post_write_script` validation warning**: `checkPostWriteScript`
  flagged the field whenever it was present, but the parser passes an
  empty-string literal (`post_write_script = "";`) through as `""` rather
  than `undefined`, so a field that was present-but-empty in a real `.conf`
  still triggered the "runs an arbitrary command" warning even though no
  script would run. The check now treats an empty string as absent.
- **`file` output section layout**: checkboxes were interleaved between text
  fields (an odd number of checkboxes in a 2-column grid put one next to a
  text field), making the section look scattered compared to every other
  output type. `OutputEditor`'s shared field-rendering was split into a
  text-fields half and a checkbox-fields half so `FileFields` can group all
  of its checkboxes together, directly above the "Upload to rdio-scanner"
  checkbox.

### Added

- **Clickable pending-restart list**: each instance name in the
  pending-restart popover now links to that instance's edit page (still
  respecting the app's unsaved-changes guard), instead of being read-only
  text.
- **Dismiss control for instance-page warnings**: the warnings block in
  `ValidationBanner` now has a "Dismiss" action. Errors stay
  non-dismissible, since they mean the save was blocked. Dismissal is
  session-local to the current page load and is cleared again by the next
  save that still reports warnings -- a security-relevant warning like
  `post_write_script` can't be permanently silenced by dismissing it once.
- **Cross-instance search**: a search box in the top-right of the header
  filters the sidebar's instance list by name, with the pending-restart
  indicator moved to sit to its left.
- **Channel label in the header**: when a channel has a label set, it now
  shows next to the frequency in the channel's collapsed header. If the
  combined text is too wide for the header, it truncates with an ellipsis
  and becomes horizontally scrollable on hover instead of just clipping.

## [0.4.23] - 2026-07-26

Ninth and final batch from the full-system design review: docs & project
hygiene (Section I).

### Added

- **LICENSE** (GPLv2) and a matching `"license"` field in all 5
  `package.json` files. The panel doesn't embed or link against
  RTLSDR-Airband's own GPLv2 code, so this wasn't a legal requirement,
  but it's the license the project's author chose.
- **CONTRIBUTING.md**: setup, architecture constraints, testing/versioning
  expectations, and how to submit a change, distilled from CLAUDE.md into
  something meant for a human contributor rather than an agent.
- **Minimal CI** (`.github/workflows/ci.yml`): build + full test suite
  (all 4 packages, now including frontend) on every push/PR against
  `master`.
- **Frontend test suite**: Vitest + React Testing Library + jsdom
  (`frontend/test/`, mirroring the `frontend/src/` structure it covers).
  Starting coverage: `OutputEditor`/`DeviceEditor`'s type/mode
  value-memory caches, including a regression test for the v0.4.19
  remount bug (switching type used to tear down and remount the editor,
  silently resetting the Collapsible's open state and wiping the very
  cache under test).
- **README**: documented log rotation (journald owns it under the
  documented systemd unit; nothing rotates it if you run the panel
  directly/backgrounded instead) and stats-DB backup guidance (it's a
  regenerable rolling window, not authoritative state -- back it up if
  you want longer-lived history than your retention setting keeps).

### Fixed

- README's "Current scope" section still said scan-mode devices, the
  top-level `mixers:` list, and several per-channel options weren't
  modeled yet -- all of that shipped 12+ versions ago. Rewritten to
  describe what's actually covered today.

### Deferred

- Self-update/"you're behind" notice, broader fixture coverage beyond
  the one real sanitized `.conf`, and a real end-to-end test against
  actual systemd remain out of scope for this pass, per this item's own
  "lower priority" framing.

This closes out every section opened by the full-system design review
(issue #1) -- Sections A through I are all shipped as of this version.

## [0.4.22] - 2026-07-26

Eighth batch from the full-system design review: responsive / loading
states / code quality (Section H).

### Added

- **Retry after a failed fetch, instead of a dead end.** The instance
  edit page and the stats page both used to permanently replace their
  entire UI with a bare error line on a failed load, with no way back
  except navigating away and back. Both now show a Retry button (except
  where retrying can't help -- see below) plus a link back to the
  instance list.
- The instance edit page now distinguishes "this instance doesn't exist"
  (404 -- deleted or renamed elsewhere; no Retry button, since retrying
  the same request can't fix that) from every other failure (network
  error, 500, ...), which does get a Retry button.
- The stats page's background polling (added in Section F) could fail
  transiently -- e.g. a momentary network blip -- and, sharing the same
  error state as the page's initial load, this used to tear down the
  *entire* page, hiding the instance selector along with everything
  else, on every such blip. It now shows a small non-blocking warning
  banner above the still-usable page instead, and clears itself on the
  next successful poll (every 20s). Also fixed `loadHistory` having no
  error handling at all -- a failed history fetch was an unhandled
  promise rejection with no user-visible effect beyond a stale chart.

### Changed

- Deduplicated `OutputEditor`'s `file`/`rawfile` field sets, which were
  ~30 lines of near-identical JSX apart from `min_rx_seconds`,
  `post_write_script`, and the rdio-scanner block (only `file` has
  those) -- extracted into a shared `FileLikeFields` generic component
  used by both.

### Deferred

- Real mobile/responsive layout remains out of scope for this pass, per
  the design review's own "large, lower priority" framing -- the app is
  effectively desktop-only today (fixed sidebar, dense multi-column
  editor grids with no responsive variants).

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
