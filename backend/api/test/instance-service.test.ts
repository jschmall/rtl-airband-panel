import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { ConfigConflictError, InstanceAlreadyExistsError, InstanceNotFoundError, InstanceService, ValidationFailedError } from "../src/instance-service.js";
import { InvalidInstanceNameError } from "../src/instance-name.js";
import { ConfigStore } from "../src/config-store.js";
import { PendingRestartStore } from "../src/pending-restart-store.js";
import { InstanceOptionsStore } from "../src/instance-options-store.js";
import { MockSystemdAdapter } from "../src/systemd/mock-adapter.js";
import { buildHarness, cleanupScratchDir, FIXTURE_INSTANCE_NAME, makeScratchDir, seedFixture, teardownHarness, type TestHarness } from "./helpers.js";

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
        channels: [
          {
            freq: 100_000_000,
            afc: 0,
            modulation: "nfm",
            outputs: [{ type: "pulse", server: "10.0.0.1", sink: "s", stream_name: "s", continuous: false }],
          },
        ],
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

describe("listInstances / getConfig", () => {
  it("lists no instances in an empty directory", async () => {
    expect(await h.service.listInstances()).toEqual([]);
  });

  it("lists a seeded fixture and can read it back", async () => {
    await seedFixture(h.instancesDir);
    const list = await h.service.listInstances();
    expect(list).toEqual([
      {
        name: FIXTURE_INSTANCE_NAME,
        confPath: expect.stringContaining(FIXTURE_INSTANCE_NAME),
        unit: `${FIXTURE_INSTANCE_NAME}.service`,
        pendingRestart: false,
        jsonLogging: false,
        status: expect.any(Object),
        searchFields: expect.any(Array),
      },
    ]);

    const config = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    expect(config.devices).toHaveLength(1);
    expect(config.devices[0]!.channels).toHaveLength(22);
  });

  it("throws InstanceNotFoundError for a nonexistent instance", async () => {
    await expect(h.service.getConfig("does_not_exist")).rejects.toBeInstanceOf(InstanceNotFoundError);
  });

  it("collects search fields (labels, frequencies, modulation, device type/serial) from both multichannel and scan-mode devices", async () => {
    await h.service.createInstance(
      "rtl_labeled",
      minimalConfig({
        devices: [
          {
            type: "rtlsdr",
            serial: "1",
            gain: 29,
            centerfreq: 100_000_000,
            sample_rate: 1_400_000,
            correction: 0,
            channels: [
              { freq: 100_000_000, label: "CHP North", modulation: "nfm", outputs: [{ type: "pulse", continuous: false }] },
              { freq: 100_100_000, modulation: "nfm", outputs: [{ type: "pulse", continuous: false }] }, // no label -- must not add "" or undefined
            ],
          },
          {
            type: "rtlsdr",
            serial: "2",
            gain: 29,
            mode: "scan",
            sample_rate: 1_400_000,
            correction: 0,
            channels: [
              {
                freqs: [151_000_000, 151_100_000],
                labels: ["CHP South", "CDF Air"],
                modulation: "nfm",
                outputs: [{ type: "pulse", continuous: false }],
              },
            ],
          },
        ],
      })
    );

    const [summary] = await h.service.listInstances();
    expect(summary!.searchFields).toEqual([
      "rtlsdr",
      "1",
      "CHP North",
      "100",
      "nfm",
      "100.1",
      "nfm",
      "rtlsdr",
      "2",
      "CHP South",
      "CDF Air",
      "151",
      "151.1",
      "nfm",
    ]);
  });

  it("lists an instance with an unparsable .conf with empty searchFields instead of throwing", async () => {
    await fs.writeFile(path.join(h.instancesDir, "rtl_broken.conf"), "not valid libconfig {{{", "utf8");

    const list = await h.service.listInstances();
    const broken = list.find((i) => i.name === "rtl_broken");
    expect(broken).toBeDefined();
    expect(broken!.searchFields).toEqual([]);
  });
});

