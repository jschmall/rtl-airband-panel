# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project doesn't publish to a registry, so versions are tracked via git tags
(`vX.Y.Z`) rather than npm releases. Versions before 0.3.0 predate this file.

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
