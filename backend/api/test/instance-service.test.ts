import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { InstanceAlreadyExistsError, InstanceNotFoundError, ValidationFailedError } from "../src/instance-service.js";
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
      { name: FIXTURE_INSTANCE_NAME, confPath: expect.stringContaining(FIXTURE_INSTANCE_NAME), unit: `${FIXTURE_INSTANCE_NAME}.service` },
    ]);

    const config = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    expect(config.devices).toHaveLength(1);
    expect(config.devices[0]!.channels).toHaveLength(22);
  });

  it("throws InstanceNotFoundError for a nonexistent instance", async () => {
    await expect(h.service.getConfig("does_not_exist")).rejects.toBeInstanceOf(InstanceNotFoundError);
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
      { name: "rtl_renamed", confPath: expect.stringContaining("rtl_renamed"), unit: "rtl_renamed.service" },
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
      { name: FIXTURE_INSTANCE_NAME, confPath: expect.stringContaining(FIXTURE_INSTANCE_NAME), unit: `${FIXTURE_INSTANCE_NAME}.service` },
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

    // old conf untouched, new conf rolled back, old unit restarted
    expect(await h.service.listInstances()).toEqual([
      { name: FIXTURE_INSTANCE_NAME, confPath: expect.stringContaining(FIXTURE_INSTANCE_NAME), unit: `${FIXTURE_INSTANCE_NAME}.service` },
    ]);
    expect(await h.service.getConfig(FIXTURE_INSTANCE_NAME)).toEqual(before);
    expect(h.systemd.unitFiles.has("rtl_renamed.service")).toBe(false);
    expect(h.systemd.calls.at(-1)).toBe(`start ${FIXTURE_INSTANCE_NAME}.service`);
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