describe("validateOnly", () => {
  it("returns no errors for a valid config, and writes/touches nothing", async () => {
    await seedFixture(h.instancesDir);
    const before = await h.service.getConfig(FIXTURE_INSTANCE_NAME);

    const result = await h.service.validateOnly(FIXTURE_INSTANCE_NAME, minimalConfig());

    expect(result.errors).toEqual([]);
    expect(h.systemd.calls).toEqual([]);
    expect(await h.service.getConfig(FIXTURE_INSTANCE_NAME)).toEqual(before);
  });

  it("returns errors for an invalid config instead of throwing, and still writes/touches nothing", async () => {
    await seedFixture(h.instancesDir);
    const before = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    const outputs = before.devices[0]!.channels[0]!.outputs;
    const collision = {
      ...before,
      devices: [
        {
          ...before.devices[0]!,
          channels: [
            { freq: 151_300_000, afc: 0, modulation: "nfm" as const, outputs },
            { freq: 151_300_100, afc: 0, modulation: "nfm" as const, outputs },
          ],
        },
      ],
    };

    const result = await h.service.validateOnly(FIXTURE_INSTANCE_NAME, collision);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(h.systemd.calls).toEqual([]);
    expect(await h.service.getConfig(FIXTURE_INSTANCE_NAME)).toEqual(before);
  });

  it("throws InstanceNotFoundError for a nonexistent instance", async () => {
    await expect(h.service.validateOnly("does_not_exist", minimalConfig())).rejects.toBeInstanceOf(InstanceNotFoundError);
  });
});

describe("updateConfig", () => {
  it("fails closed on validation errors: no file write, no restart", async () => {
    await seedFixture(h.instancesDir);
    const before = await h.service.getConfig(FIXTURE_INSTANCE_NAME);

    // two distinct frequencies forced onto the same FFT bin -> validation error
    const broken = minimalConfig({
      devices: [
        {
          ...before.devices[0]!,
          channels: [
            { freq: 100_000_000, afc: 0, modulation: "nfm", outputs: before.devices[0]!.channels[0]!.outputs },
            { freq: 100_000_100, afc: 0, modulation: "nfm", outputs: before.devices[0]!.channels[0]!.outputs },
          ],
        },
      ],
    });

    await expect(h.service.updateConfig(FIXTURE_INSTANCE_NAME, broken)).rejects.toBeInstanceOf(ValidationFailedError);

    // untouched: file on disk still parses to the original config, and no systemd calls happened
    const stillOriginal = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    expect(stillOriginal).toEqual(before);
    expect(h.systemd.calls).toEqual([]);
  });

  it("writes the config and restarts only this instance's unit on success", async () => {
    await seedFixture(h.instancesDir);
    const config = minimalConfig();

    const result = await h.service.updateConfig(FIXTURE_INSTANCE_NAME, config);

    expect(result.warnings).toEqual([]);
    expect(result.status).toMatchObject({ activeState: "active" });
    expect(h.systemd.calls).toEqual([`restart ${FIXTURE_INSTANCE_NAME}.service`, `status ${FIXTURE_INSTANCE_NAME}.service`]);

    const written = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    expect(written).toEqual(config);
  });

  it("throws InstanceNotFoundError instead of creating a file", async () => {
    await expect(h.service.updateConfig("nope", minimalConfig())).rejects.toBeInstanceOf(InstanceNotFoundError);
    expect(await h.service.listInstances()).toEqual([]);
  });

  it("writes the config without restarting when restart: false", async () => {
    await seedFixture(h.instancesDir);
    const config = minimalConfig();

    const result = await h.service.updateConfig(FIXTURE_INSTANCE_NAME, config, { restart: false });

    expect(result.warnings).toEqual([]);
    expect(h.systemd.calls).toEqual([`status ${FIXTURE_INSTANCE_NAME}.service`]);

    const written = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    expect(written).toEqual(config);
  });

  it("leaves the instance marked pending-restart if the restart itself fails, instead of silently reporting in-sync", async () => {
    await seedFixture(h.instancesDir);
    h.systemd.restart = async () => {
      throw new Error("simulated restart failure");
    };

    await expect(h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig())).rejects.toThrow("simulated restart failure");

    expect(await h.pendingRestartStore.has(FIXTURE_INSTANCE_NAME)).toBe(true);
    const [summary] = await h.service.listInstances();
    expect(summary!.pendingRestart).toBe(true);
  });
});

