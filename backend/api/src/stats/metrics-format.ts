import type { LatestSample } from "./store.js";

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Renders each instance's latest stat samples as Prometheus text exposition
 * format, tagging every sample with an `instance` label so a single scrape
 * of this panel covers every managed instance at once. Ironic that this
 * panel parses Prometheus format from RTLSDR-Airband (see
 * prometheus-parser.ts) but didn't expose any itself until now.
 */
export function formatPrometheusMetrics(perInstance: Map<string, LatestSample[]>): string {
  const lines: string[] = [];
  for (const [instance, samples] of perInstance) {
    for (const sample of samples) {
      const labels = { ...sample.labels, instance };
      const labelText = Object.entries(labels)
        .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
        .join(",");
      lines.push(`${sample.metric}{${labelText}} ${sample.value}`);
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
