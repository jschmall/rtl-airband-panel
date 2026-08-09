import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import { StatsPoller } from "../../src/stats/poller.js";
import { StatsStore } from "../../src/stats/store.js";
import { PollStatusTracker } from "../../src/stats/poll-status.js";
import { buildHarness, seedFixture, teardownHarness, type TestHarness } from "../helpers.js";

let h: TestHarness;
let statsStore: StatsStore;

beforeEach(async () => {
  h = await buildHarness();
  statsStore = new StatsStore(":memory:");
});

afterEach(async () => {
  statsStore.close();
  await teardownHarness(h);
});

const STATS_TEXT = 'channel_signal_level{freq="151.160"}\t3.5\n';

describe("StatsPoller.pollOnce", () => {
  it("does nothing for an instance whose stats file doesn't exist yet", async () => {
    await seedFixture(h.instancesDir); // fixture's stats_filepath points somewhere that doesn't exist in the test env
    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 });
    await poller.pollOnce();
    expect(statsStore.latest("rtl_151719")).toEqual([]);
  });

  it("reads and stores a real stats file for an instance", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);

    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 });
    await poller.pollOnce();

    expect(statsStore.latest("rtl_x")).toEqual([{ metric: "channel_signal_level", labels: { freq: "151.160" }, value: 3.5 }]);
  });

  it("does not re-insert a duplicate batch when the stats file's mtime hasn't changed", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);

    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 });
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();

    const points = statsStore.history("rtl_x", { metric: "channel_signal_level", labels: { freq: "151.160" } });
    expect(points).toHaveLength(1);
  });

  it("polls again once the stats file's mtime advances", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);

    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 });
    await poller.pollOnce();

    const future = new Date(Date.now() + 60_000);
    await utimes(statsPath, future, future);
    await poller.pollOnce();

    const points = statsStore.history("rtl_x", { metric: "channel_signal_level", labels: { freq: "151.160" } });
    expect(points).toHaveLength(2);
  });

  it("continues polling other instances if one instance's poll throws", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_good", statsPath);
    // rtl_bad has a stats_filepath pointing at a directory, which will throw on readFile after stat succeeds as a dir
    await writeConfWithStatsPath(h.instancesDir, "rtl_bad", h.instancesDir);

    const errors: Array<{ instance: string }> = [];
    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 }, (instance) =>
      errors.push({ instance })
    );
    await poller.pollOnce();

    expect(statsStore.latest("rtl_good")).toEqual([{ metric: "channel_signal_level", labels: { freq: "151.160" }, value: 3.5 }]);
    expect(errors.map((e) => e.instance)).toEqual(["rtl_bad"]);
  });

  it("refuses to read a stats file over the size cap, reporting via onError instead of reading it in", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    // Comfortably over the 5 MB cap; a real RTLSDR-Airband stats snapshot is a few KB.
    await writeFile(statsPath, "x".repeat(6 * 1024 * 1024), "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_huge", statsPath);

    const errors: Array<{ instance: string }> = [];
    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 }, (instance) =>
      errors.push({ instance })
    );
    await poller.pollOnce();

    expect(errors.map((e) => e.instance)).toEqual(["rtl_huge"]);
    expect(statsStore.latest("rtl_huge")).toEqual([]);
  });

  it("prunes on the first poll cycle", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);
    statsStore.insertBatch("rtl_x", [{ metric: "old", labels: {}, value: 1 }], Date.now() - 30 * 24 * 60 * 60 * 1000);

    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 });
    await poller.pollOnce();

    expect(statsStore.history("rtl_x", { metric: "old" })).toEqual([]);
  });

  it("does not re-prune on the immediately following poll cycle", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);

    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7, pruneIntervalMs: 60_000 });
    const pruneSpy = vi.spyOn(statsStore, "prune");
    await poller.pollOnce();
    await poller.pollOnce();

    expect(pruneSpy).toHaveBeenCalledTimes(1);
  });

  it("prunes again once pruneIntervalMs has elapsed", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);

    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7, pruneIntervalMs: 1 });
    const pruneSpy = vi.spyOn(statsStore, "prune");
    await poller.pollOnce();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await poller.pollOnce();

    expect(pruneSpy).toHaveBeenCalledTimes(2);
  });

  it("defaults pruneIntervalMs to 1 hour when not given", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);

    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 });
    const pruneSpy = vi.spyOn(statsStore, "prune");
    await poller.pollOnce();
    await poller.pollOnce();

    expect(pruneSpy).toHaveBeenCalledTimes(1);
  });

  it("reports a prune failure via onError instead of rejecting the whole poll (e.g. DB closed mid-cycle during shutdown)", async () => {
    statsStore.close();

    const errors: Array<{ instance: string }> = [];
    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 }, (instance) => errors.push({ instance }));

    await expect(poller.pollOnce()).resolves.toBeUndefined();
    expect(errors.map((e) => e.instance)).toContain("<prune>");
  });
});

describe("StatsPoller poll-status tracking", () => {
  it("records a success for an instance that polls cleanly", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);

    const pollStatus = new PollStatusTracker();
    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 }, undefined, pollStatus);
    await poller.pollOnce();

    const status = pollStatus.get("rtl_x");
    expect(status.lastSuccessMs).toBeTypeOf("number");
    expect(status.lastError).toBeUndefined();
  });

  it("records an error for an instance whose poll throws, surfacing it the same way onError does", async () => {
    // rtl_bad has a stats_filepath pointing at a directory, which throws on readFile after stat succeeds as a dir
    await writeConfWithStatsPath(h.instancesDir, "rtl_bad", h.instancesDir);

    const pollStatus = new PollStatusTracker();
    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 }, undefined, pollStatus);
    await poller.pollOnce();

    const status = pollStatus.get("rtl_bad");
    expect(status.lastError).toBeDefined();
    expect(status.lastErrorMs).toBeTypeOf("number");
  });

  it("clears the error once a broken instance starts polling cleanly again", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    // Points at a directory -- throws on readFile after stat succeeds as a dir.
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", h.instancesDir);

    const pollStatus = new PollStatusTracker();
    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 }, undefined, pollStatus);
    await poller.pollOnce();
    expect(pollStatus.get("rtl_x").lastError).toBeDefined();

    // Fix the config to point at a real stats file.
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);
    await poller.pollOnce();

    const status = pollStatus.get("rtl_x");
    expect(status.lastError).toBeUndefined();
    expect(status.lastSuccessMs).toBeTypeOf("number");
  });
});

describe("StatsPoller.stop", () => {
  it("waits for an in-flight poll to finish before resolving, so it's safe to close the DB right after", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);

    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 });
    poller.start();
    await poller.stop();

    // If stop() had returned before the in-flight pollOnce() actually finished,
    // closing here could race a still-running insertBatch/prune call against
    // an already-closed DB handle.
    expect(() => statsStore.close()).not.toThrow();
  });
});

async function writeConfWithStatsPath(instancesDir: string, name: string, statsFilepath: string): Promise<void> {
  const conf = `
    multiple_demod_threads = true;
    multiple_output_threads = true;
    stats_filepath = "${statsFilepath}";
    localtime = true;
    devices: (
      { type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0;
        channels: ( { freq = 100.0; outputs: (
          { type = "pulse"; server = "10.0.0.1"; sink = "s"; stream_name = "s"; continuous = false; }
        ); } ); }
    );
  `;
  await writeFile(path.join(instancesDir, `${name}.conf`), conf, "utf8");
}