describe("updateConfig optimistic concurrency (ifMatch)", () => {
  it("succeeds when ifMatch matches the current on-disk version", async () => {
    await seedFixture(h.instancesDir);
    const { version } = await h.service.getConfigWithVersion(FIXTURE_INSTANCE_NAME);

    await expect(h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { ifMatch: version })).resolves.toMatchObject({
      status: { activeState: "active" },
    });
  });

  it("rejects with ConfigConflictError when ifMatch is stale (someone else saved first)", async () => {
    await seedFixture(h.instancesDir);
    const { version: staleVersion } = await h.service.getConfigWithVersion(FIXTURE_INSTANCE_NAME);

    // A second "tab" saves first, moving the on-disk version on.
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig());

    await expect(h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig({ tau: 250 }), { ifMatch: staleVersion })).rejects.toBeInstanceOf(
      ConfigConflictError
    );
  });

  it("skips the check entirely when ifMatch is omitted (last-write-wins, unchanged default behavior)", async () => {
    await seedFixture(h.instancesDir);
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig());

    await expect(h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig({ tau: 250 }))).resolves.toMatchObject({
      status: { activeState: "active" },
    });
  });

  it("returns a new version after each successful write, usable as the next ifMatch", async () => {
    await seedFixture(h.instancesDir);
    const first = await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig());
    const second = await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig({ tau: 250 }), { ifMatch: first.version });

    expect(second.version).not.toBe(first.version);
  });
});

describe("updateConfig secret redaction round-trip", () => {
  it("getConfig masks a saved icecast password, and re-submitting it unchanged keeps the real password on disk", async () => {
    const withPassword = minimalConfig({
      devices: [
        {
          type: "rtlsdr",
          serial: "1",
          gain: 29,
          centerfreq: 100_000_000,
          sample_rate: 1_400_000,
          correction: 0,
          channels: [
            {
              freq: 100_000_000,
              afc: 0,
              modulation: "nfm",
              outputs: [{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "hunter2" }],
            },
          ],
        },
      ],
    });
    await h.service.createInstance("rtl_icecast", withPassword);

    const fetched = await h.service.getConfig("rtl_icecast");
    const fetchedOutput = fetched.devices[0]!.channels[0]!.outputs[0];
    expect(fetchedOutput).toMatchObject({ password: expect.not.stringMatching("hunter2") });

    // Simulate editing an unrelated field and saving without touching the (redacted) password field.
    const edited = {
      ...fetched,
      devices: [{ ...fetched.devices[0]!, gain: 40 }],
    };
    await h.service.updateConfig("rtl_icecast", edited);

    const afterSave = await h.configStore.read("rtl_icecast");
    expect(afterSave.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ password: "hunter2" });
    expect(afterSave.devices[0]!.gain).toBe(40);
  });
});

