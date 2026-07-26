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

describe("StatsStore label-change migration", () => {
  it("preserves history when a channel's label is added (freq unambiguous)", () => {
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 1 }], 1000);
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 2 }], 2000);
    // Restart: the channel now has a label, so its metric label set changed.
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16", label: "Fire Dispatch" }, value: 3 }], 3000);

    const points = store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16", label: "Fire Dispatch" } });
    expect(points).toEqual([
      { ts: 1000, value: 1 },
      { ts: 2000, value: 2 },
      { ts: 3000, value: 3 },
    ]);
    // The old label set no longer resolves to anything -- it was migrated, not duplicated.
    expect(store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16" } })).toEqual([]);
  });

  it("preserves history when a channel's label is changed", () => {
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16", label: "Old Name" }, value: 1 }], 1000);
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16", label: "New Name" }, value: 2 }], 2000);

    expect(store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16", label: "New Name" } })).toEqual([
      { ts: 1000, value: 1 },
      { ts: 2000, value: 2 },
    ]);
  });

  it("preserves history when a channel's label is removed", () => {
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16", label: "Temp Label" }, value: 1 }], 1000);
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 2 }], 2000);

    expect(store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16" } })).toEqual([
      { ts: 1000, value: 1 },
      { ts: 2000, value: 2 },
    ]);
  });

  it("migrates the one identifiable channel when its label is dropped alongside another, still-labeled channel at the same freq", () => {
    // Two channels at the same freq, distinguished only by label -- both active for a while.
    store.insertBatch(
      "rtl_1",
      [
        { metric: "channel_signal_level", labels: { freq: "151.16", label: "Channel A" }, value: 1 },
        { metric: "channel_signal_level", labels: { freq: "151.16", label: "Channel B" }, value: 2 },
      ],
      1000
    );
    // "Channel A"'s label is blanked; "Channel B" keeps reporting under its own unchanged
    // label, so it's never a migration candidate -- "Channel A" is the only series left
    // unaccounted for, so this is unambiguous and should migrate.
    store.insertBatch(
      "rtl_1",
      [
        { metric: "channel_signal_level", labels: { freq: "151.16" }, value: 3 },
        { metric: "channel_signal_level", labels: { freq: "151.16", label: "Channel B" }, value: 4 },
      ],
      2000
    );

    expect(store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16" } })).toEqual([
      { ts: 1000, value: 1 },
      { ts: 2000, value: 3 },
    ]);
    expect(store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16", label: "Channel B" } })).toEqual([
      { ts: 1000, value: 2 },
      { ts: 2000, value: 4 },
    ]);
  });

  it("does not migrate (or merge) when two same-freq channels both go unlabeled in the same poll -- genuinely ambiguous", () => {
    store.insertBatch(
      "rtl_1",
      [
        { metric: "channel_signal_level", labels: { freq: "151.16", label: "Channel A" }, value: 1 },
        { metric: "channel_signal_level", labels: { freq: "151.16", label: "Channel B" }, value: 2 },
      ],
      1000
    );
    // Both channels lose their labels at once -- RTLSDR-Airband itself can no longer tell
    // them apart (it emits one freq-only line, not two), so there are two equally-plausible
    // migration candidates. Neither should be picked; both old series stay as they are.
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 3 }], 2000);

    expect(store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16", label: "Channel A" } })).toEqual([
      { ts: 1000, value: 1 },
    ]);
    expect(store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16", label: "Channel B" } })).toEqual([
      { ts: 1000, value: 2 },
    ]);
    expect(store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16" } })).toEqual([{ ts: 2000, value: 3 }]);
  });

  it("does not migrate across different instances", () => {
    store.insertBatch("rtl_1", [{ metric: "channel_signal_level", labels: { freq: "151.16" }, value: 1 }], 1000);
    store.insertBatch("rtl_2", [{ metric: "channel_signal_level", labels: { freq: "151.16", label: "Other Instance" }, value: 2 }], 2000);

    expect(store.history("rtl_1", { metric: "channel_signal_level", labels: { freq: "151.16" } })).toEqual([{ ts: 1000, value: 1 }]);
    expect(store.history("rtl_2", { metric: "channel_signal_level", labels: { freq: "151.16", label: "Other Instance" } })).toEqual([
      { ts: 2000, value: 2 },
    ]);
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
