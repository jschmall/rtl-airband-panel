/** "buffer_overflow_count" -> "Buffer Overflow", "channel_squelch_counter" -> "Squelch" */
export function titleCaseMetric(metric: string): string {
  const stripped = metric.replace(/^channel_/, "").replace(/_(count|counter)$/, "");
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