describe("exportAll / importAll", () => {
  it("exports every instance's config unredacted (a backup is useless without real secrets)", async () => {
    const withPassword = minimalConfig({
      devices: [
        {
          type: "rtlsdr",
          serial: "1",
          gain: 29,
          centerfreq: 100_000_000,
          sample_rate: 1_400_000,
          correction: 0,
          channels: [
            {
              freq: 100_000_000,
              afc: 0,
              modulation: "nfm",
              outputs: [{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "hunter2" }],
            },
          ],
        },
      ],
    });
    await h.service.createInstance("rtl_icecast", withPassword);

    const bundle = await h.service.exportAll();
    expect(bundle.instances["rtl_icecast"]!.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ password: "hunter2" });
  });

  it("imports every instance in the bundle that doesn't already exist", async () => {
    const bundle = { instances: { rtl_a: minimalConfig(), rtl_b: minimalConfig() } };
    const results = await h.service.importAll(bundle);

    expect(results).toEqual({ rtl_a: { status: "created" }, rtl_b: { status: "created" } });
    expect((await h.service.listInstances()).map((i) => i.name).sort()).toEqual(["rtl_a", "rtl_b"]);
  });

  it("skips (doesn't overwrite) an instance whose name already exists", async () => {
    await seedFixture(h.instancesDir); // seeds FIXTURE_INSTANCE_NAME
    const before = await h.service.getConfig(FIXTURE_INSTANCE_NAME);

    const results = await h.service.importAll({ instances: { [FIXTURE_INSTANCE_NAME]: minimalConfig() } });

    expect(results).toEqual({ [FIXTURE_INSTANCE_NAME]: { status: "skipped" } });
    expect(await h.service.getConfig(FIXTURE_INSTANCE_NAME)).toEqual(before);
  });

  it("reports one instance's import failure independently, without stopping the others", async () => {
    // An invalid instance name (fails assertValidInstanceName) is a simple, deterministic
    // way to force createInstance to fail without relying on FFT-bin-collision arithmetic.
    const results = await h.service.importAll({ instances: { "not a valid name!": minimalConfig(), rtl_good: minimalConfig() } });

    expect(results["not a valid name!"]).toMatchObject({ status: "failed" });
    expect(results["rtl_good"]).toEqual({ status: "created" });
    expect(await h.service.listInstances()).toEqual([expect.objectContaining({ name: "rtl_good" })]);
  });

  it("round-trips export -> import into a fresh set of instances", async () => {
    await h.service.createInstance("rtl_original", minimalConfig());
    const bundle = await h.service.exportAll();

    const otherDir = await makeScratchDir();
    try {
      const otherService = new InstanceService(
        new ConfigStore(otherDir),
        new MockSystemdAdapter(),
        new PendingRestartStore(otherDir),
        new InstanceOptionsStore(otherDir),
        {
          instancesDir: otherDir,
          rtlAirbandBinary: "/usr/local/bin/rtl_airband",
        }
      );

      const results = await otherService.importAll(bundle);
      expect(results).toEqual({ rtl_original: { status: "created" } });
      expect(await otherService.getConfig("rtl_original")).toEqual(await h.service.getConfig("rtl_original"));
    } finally {
      await cleanupScratchDir(otherDir);
    }
  });
});

describe("createInstance", () => {
  it("writes the conf file and installs+enables+starts a new unit", async () => {
    const config = minimalConfig();
    const result = await h.service.createInstance("rtl_100000", config);

    expect(result.status).toMatchObject({ activeState: "active" });
    expect(h.systemd.calls).toEqual([
      "install-unit rtl_100000.service",
      "daemon-reload",
      "enable rtl_100000.service",
      "start rtl_100000.service",
      "status rtl_100000.service",
    ]);
    expect(h.systemd.unitFiles.get("rtl_100000.service")).toContain("ExecStart=/usr/local/bin/rtl_airband -F -e -c");

    const written = await h.service.getConfig("rtl_100000");
    expect(written).toEqual(config);
  });

  it("refuses to overwrite an existing instance", async () => {
    await seedFixture(h.instancesDir);
    await expect(h.service.createInstance(FIXTURE_INSTANCE_NAME, minimalConfig())).rejects.toBeInstanceOf(
      InstanceAlreadyExistsError
    );
  });

  it("fails closed on validation errors before writing anything", async () => {
    // two distinct frequencies forced onto the same FFT bin -> validation error
    const outputs = minimalConfig().devices[0]!.channels[0]!.outputs;
    const collision = minimalConfig({
      devices: [
        {
          type: "rtlsdr",
          serial: "1",
          gain: 29,
          centerfreq: 100_000_000,
          sample_rate: 1_400_000,
          correction: 0,
          channels: [
            { freq: 100_300_000, afc: 0, modulation: "nfm", outputs },
            { freq: 100_300_100, afc: 0, modulation: "nfm", outputs },
          ],
        },
      ],
    });

    await expect(h.service.createInstance("rtl_broken", collision)).rejects.toBeInstanceOf(ValidationFailedError);
    expect(await h.service.listInstances()).toEqual([]);
    expect(h.systemd.calls).toEqual([]);
  });

  it("rolls back the conf file if installing the unit fails", async () => {
    const failingSystemd = h.systemd;
    failingSystemd.installUnitFile = async () => {
      throw new Error("simulated systemd failure");
    };

    await expect(h.service.createInstance("rtl_100000", minimalConfig())).rejects.toThrow("simulated systemd failure");
    expect(await h.service.listInstances()).toEqual([]);
  });

  it("also rolls back an already-installed unit file if a later step (daemon-reload/enable/start) fails", async () => {
    h.systemd.daemonReload = async () => {
      throw new Error("simulated daemon-reload failure");
    };

    await expect(h.service.createInstance("rtl_100000", minimalConfig())).rejects.toThrow("simulated daemon-reload failure");
    expect(await h.service.listInstances()).toEqual([]);
    // Previously left an orphaned unit file referencing the just-deleted conf.
    expect(h.systemd.unitFiles.has("rtl_100000.service")).toBe(false);
  });
});

