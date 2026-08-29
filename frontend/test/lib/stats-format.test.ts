import { describe, expect, it } from "vitest";
import { formatCpuSeconds, friendlyMetricLabel, humanizeLabels, titleCaseMetric } from "../../src/lib/stats-format.js";

describe("titleCaseMetric", () => {
  it("strips channel_ prefix and _count/_counter/_total suffixes", () => {
    expect(titleCaseMetric("buffer_overflow_count")).toBe("Buffer Overflow");
    expect(titleCaseMetric("channel_squelch_counter")).toBe("Squelch");
    expect(titleCaseMetric("process_cpu_seconds_total")).toBe("Process Cpu Seconds");
  });
});

describe("humanizeLabels", () => {
  it("returns undefined for a label-less sample", () => {
    expect(humanizeLabels({})).toBeUndefined();
  });

  it("formats a single label", () => {
    expect(humanizeLabels({ device: "0" })).toBe("Device 0");
  });
});

describe("formatCpuSeconds", () => {
  it("rounds to the nearest hundredth", () => {
    expect(formatCpuSeconds(187.652341)).toBe("187.65");
    expect(formatCpuSeconds(0)).toBe("0.00");
  });

  it("shows an em dash when the metric hasn't been reported", () => {
    expect(formatCpuSeconds(undefined)).toBe("—");
  });
});

describe("friendlyMetricLabel", () => {
  it("returns the mapped plain-English name for a known metric", () => {
    expect(friendlyMetricLabel("icecast_disconnect_count")).toBe("Icecast disconnects");
    expect(friendlyMetricLabel("buffer_overflow_count")).toBe("Buffer overflows");
  });

  it("falls back to titleCaseMetric() for an unmapped metric", () => {
    expect(friendlyMetricLabel("pulse_underflow_count")).toBe(titleCaseMetric("pulse_underflow_count"));
  });
});
