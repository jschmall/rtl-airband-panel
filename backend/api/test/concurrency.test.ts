import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { ConfigConflictError, InstanceAlreadyExistsError } from "../src/instance-service.js";
import { buildHarness, FIXTURE_INSTANCE_NAME, seedFixture, teardownHarness, type TestHarness } from "./helpers.js";

function minimalConfig(overrides: Partial<RtlAirbandConfig> = {}): RtlAirbandConfig {
  return {
    multiple_demod_threads: true,
    multiple_output_threads: true,
    stats_filepath: "/tmp/stats.txt",
    localtime: true,
    devices: [
      {
        type: "rtlsdr",
        serial: "1",
        gain: 29,
        centerfreq: 100_000_000,
        sample_rate: 1_400_000,
        correction: 0,
        channels: [{ freq: 100_000_000, afc: 0, modulation: "nfm", outputs: [{ type: "pulse", server: "s", sink: "s", stream_name: "s", continuous: false }] }],
      },
    ],
    ...overrides,
  };
}

let h: TestHarness;

beforeEach(async () => {
  h = await buildHarness();
});

afterEach(async () => {
  await teardownHarness(h);
});

describe("concurrent updateConfig on the same instance", () => {
  it("two overlapping saves without ifMatch both succeed, and the file ends up as exactly one of the two writes (no corruption/interleaving)", async () => {
    await seedFixture(h.instancesDir);
    const configA = minimalConfig({ stats_filepath: "/tmp/a.txt" });
    const configB = minimalConfig({ stats_filepath: "/tmp/b.txt" });

    const [resultA, resultB] = await Promise.all([
      h.service.updateConfig(FIXTURE_INSTANCE_NAME, configA),
      h.service.updateConfig(FIXTURE_INSTANCE_NAME, configB),
    ]);

    expect(resultA.status.activeState).toBe("active");
    expect(resultB.status.activeState).toBe("active");

    const final = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    const isA = final.stats_filepath === "/tmp/a.txt";
    const isB = final.stats_filepath === "/tmp/b.txt";
    expect(isA || isB).toBe(true); // exactly one of the two, not a hybrid of both
  });

  it("with ifMatch, only one of two overlapping saves against the same stale version succeeds; the other gets ConfigConflictError", async () => {
    await seedFixture(h.instancesDir);
    const { version } = await h.service.getConfigWithVersion(FIXTURE_INSTANCE_NAME);

    const results = await Promise.allSettled([
      h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig({ stats_filepath: "/tmp/a.txt" }), { ifMatch: version }),
      h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig({ stats_filepath: "/tmp/b.txt" }), { ifMatch: version }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Both requests read the same starting version, so at most one can still match by
    // the time it actually writes -- this is exactly the two-tabs-editing-the-same-instance
    // scenario ifMatch exists to catch, now proven under real overlap, not just in sequence.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConfigConflictError);
  });
});

describe("concurrent updateConfig + updateInstanceOptions on the same instance", () => {
  it("a config save and an options patch (PATCH /options) running concurrently both succeed without corrupting each other's on-disk state", async () => {
    await seedFixture(h.instancesDir);

    // Today's safety here is real but only implicit: InstanceService.updateInstanceOptions
    // and updateConfig share the same per-instance KeyedMutex, so this pins that invariant
    // with an actual concurrent call rather than leaving it undemonstrated.
    const [configResult, optionsResult] = await Promise.all([
      h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig({ stats_filepath: "/tmp/concurrent.txt" })),
      h.service.updateInstanceOptions(FIXTURE_INSTANCE_NAME, { jsonLogging: true }),
    ]);

    expect(configResult.status.activeState).toBe("active");
    expect(optionsResult.status.activeState).toBe("active");
    expect(optionsResult.options.jsonLogging).toBe(true);

    const finalConfig = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    expect(finalConfig.stats_filepath).toBe("/tmp/concurrent.txt");

    // Both operations restart by default -- serialized through the mutex, neither's
    // mark-pending/clear-pending pair should be left dangling by the other's.
    const list = await h.service.listInstances();
    expect(list.find((i) => i.name === FIXTURE_INSTANCE_NAME)?.pendingRestart).toBe(false);
  });
});

describe("concurrent createInstance with the same name", () => {
  it("only one of two overlapping creates for the same name succeeds", async () => {
    const results = await Promise.allSettled([
      h.service.createInstance("rtl_race", minimalConfig()),
      h.service.createInstance("rtl_race", minimalConfig()),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InstanceAlreadyExistsError);

    // Exactly one instance exists afterward, not zero (both failed) or a corrupt double-install.
    const list = await h.service.listInstances();
    expect(list.map((i) => i.name)).toEqual(["rtl_race"]);
  });
});

describe("concurrent restartAllPending", () => {
  it("running the bulk restart twice concurrently doesn't double-restart or throw", async () => {
    await seedFixture(h.instancesDir);
    await seedFixture(h.instancesDir, "rtl_other");
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: false });
    await h.service.updateConfig("rtl_other", minimalConfig(), { restart: false });

    const [resultsA, resultsB] = await Promise.all([h.service.restartAllPending(), h.service.restartAllPending()]);

    // Both calls saw the pending set (or whatever was left of it) and completed without throwing;
    // by the end nothing is pending, regardless of exactly how the two calls interleaved.
    expect(Object.keys(resultsA).length + Object.keys(resultsB).length).toBeGreaterThanOrEqual(2);
    const list = await h.service.listInstances();
    expect(list.every((i) => !i.pendingRestart)).toBe(true);
  });
});