describe("renameInstance", () => {
  it("stops the old unit, stands up the new one, then tears down the old one", async () => {
    await seedFixture(h.instancesDir);
    const before = await h.service.getConfig(FIXTURE_INSTANCE_NAME);

    const result = await h.service.renameInstance(FIXTURE_INSTANCE_NAME, "rtl_renamed");

    expect(result.status).toMatchObject({ activeState: "active" });
    expect(h.systemd.calls).toEqual([
      `stop ${FIXTURE_INSTANCE_NAME}.service`,
      "install-unit rtl_renamed.service",
      "daemon-reload",
      "enable rtl_renamed.service",
      "start rtl_renamed.service",
      `disable ${FIXTURE_INSTANCE_NAME}.service`,
      `remove-unit ${FIXTURE_INSTANCE_NAME}.service`,
      "daemon-reload",
      "status rtl_renamed.service",
    ]);
    expect(h.systemd.unitFiles.get("rtl_renamed.service")).toContain("Description=RTLSDR-Airband instance: rtl_renamed");

    expect(await h.service.listInstances()).toEqual([
      { name: "rtl_renamed", confPath: expect.stringContaining("rtl_renamed"), unit: "rtl_renamed.service", pendingRestart: false, jsonLogging: false, status: expect.any(Object), searchFields: expect.any(Array) },
    ]);
    const renamed = await h.service.getConfig("rtl_renamed");
    expect(renamed).toEqual(before);
  });

  it("is a no-op when renaming to the same name", async () => {
    await seedFixture(h.instancesDir);
    const result = await h.service.renameInstance(FIXTURE_INSTANCE_NAME, FIXTURE_INSTANCE_NAME);

    expect(result.status).toBeDefined();
    expect(h.systemd.calls).toEqual([`status ${FIXTURE_INSTANCE_NAME}.service`]);
    expect(await h.service.listInstances()).toEqual([
      { name: FIXTURE_INSTANCE_NAME, confPath: expect.stringContaining(FIXTURE_INSTANCE_NAME), unit: `${FIXTURE_INSTANCE_NAME}.service`, pendingRestart: false, jsonLogging: false, status: expect.any(Object), searchFields: expect.any(Array) },
    ]);
  });

  it("refuses to rename onto an existing instance", async () => {
    await seedFixture(h.instancesDir);
    await seedFixture(h.instancesDir, "rtl_other");

    await expect(h.service.renameInstance(FIXTURE_INSTANCE_NAME, "rtl_other")).rejects.toBeInstanceOf(InstanceAlreadyExistsError);
    expect(h.systemd.calls).toEqual([]);
  });

  it("throws InstanceNotFoundError for a nonexistent instance", async () => {
    await expect(h.service.renameInstance("nope", "rtl_new")).rejects.toBeInstanceOf(InstanceNotFoundError);
    expect(h.systemd.calls).toEqual([]);
  });

  it("rolls back and restores the old unit if standing up the new one fails", async () => {
    await seedFixture(h.instancesDir);
    const before = await h.service.getConfig(FIXTURE_INSTANCE_NAME);

    h.systemd.installUnitFile = async () => {
      throw new Error("simulated systemd failure");
    };

    await expect(h.service.renameInstance(FIXTURE_INSTANCE_NAME, "rtl_renamed")).rejects.toThrow("simulated systemd failure");

    expect(h.systemd.calls.at(-1)).toBe(`start ${FIXTURE_INSTANCE_NAME}.service`);

    // old conf untouched, new conf rolled back, old unit restarted
    expect(await h.service.listInstances()).toEqual([
      { name: FIXTURE_INSTANCE_NAME, confPath: expect.stringContaining(FIXTURE_INSTANCE_NAME), unit: `${FIXTURE_INSTANCE_NAME}.service`, pendingRestart: false, jsonLogging: false, status: expect.any(Object), searchFields: expect.any(Array) },
    ]);
    expect(await h.service.getConfig(FIXTURE_INSTANCE_NAME)).toEqual(before);
    expect(h.systemd.unitFiles.has("rtl_renamed.service")).toBe(false);
  });
});

