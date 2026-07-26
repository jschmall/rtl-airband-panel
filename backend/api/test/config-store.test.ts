import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { ConfigStore } from "../src/config-store.js";
import { makeScratchDir, cleanupScratchDir } from "./helpers.js";

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

let instancesDir: string;
let store: ConfigStore;

beforeEach(async () => {
  instancesDir = await makeScratchDir();
  store = new ConfigStore(instancesDir);
});

afterEach(async () => {
  await cleanupScratchDir(instancesDir);
});

describe("ConfigStore backups", () => {
  it("creates no backup on the first write (nothing to back up yet)", async () => {
    await store.write("rtl_x", minimalConfig());
    const backupsDir = path.join(instancesDir, ".backups", "rtl_x");
    await expect(readdir(backupsDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("backs up the previous content before an overwrite", async () => {
    await store.write("rtl_x", minimalConfig({ stats_filepath: "/tmp/original.txt" }));
    await store.write("rtl_x", minimalConfig({ stats_filepath: "/tmp/changed.txt" }));

    const backupsDir = path.join(instancesDir, ".backups", "rtl_x");
    const files = await readdir(backupsDir);
    expect(files).toHaveLength(1);

    const backedUp = await readFile(path.join(backupsDir, files[0]!), "utf8");
    expect(backedUp).toContain("/tmp/original.txt");
    expect(backedUp).not.toContain("/tmp/changed.txt");
  });

  it("keeps one backup per prior write", async () => {
    await store.write("rtl_x", minimalConfig());
    for (let i = 0; i < 3; i++) {
      await store.write("rtl_x", minimalConfig({ stats_filepath: `/tmp/${i}.txt` }));
    }
    const backupsDir = path.join(instancesDir, ".backups", "rtl_x");
    expect(await readdir(backupsDir)).toHaveLength(3);
  });

  it("prunes the oldest backups beyond the retention cap", async () => {
    await store.write("rtl_x", minimalConfig());
    for (let i = 0; i < 15; i++) {
      await store.write("rtl_x", minimalConfig({ stats_filepath: `/tmp/${i}.txt` }));
    }
    const backupsDir = path.join(instancesDir, ".backups", "rtl_x");
    const files = await readdir(backupsDir);
    expect(files.length).toBeLessThanOrEqual(10);
  });

  it("never lists the .backups directory as an instance", async () => {
    await store.write("rtl_x", minimalConfig());
    await store.write("rtl_x", minimalConfig({ stats_filepath: "/tmp/again.txt" }));

    const list = await store.list();
    expect(list.map((i) => i.name)).toEqual(["rtl_x"]);
  });

  it("backs up separately per instance", async () => {
    await store.write("rtl_a", minimalConfig());
    await store.write("rtl_b", minimalConfig());
    await store.write("rtl_a", minimalConfig({ stats_filepath: "/tmp/a2.txt" }));

    expect(await readdir(path.join(instancesDir, ".backups", "rtl_a"))).toHaveLength(1);
    await expect(readdir(path.join(instancesDir, ".backups", "rtl_b"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
