import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import { StatsPoller } from "../../src/stats/poller.js";
import { StatsStore } from "../../src/stats/store.js";
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

  it("prunes on every poll cycle", async () => {
    const statsPath = path.join(h.instancesDir, "stats.txt");
    await writeFile(statsPath, STATS_TEXT, "utf8");
    await writeConfWithStatsPath(h.instancesDir, "rtl_x", statsPath);
    statsStore.insertBatch("rtl_x", [{ metric: "old", labels: {}, value: 1 }], Date.now() - 30 * 24 * 60 * 60 * 1000);

    const poller = new StatsPoller(h.configStore, statsStore, { intervalMs: 1000, retentionDays: 7 });
    await poller.pollOnce();

    expect(statsStore.history("rtl_x", { metric: "old" })).toEqual([]);
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