describe("deleteInstance", () => {
  it("stops, disables, removes the unit, reloads, and removes the conf file", async () => {
    await seedFixture(h.instancesDir);
    await h.service.deleteInstance(FIXTURE_INSTANCE_NAME);

    expect(h.systemd.calls).toEqual([
      `stop ${FIXTURE_INSTANCE_NAME}.service`,
      `disable ${FIXTURE_INSTANCE_NAME}.service`,
      `remove-unit ${FIXTURE_INSTANCE_NAME}.service`,
      "daemon-reload",
    ]);
    expect(await h.service.listInstances()).toEqual([]);
  });

  it("throws InstanceNotFoundError for a nonexistent instance", async () => {
    await expect(h.service.deleteInstance("nope")).rejects.toBeInstanceOf(InstanceNotFoundError);
  });
});

describe("restartInstance", () => {
  it("restarts only the named instance's unit", async () => {
    await seedFixture(h.instancesDir);
    const status = await h.service.restartInstance(FIXTURE_INSTANCE_NAME);
    expect(status.activeState).toBe("active");
    expect(h.systemd.calls).toEqual([`restart ${FIXTURE_INSTANCE_NAME}.service`, `status ${FIXTURE_INSTANCE_NAME}.service`]);
  });
});

describe("getAllHealth", () => {
  it("returns every instance's status in one call to the adapter, keyed by instance name", async () => {
    await seedFixture(h.instancesDir);
    const result = await h.service.getAllHealth();
    expect(result).toEqual({ [FIXTURE_INSTANCE_NAME]: expect.objectContaining({ unit: `${FIXTURE_INSTANCE_NAME}.service` }) });
    expect(h.systemd.calls).toEqual([`status-many ${FIXTURE_INSTANCE_NAME}.service`]);
  });

  it("with no instances, resolves to an empty object without calling the adapter", async () => {
    expect(await h.service.getAllHealth()).toEqual({});
    expect(h.systemd.calls).toEqual([]);
  });
});

describe("getLogs / followLogs", () => {
  it("getLogs clamps an out-of-range lines request before it reaches the systemd adapter", async () => {
    await seedFixture(h.instancesDir);
    await h.service.getLogs(FIXTURE_INSTANCE_NAME, 999_999);
    expect(h.systemd.calls).toContain(`logs ${FIXTURE_INSTANCE_NAME}.service 2000`);
  });

  it("getLogs rejects an invalid instance name before touching the systemd adapter", async () => {
    await expect(h.service.getLogs("../etc", 200)).rejects.toBeInstanceOf(InvalidInstanceNameError);
    expect(h.systemd.calls).toEqual([]);
  });

  it("followLogs clamps an out-of-range lines request before it reaches the systemd adapter", async () => {
    await seedFixture(h.instancesDir);
    const controller = new AbortController();
    const iterator = h.service.followLogs(FIXTURE_INSTANCE_NAME, 999_999, controller.signal);
    const first = iterator.next();
    controller.abort();
    await first;
    expect(h.systemd.calls).toContain(`follow-logs ${FIXTURE_INSTANCE_NAME}.service 2000`);
  });

  it("followLogs rejects an invalid instance name synchronously, before any adapter call", () => {
    expect(() => h.service.followLogs("../etc", 200, new AbortController().signal)).toThrow(InvalidInstanceNameError);
    expect(h.systemd.calls).toEqual([]);
  });
});

