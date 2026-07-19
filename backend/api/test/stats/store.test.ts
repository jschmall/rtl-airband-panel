import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatsStore } from "../../src/stats/store.js";
import type { StatSample } from "../../src/stats/prometheus-parser.js";

let store: StatsStore;

beforeEach(() => {
  store = new StatsStore(":memory:");
});

afterEach(() => {
  store.close();
});

describe("StatsStore.latest", () => {
  it("returns an empty array when nothing has been polled", () => {
    expect(store.latest("rtl_1")).toEqual([]);
  });

  it("returns only the most recent batch, not older ones", () => {
    const older: StatSample[] = [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 1 }];
    const newer: StatSample[] = [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 2 }];
    store.insertBatch("rtl_1", older, 1000);
    store.insertBatch("rtl_1", newer, 2000);

    expect(store.latest("rtl_1")).toEqual([{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 2 }]);
  });

  it("keeps different instances' data separate", () => {
    store.insertBatch("rtl_1", [{ metric: "m", labels: {}, value: 1 }], 1000);
    store.insertBatch("rtl_2", [{ metric: "m", labels: {}, value: 2 }], 1000);

    expect(store.latest("rtl_1")).toEqual([{ metric: "m", labels: {}, value: 1 }]);
    expect(store.latest("rtl_2")).toEqual([{ metric: "m", labels: {}, value: 2 }]);
  });
});

describe("StatsStore.history", () => {
  it("returns points in ascending ts order, filtered to the exact label set", () => {
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 1 }], 3000);
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 2 }], 1000);
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 3 }], 2000);
    // a different channel on the same instance/metric must not leak into the query below
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "999.99" }, value: 999 }], 1500);

    const points = store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16" } });
    expect(points).toEqual([
      { ts: 1000, value: 2 },
      { ts: 2000, value: 3 },
      { ts: 3000, value: 1 },
    ]);
  });

  it("respects sinceMs/untilMs bounds", () => {
    for (const [ts, value] of [
      [1000, 1],
      [2000, 2],
      [3000, 3],
    ] as const) {
      store.insertBatch("rtl_1", [{ metric: "m", labels: {}, value }], ts);
    }
    expect(store.history("rtl_1", { metric: "m", sinceMs: 1500, untilMs: 2500 })).toEqual([{ ts: 2000, value: 2 }]);
  });

  it("label-set matching is order-independent", () => {
    store.insertBatch("rtl_1", [{ metric: "m", labels: { a: "1", b: "2" }, value: 42 }], 1000);
    expect(store.history("rtl_1", { metric: "m", labels: { b: "2", a: "1" } })).toEqual([{ ts: 1000, value: 42 }]);
  });
});

describe("StatsStore.prune", () => {
  it("deletes samples older than the retention window", () => {
    const now = Date.now();
    store.insertBatch("rtl_1", [{ metric: "m", labels: {}, value: 1 }], now - 10 * 24 * 60 * 60 * 1000); // 10 days old
    store.insertBatch("rtl_1", [{ metric: "m", labels: {}, value: 2 }], now); // fresh

    store.prune(7); // 7-day retention

    const points = store.history("rtl_1", { metric: "m" });
    expect(points).toEqual([{ ts: now, value: 2 }]);
  });

  it("does nothing when retentionDays is 0 or negative", () => {
    store.insertBatch("rtl_1", [{ metric: "m", labels: {}, value: 1 }], 0);
    store.prune(0);
    store.prune(-5);
    expect(store.history("rtl_1", { metric: "m" })).toEqual([{ ts: 0, value: 1 }]);
  });
});
