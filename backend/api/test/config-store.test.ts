import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fsPromises } from "node:fs";
import { readdir, readFile, writeFile, utimes } from "node:fs/promises";
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

describe("ConfigStore parse cache", () => {
  it("does not re-read the file on a second read when nothing changed", async () => {
    await store.write("rtl_x", minimalConfig());
    const first = await store.read("rtl_x");

    const readFileSpy = vi.spyOn(fsPromises, "readFile");
    const second = await store.read("rtl_x");

    expect(readFileSpy).not.toHaveBeenCalled();
    expect(second).toEqual(first);
    readFileSpy.mockRestore();
  });

  it("re-reads and reflects new content when the file changes on disk", async () => {
    await store.write("rtl_x", minimalConfig({ stats_filepath: "/tmp/original.txt" }));
    await store.read("rtl_x"); // populate the cache

    const confPath = path.join(instancesDir, "rtl_x.conf");
    const raw = await readFile(confPath, "utf8");
    await writeFile(confPath, raw.replace("/tmp/original.txt", "/tmp/changed-externally.txt"), "utf8");
    // Force a distinct mtime in case the write above lands within the same
    // filesystem timestamp granularity as the cached stat.
    const future = new Date(Date.now() + 5000);
    await utimes(confPath, future, future);

    const updated = await store.read("rtl_x");
    expect(updated.stats_filepath).toBe("/tmp/changed-externally.txt");
  });

  it("reflects new content immediately after write() invalidates the cache", async () => {
    await store.write("rtl_x", minimalConfig({ stats_filepath: "/tmp/a.txt" }));
    await store.read("rtl_x");
    await store.write("rtl_x", minimalConfig({ stats_filepath: "/tmp/b.txt" }));

    const updated = await store.read("rtl_x");
    expect(updated.stats_filepath).toBe("/tmp/b.txt");
  });

  it("drops the cache entry on remove()", async () => {
    await store.write("rtl_x", minimalConfig());
    await store.read("rtl_x");
    await store.remove("rtl_x");

    await expect(store.read("rtl_x")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("readRaw and readWithVersion share the same cache as read and see the same updates", async () => {
    await store.write("rtl_x", minimalConfig({ stats_filepath: "/tmp/a.txt" }));
    const { version: v1 } = await store.readWithVersion("rtl_x");

    await store.write("rtl_x", minimalConfig({ stats_filepath: "/tmp/b.txt" }));
    const { config, version: v2 } = await store.readWithVersion("rtl_x");
    const raw = await store.readRaw("rtl_x");

    expect(v2).not.toBe(v1);
    expect(config.stats_filepath).toBe("/tmp/b.txt");
    expect(raw).toContain("/tmp/b.txt");
  });
});