describe("restartAllPending", () => {
  it("restarts every instance marked pending-restart, and none that aren't", async () => {
    await seedFixture(h.instancesDir);
    await seedFixture(h.instancesDir, "rtl_other");
    await seedFixture(h.instancesDir, "rtl_not_pending");
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: false });
    await h.service.updateConfig("rtl_other", minimalConfig(), { restart: false });

    const results = await h.service.restartAllPending();

    expect(Object.keys(results).sort()).toEqual([FIXTURE_INSTANCE_NAME, "rtl_other"].sort());
    expect(h.systemd.calls).toContain(`restart ${FIXTURE_INSTANCE_NAME}.service`);
    expect(h.systemd.calls).toContain(`restart rtl_other.service`);
    expect(h.systemd.calls).not.toContain(`restart rtl_not_pending.service`);

    const list = await h.service.listInstances();
    expect(list.every((i) => !i.pendingRestart)).toBe(true);
  });

  it("reports one instance's restart failure independently, without stopping the others", async () => {
    await seedFixture(h.instancesDir);
    await seedFixture(h.instancesDir, "rtl_other");
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: false });
    await h.service.updateConfig("rtl_other", minimalConfig(), { restart: false });

    const originalRestart = h.systemd.restart.bind(h.systemd);
    h.systemd.restart = async (unit: string) => {
      if (unit === `${FIXTURE_INSTANCE_NAME}.service`) throw new Error("simulated failure");
      return originalRestart(unit);
    };

    const results = await h.service.restartAllPending();

    expect(results[FIXTURE_INSTANCE_NAME]).toMatchObject({ error: "simulated failure" });
    expect(results["rtl_other"]).toMatchObject({ status: { activeState: "active" } });
  });

  it("returns an empty result when nothing is pending", async () => {
    await seedFixture(h.instancesDir);
    expect(await h.service.restartAllPending()).toEqual({});
  });
});

describe("pending restart tracking", () => {
  it("marks pending on a restart:false save, and it shows up in listInstances", async () => {
    await seedFixture(h.instancesDir);
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: false });

    const list = await h.service.listInstances();
    expect(list).toEqual([expect.objectContaining({ name: FIXTURE_INSTANCE_NAME, pendingRestart: true })]);
  });

  it("clears pending once the same instance is saved with restart: true", async () => {
    await seedFixture(h.instancesDir);
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: false });
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: true });

    const list = await h.service.listInstances();
    expect(list).toEqual([expect.objectContaining({ name: FIXTURE_INSTANCE_NAME, pendingRestart: false })]);
  });

  it("clears pending via an explicit restart, without touching other instances", async () => {
    await seedFixture(h.instancesDir);
    await seedFixture(h.instancesDir, "rtl_other");
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: false });
    await h.service.updateConfig("rtl_other", minimalConfig(), { restart: false });

    await h.service.restartInstance(FIXTURE_INSTANCE_NAME);

    const list = await h.service.listInstances();
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: FIXTURE_INSTANCE_NAME, pendingRestart: false }),
        expect.objectContaining({ name: "rtl_other", pendingRestart: true }),
      ])
    );
  });

  it("does not carry a pending flag onto the new name after a rename", async () => {
    await seedFixture(h.instancesDir);
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: false });

    await h.service.renameInstance(FIXTURE_INSTANCE_NAME, "rtl_renamed");

    const list = await h.service.listInstances();
    expect(list).toEqual([expect.objectContaining({ name: "rtl_renamed", pendingRestart: false })]);
  });

  it("drops the pending flag when the instance is deleted", async () => {
    await seedFixture(h.instancesDir);
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: false });

    await h.service.deleteInstance(FIXTURE_INSTANCE_NAME);
    await seedFixture(h.instancesDir);

    const list = await h.service.listInstances();
    expect(list).toEqual([expect.objectContaining({ name: FIXTURE_INSTANCE_NAME, pendingRestart: false })]);
  });

  it("persists across a fresh PendingRestartStore reading the same directory", async () => {
    await seedFixture(h.instancesDir);
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, minimalConfig(), { restart: false });

    const reloaded = new PendingRestartStore(h.instancesDir);
    expect(await reloaded.has(FIXTURE_INSTANCE_NAME)).toBe(true);
  });
});

