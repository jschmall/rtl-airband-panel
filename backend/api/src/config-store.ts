import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseConfigFile, serializeConfigFile, type RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { confFilePath, instanceNameFromConfFilename } from "./instance-name.js";

export interface InstanceFileInfo {
  name: string;
  confPath: string;
}

/**
 * A short, non-cryptographic identifier for "this exact .conf content" — used
 * as an optimistic-concurrency version, not for security. Long enough to make
 * accidental collisions a non-concern for a single instance's edit history.
 */
export function hashConfigText(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** File I/O over the .conf directory. No systemd concerns live here. */
export class ConfigStore {
  constructor(private readonly instancesDir: string) {}

  async list(): Promise<InstanceFileInfo[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.instancesDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const infos: InstanceFileInfo[] = [];
    for (const entry of entries) {
      const name = instanceNameFromConfFilename(entry);
      if (name === undefined) continue;
      infos.push({ name, confPath: path.join(this.instancesDir, entry) });
    }
    return infos.sort((a, b) => a.name.localeCompare(b.name));
  }

  async exists(name: string): Promise<boolean> {
    try {
      await fs.access(confFilePath(this.instancesDir, name));
      return true;
    } catch {
      return false;
    }
  }

  async read(name: string): Promise<RtlAirbandConfig> {
    const source = await fs.readFile(confFilePath(this.instancesDir, name), "utf8");
    return parseConfigFile(source);
  }

  async readRaw(name: string): Promise<string> {
    return fs.readFile(confFilePath(this.instancesDir, name), "utf8");
  }

  /** Like `read`, but also returns a version identifier for the exact content read — see `hashConfigText`. */
  async readWithVersion(name: string): Promise<{ config: RtlAirbandConfig; version: string }> {
    const raw = await this.readRaw(name);
    return { config: parseConfigFile(raw), version: hashConfigText(raw) };
  }

  /** Writes via a temp file + rename so a crash mid-write can never leave a truncated/corrupt .conf. Returns the new version identifier. */
  async write(name: string, config: RtlAirbandConfig): Promise<string> {
    const target = confFilePath(this.instancesDir, name);
    const text = serializeConfigFile(config);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, target);
    return hashConfigText(text);
  }

  async remove(name: string): Promise<void> {
    await fs.rm(confFilePath(this.instancesDir, name), { force: true });
  }
}
