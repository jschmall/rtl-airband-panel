/** "buffer_overflow_count" -> "Buffer Overflow", "channel_squelch_counter" -> "Squelch", "process_cpu_seconds_total" -> "Process Cpu Seconds" */
export function titleCaseMetric(metric: string): string {
  const stripped = metric.replace(/^channel_/, "").replace(/_(count|counter|total)$/, "");
  return stripped
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** {device: "0"} -> "Device 0", {mixer: "a", input: "1"} -> "Mixer a, Input 1" */
export function humanizeLabels(labels: Record<string, string>): string | undefined {
  const entries = Object.entries(labels);
  if (entries.length === 0) return undefined;
  return entries.map(([key, value]) => `${key.charAt(0).toUpperCase()}${key.slice(1)} ${value}`).join(", ");
}

/** process_cpu_seconds_total rounded to the nearest hundredth, e.g. 187.652341 -> "187.65". "—" if not yet reported. */
export function formatCpuSeconds(seconds: number | undefined): string {
  return seconds === undefined ? "—" : seconds.toFixed(2);
}

/**
 * Plain-English display names for device/output metrics that would otherwise
 * fall back to titleCaseMetric()'s naive title-casing (e.g. "Icecast
 * Disconnect Count") -- covers the metrics that show up in the Device
 * counters table and the Output stats cards.
 */
const FRIENDLY_METRIC_LABELS: Record<string, string> = {
  buffer_overflow_count: "Buffer overflows",
  buffer_underrun_count: "Buffer underruns",
  output_overrun_count: "Output overruns",
  centerfreq_retune_failure_count: "Retune failures",
  process_cpu_seconds_total: "CPU time (s)",
  icecast_disconnect_count: "Icecast disconnects",
  lame_encode_failure_count: "MP3 encode failures",
  file_write_failure_count: "File write failures",
  udp_stream_dropped_packet_count: "UDP packets dropped",
  pulse_disconnect_count: "PulseAudio disconnects",
  rdio_scanner_queue_drop_count: "rdio-scanner queue drops",
  rdio_scanner_upload_failure_count: "rdio-scanner upload failures",
};

/** Friendly display name for a metric, falling back to titleCaseMetric() for anything not in the map -- never hard-fails on an unlisted metric. */
export function friendlyMetricLabel(metric: string): string {
  return FRIENDLY_METRIC_LABELS[metric] ?? titleCaseMetric(metric);
}
