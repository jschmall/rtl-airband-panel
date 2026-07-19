import { describe, expect, it } from "vitest";
import { parsePrometheusText } from "../../src/stats/prometheus-parser.js";

// Shaped exactly like RTLSDR-Airband's own write_stats_file() output (output.cpp).
const SAMPLE_STATS_FILE = `
# HELP channel_activity_counter Loops of output_thread with frequency active.
# TYPE channel_activity_counter counter
channel_activity_counter{freq="151.160"}\t1234
channel_activity_counter{freq="151.175",label="dispatch_1"}\t56

# HELP channel_noise_level Raw squelch noise_level.
# TYPE channel_noise_level gauge
channel_noise_level{freq="151.160"}\t0.008

# HELP channel_dbfs_noise_level Squelch noise_level as dBFS.
# TYPE channel_dbfs_noise_level gauge
channel_dbfs_noise_level{freq="151.160"}\t-42.135

# HELP buffer_overflow_count Number of times a device's buffer has overflowed.
# TYPE buffer_overflow_count counter
buffer_overflow_count{device="0"}\t0

# HELP input_overrun_count Number of times mixer input has overrun.
# TYPE input_overrun_count counter
input_overrun_count{mixer="0",input="1"}\t3
`;

describe("parsePrometheusText", () => {
  it("parses gauge and counter samples with labels", () => {
    const samples = parsePrometheusText(SAMPLE_STATS_FILE);
    expect(samples).toContainEqual({ metric: "channel_activity_counter", labels: { freq: "151.160" }, value: 1234 });
    expect(samples).toContainEqual({
      metric: "channel_activity_counter",
      labels: { freq: "151.175", label: "dispatch_1" },
      value: 56,
    });
    expect(samples).toContainEqual({ metric: "channel_noise_level", labels: { freq: "151.160" }, value: 0.008 });
    expect(samples).toContainEqual({ metric: "channel_dbfs_noise_level", labels: { freq: "151.160" }, value: -42.135 });
  });

  it("parses multi-label metrics (mixer input overruns)", () => {
    const samples = parsePrometheusText(SAMPLE_STATS_FILE);
    expect(samples).toContainEqual({
      metric: "input_overrun_count",
      labels: { mixer: "0", input: "1" },
      value: 3,
    });
  });

  it("ignores # HELP / # TYPE comment lines and blank lines", () => {
    const samples = parsePrometheusText(SAMPLE_STATS_FILE);
    expect(samples.every((s) => !s.metric.startsWith("#"))).toBe(true);
    expect(samples).toHaveLength(6);
  });

  it("returns an empty array for empty input", () => {
    expect(parsePrometheusText("")).toEqual([]);
  });

  it("handles a metric with no labels at all", () => {
    const samples = parsePrometheusText("some_metric\t42\n");
    expect(samples).toEqual([{ metric: "some_metric", labels: {}, value: 42 }]);
  });

  it("skips malformed lines rather than throwing", () => {
    const samples = parsePrometheusText("not a valid line at all\nchannel_noise_level{freq=\"1\"}\t5\n");
    expect(samples).toEqual([{ metric: "channel_noise_level", labels: { freq: "1" }, value: 5 }]);
  });
});
