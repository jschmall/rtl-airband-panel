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

/** Tooltips for the Hardware page's per-SDR readings. */
export const HARDWARE_TOOLTIPS = {
  headroom:
    "How far the strongest sample the SDR's ADC produced in the last second sits below full scale. Near 0 dB the ADC clips, which smears strong signals into spurs across the whole band: lower the gain. Lots of headroom with a high noise floor is fine; lots of headroom with weak signals means there's gain to spare.",
  noiseFloor:
    "Median noise level across this SDR's enabled channels, in dB relative to ADC full scale. Watch it against headroom: raising gain lifts both, and past a point it only lifts the noise.",
  centerSpan: "Where the SDR is tuned and how much spectrum it captures (its sample rate). Every channel on this SDR must fall inside the span.",
  gain: "The gain the tuner actually applied (rtl-sdr rounds to its nearest supported step), or the configured value when live readings aren't available.",
  freqError:
    "How far received carriers sit from their configured frequencies, in parts per million: the median across this SDR's channels that have had a transmission. All channels on one SDR share its oscillator, so a consistent error here is that oscillator's drift. The suggested correction is the value to set, not an amount to add: it stays the same as you approach it (a partial change shrinks the error by the same amount) and turns into \"Correction OK\" once less than 0.75 ppm remains. Restart the instance after changing it, then give it a few transmissions to settle; a single off-frequency transmitter can't move the median.",
  dropped:
    "Times the SDR's sample buffer overflowed because rtl_airband couldn't keep up, losing samples. Any steady climb means the host is short on CPU or USB bandwidth.",
  clipped:
    "Samples where the ADC hit its full-scale limit. Occasional clipping on a strong nearby transmitter can be fine; a steady rate means the gain is too high.",
} as const;