describe("updateInstanceOptions (jsonLogging)", () => {
  it("defaults jsonLogging to false and omits -j from ExecStart", async () => {
    await h.service.createInstance(FIXTURE_INSTANCE_NAME, minimalConfig());
    const [summary] = await h.service.listInstances();
    expect(summary!.jsonLogging).toBe(false);
    expect(h.systemd.unitFiles.get(`${FIXTURE_INSTANCE_NAME}.service`)).toContain("ExecStart=/usr/local/bin/rtl_airband -F -e -c");
  });

  it("adds -j to ExecStart, reinstalls the unit, and marks pending-restart, then restarts and clears it", async () => {
    await h.service.createInstance(FIXTURE_INSTANCE_NAME, minimalConfig());

    const result = await h.service.updateInstanceOptions(FIXTURE_INSTANCE_NAME, { jsonLogging: true });

    expect(result.options.jsonLogging).toBe(true);
    expect(h.systemd.unitFiles.get(`${FIXTURE_INSTANCE_NAME}.service`)).toContain("ExecStart=/usr/local/bin/rtl_airband -F -e -j -c");
    const [summary] = await h.service.listInstances();
    expect(summary!.jsonLogging).toBe(true);
    // restart defaults to true, so pending should already be cleared again
    expect(summary!.pendingRestart).toBe(false);
    expect(h.systemd.calls).toContain(`restart ${FIXTURE_INSTANCE_NAME}.service`);
  });

  it("marks pending-restart without restarting when restart: false is passed", async () => {
    await h.service.createInstance(FIXTURE_INSTANCE_NAME, minimalConfig());

    await h.service.updateInstanceOptions(FIXTURE_INSTANCE_NAME, { jsonLogging: true }, { restart: false });

    const [summary] = await h.service.listInstances();
    expect(summary!.pendingRestart).toBe(true);
    expect(h.systemd.calls).not.toContain(`restart ${FIXTURE_INSTANCE_NAME}.service`);
  });

  it("throws InstanceNotFoundError for a nonexistent instance", async () => {
    await expect(h.service.updateInstanceOptions("does_not_exist", { jsonLogging: true })).rejects.toBeInstanceOf(InstanceNotFoundError);
  });

  it("carries jsonLogging forward across a rename", async () => {
    await h.service.createInstance(FIXTURE_INSTANCE_NAME, minimalConfig());
    await h.service.updateInstanceOptions(FIXTURE_INSTANCE_NAME, { jsonLogging: true });

    await h.service.renameInstance(FIXTURE_INSTANCE_NAME, "rtl_renamed");

    expect(h.systemd.unitFiles.get("rtl_renamed.service")).toContain("ExecStart=/usr/local/bin/rtl_airband -F -e -j -c");
    const [summary] = await h.service.listInstances();
    expect(summary!.jsonLogging).toBe(true);
  });

  it("drops the stored option when the instance is deleted", async () => {
    await h.service.createInstance(FIXTURE_INSTANCE_NAME, minimalConfig());
    await h.service.updateInstanceOptions(FIXTURE_INSTANCE_NAME, { jsonLogging: true });

    await h.service.deleteInstance(FIXTURE_INSTANCE_NAME);
    await h.service.createInstance(FIXTURE_INSTANCE_NAME, minimalConfig());

    const [summary] = await h.service.listInstances();
    expect(summary!.jsonLogging).toBe(false);
  });

  it("persists across a fresh InstanceOptionsStore reading the same directory", async () => {
    await h.service.createInstance(FIXTURE_INSTANCE_NAME, minimalConfig());
    await h.service.updateInstanceOptions(FIXTURE_INSTANCE_NAME, { jsonLogging: true });

    const reloaded = new InstanceOptionsStore(h.instancesDir);
    expect(await reloaded.get(FIXTURE_INSTANCE_NAME)).toEqual({ jsonLogging: true });
  });
});
