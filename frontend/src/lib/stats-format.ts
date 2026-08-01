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

const compactCountFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Abbreviates an ever-growing counter for tile display, e.g. buffer_underrun_count
 * on a healthy, rarely-restarted instance can reach the millions over weeks of
 * uptime: 418 -> "418", 48213 -> "48.2K", 1432905 -> "1.4M". Pair with
 * `exactCount()` (e.g. in a tooltip) so the precise value stays one hover away.
 */
export function formatCompactCount(value: number): string {
  return compactCountFormat.format(value);
}

/** Full precision with thousands separators, for a tooltip alongside a formatCompactCount() display. */
export function exactCount(value: number): string {
  return value.toLocaleString("en-US");
}
