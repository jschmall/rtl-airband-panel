# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project doesn't publish to a registry, so versions are tracked via git tags
(`vX.Y.Z`) rather than npm releases. Versions before 0.3.0 predate this file.

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
