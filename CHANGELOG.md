# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project doesn't publish to a registry, so versions are tracked via git tags
(`vX.Y.Z`) rather than npm releases. Versions before 0.3.0 predate this file.

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
