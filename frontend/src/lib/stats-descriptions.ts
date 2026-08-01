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
};

export function deviceMetricTooltip(metric: string): string | undefined {
  return DEVICE_METRIC_TOOLTIPS[metric];
}

export const BUFFER_HEALTH_TOOLTIP =
  "Overflow counts times this device's sample buffer wasn't drained quickly enough (may indicate insufficient CPU power). Underrun counts times the demod thread found insufficient input data and had to wait -- expected to climb steadily under normal, healthy load, so read it as a trend rather than an absolute value. A device where Underrun goes flat while Overflow climbs indicates the demod thread is CPU-saturated rather than starved for input.";
