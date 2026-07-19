/**
 * Parser for the stats file RTLSDR-Airband writes to `stats_filepath`
 * (output.cpp, write_stats_file()). It's real Prometheus text exposition
 * format: "# HELP"/"# TYPE" comment lines, then
 * `metric_name{label="value",...}<whitespace>value` data lines. The file
 * is fully rewritten (truncated) on every write, so this parses one
 * point-in-time snapshot — history is our own responsibility (see store.ts).
 */
export interface StatSample {
  metric: string;
  labels: Record<string, string>;
  value: number;
}

const SAMPLE_LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(\S+)$/;
const LABEL_PAIR = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

export function parsePrometheusText(text: string): StatSample[] {
  const samples: StatSample[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = SAMPLE_LINE.exec(line);
    if (!match) continue;
    const [, metric, labelsPart, valueText] = match;

    const value = Number(valueText);
    if (!Number.isFinite(value)) continue;

    const labels: Record<string, string> = {};
    if (labelsPart) {
      LABEL_PAIR.lastIndex = 0;
      let labelMatch: RegExpExecArray | null;
      while ((labelMatch = LABEL_PAIR.exec(labelsPart))) {
        const [, key, rawValue] = labelMatch;
        labels[key!] = rawValue!.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }

    samples.push({ metric: metric!, labels, value });
  }

  return samples;
}
