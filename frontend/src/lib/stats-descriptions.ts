/** Plain-language descriptions for tile/chart tooltips, based on RTLSDR-Airband's wiki and stats HELP text. */

export const SNR_CHART_TOOLTIP =
  "Channel signal strength (dBFS) compared with the level required to open squelch. Squelch opens when the signal line rises above the threshold line — in automatic mode that's roughly 10 dB above the estimated noise floor.";

export const SQUELCH_OPENS_TOOLTIP =
  "Number of times squelch has opened (audio started passing through) on this channel since the process started.";

export const SQUELCH_FLAPS_TOOLTIP =
  "Number of times squelch has rapidly toggled open and closed on this channel. A high value usually means the signal is hovering right at the squelch threshold.";

export const CTCSS_TOOLTIP =
  "Fraction of monitoring windows in which the configured CTCSS tone was present. Squelch stays closed even on an active transmission if this tone isn't detected.";

const DEVICE_METRIC_TOOLTIPS: Record<string, string> = {
  buffer_overflow_count:
    "Number of times this device's sample buffer wasn't drained quickly enough. Non-zero values may indicate insufficient CPU power.",
  output_overrun_count: "Number of times a device or mixer output couldn't keep up and had to drop samples.",
  input_overrun_count: "Number of times a mixer input couldn't keep up and had to drop samples.",
  buffer_underrun_count:
    "Number of times this device's demod thread found insufficient input data and had to wait. Expected to climb steadily under normal, healthy load -- read as a trend, not an absolute value. A device where this goes flat while buffer_overflow_count climbs indicates the demod thread is CPU-saturated rather than starved for input.",
  process_cpu_seconds_total: "Total user and system CPU time consumed by this instance's process since it started, in seconds.",
  icecast_disconnect_count:
    "Number of times this icecast output's connection was lost (network error, exceeded send backlog, or the owning device failing) and had to be reconnected.",
  icecast_backlog_exceeded_count:
    "Subset of icecast_disconnect_count -- specifically caused by the local encode rate outpacing what Icecast could drain, rather than a network-level error.",
  lame_encode_failure_count: "Number of times mp3 encoding failed for this output. Only emitted for outputs that encode mp3 (icecast, file).",
  file_write_failure_count:
    "Number of times a short or failed write happened on this file/rawfile output (disk full, I/O error). The output is disabled when this happens, so a healthy instance should see this stay at 0.",
  udp_stream_dropped_packet_count: "Number of packets dropped by this udp_stream output's bounds checks instead of overrunning a buffer.",
  pulse_underflow_count:
    "Number of times this PulseAudio output stream underflowed (server drained the buffer faster than we fed it). Expected to increment frequently -- normal on squelch closing.",
  pulse_overflow_count: "Number of times this PulseAudio output stream overflowed (we fed data faster than the server drained it).",
  pulse_disconnect_count:
    "Number of times this PulseAudio output stream's write path (latency check or a failed write) forced a disconnect.",
  rdio_scanner_queue_drop_count:
    "Number of completed transmissions dropped because the shared rdio_scanner upload queue was full. Process-wide: every rdio_scanner-configured output shares one upload queue and worker thread.",
  rdio_scanner_upload_failure_count: "Number of rdio_scanner uploads that failed after exhausting max_retries. Process-wide, same reason as rdio_scanner_queue_drop_count.",
  centerfreq_retune_failure_count:
    "Number of times a live centerfreq retune (from the panel's Apply, or the fork's automatic frequency-hopping scan) failed at the hardware level. Does not mean the device stopped running -- only that this specific retune attempt didn't take effect. Expected to stay at 0 on healthy hardware; a climbing value points at a flaky tuner or i2c bus.",
};

export function deviceMetricTooltip(metric: string): string | undefined {
  return DEVICE_METRIC_TOOLTIPS[metric];
}

export const BUFFER_HEALTH_TOOLTIP =
  "Overflow counts times this device's sample buffer wasn't drained quickly enough (may indicate insufficient CPU power). Underrun counts times the demod thread found insufficient input data and had to wait -- expected to climb steadily under normal, healthy load, so read it as a trend rather than an absolute value. A device where Underrun goes flat while Overflow climbs indicates the demod thread is CPU-saturated rather than starved for input.";
