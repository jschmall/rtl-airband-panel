import { describe, expect, it } from "vitest";
import { formatPrometheusMetrics } from "../../src/stats/metrics-format.js";
import type { LatestSample } from "../../src/stats/store.js";

describe("formatPrometheusMetrics", () => {
  it("returns an empty string when there's nothing to report", () => {
    expect(formatPrometheusMetrics(new Map())).toBe("");
  });

  it("renders a sample with an instance label added", () => {
    const perInstance = new Map<string, LatestSample[]>([["rtl_x", [{ metric: "channel_signal_level", labels: { freq: "151.160" }, value: 3.5 }]]]);
    expect(formatPrometheusMetrics(perInstance)).toBe('channel_signal_level{freq="151.160",instance="rtl_x"} 3.5\n');
  });

  it("renders a sample with no labels of its own, just the instance label", () => {
    const perInstance = new Map<string, LatestSample[]>([["rtl_x", [{ metric: "some_metric", labels: {}, value: 1 }]]]);
    expect(formatPrometheusMetrics(perInstance)).toBe('some_metric{instance="rtl_x"} 1\n');
  });

  it("escapes quotes and backslashes in label values", () => {
    const perInstance = new Map<string, LatestSample[]>([["rtl_x", [{ metric: "m", labels: { path: 'a"b\\c' }, value: 1 }]]]);
    expect(formatPrometheusMetrics(perInstance)).toBe('m{path="a\\"b\\\\c",instance="rtl_x"} 1\n');
  });

  it("covers every instance in one output", () => {
    const perInstance = new Map<string, LatestSample[]>([
      ["rtl_a", [{ metric: "m", labels: {}, value: 1 }]],
      ["rtl_b", [{ metric: "m", labels: {}, value: 2 }]],
    ]);
    const text = formatPrometheusMetrics(perInstance);
    expect(text).toContain('instance="rtl_a"');
    expect(text).toContain('instance="rtl_b"');
  });
});
