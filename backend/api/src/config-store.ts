import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
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

/**
 * Backups live in a dot-prefixed subdirectory so `list()` (which only looks
 * at top-level `*.conf` files) never mistakes one for an instance, and a
 * backup's own name can never collide with a real instance name.
 */
const BACKUP_DIR_NAME = ".backups";

/** How many prior versions of a single instance's .conf to keep before pruning the oldest. */
const MAX_BACKUPS_PER_INSTANCE = 10;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  raw: string;
  config: RtlAirbandConfig;
  version: string;
}

/** File I/O over the .conf directory. No systemd concerns live here. */
export class ConfigStore {
  // Parsing is expensive (libconfig-style tokenize/parse/domain-map) and this
  // store is read once per instance on every stats-poll tick and every
  // GET /instances call, almost always against a file that hasn't changed
  // since the last read -- so cache the parse and only redo it when the
  // file's mtime/size no longer match what's cached.
  private readonly cache = new Map<string, CacheEntry>();

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
    return (await this.readCached(name)).config;
  }

  async readRaw(name: string): Promise<string> {
    return (await this.readCached(name)).raw;
  }

  /** Like `read`, but also returns a version identifier for the exact content read — see `hashConfigText`. */
  async readWithVersion(name: string): Promise<{ config: RtlAirbandConfig; version: string }> {
    const { config, version } = await this.readCached(name);
    return { config, version };
  }

  /**
   * Returns the cached parse if the file's mtime/size still match what's
   * cached, otherwise re-reads and re-parses and refreshes the cache. A
   * stat-then-maybe-read instead of always-read so an unchanged file costs
   * one stat() call instead of a full read+parse.
   */
  private async readCached(name: string): Promise<CacheEntry> {
    const target = confFilePath(this.instancesDir, name);
    const stat = await fs.stat(target);
    const cached = this.cache.get(name);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached;
    }
    const raw = await fs.readFile(target, "utf8");
    const entry: CacheEntry = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      raw,
      config: parseConfigFile(raw),
      version: hashConfigText(raw),
    };
    this.cache.set(name, entry);
    return entry;
  }

  /**
   * Writes via a temp file + rename so a crash mid-write can never leave a
   * truncated/corrupt .conf. Backs up whatever was there before overwriting
   * it — a save that's valid but wrong (bad frequency, wrong Icecast target,
   * ...) otherwise has no way back except retyping it from memory. Returns
   * the new version identifier.
   */
  async write(name: string, config: RtlAirbandConfig): Promise<string> {
    await this.backupBeforeOverwrite(name);
    const target = confFilePath(this.instancesDir, name);
    const text = serializeConfigFile(config);
    // randomUUID (not just pid+timestamp) so two overlapping writes to the same
    // instance from the same process can never generate the same temp filename --
    // they used to be able to, within the same millisecond, and the loser's rename
    // would then throw ENOENT because the winner's rename had already consumed it.
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    await fs.writeFile(tmp, text, "utf8");
    await fs.rename(tmp, target);
    // Invalidate rather than repopulate: a stat() right after rename can race
    // filesystem mtime resolution, so it's simpler to just let the next
    // read re-stat from scratch than to risk caching a stale entry.
    this.cache.delete(name);
    return hashConfigText(text);
  }

  async remove(name: string): Promise<void> {
    await fs.rm(confFilePath(this.instancesDir, name), { force: true });
    this.cache.delete(name);
  }

  private async backupBeforeOverwrite(name: string): Promise<void> {
    let existing: string;
    try {
      existing = await this.readRaw(name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // new instance, nothing to back up
      throw err;
    }

    const backupDir = path.join(this.instancesDir, BACKUP_DIR_NAME, name);
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // randomUUID for the same reason as write()'s temp file: two concurrent saves of the
    // same instance could otherwise compute an identical backup filename and silently
    // overwrite one snapshot with the other instead of keeping both.
    await fs.writeFile(path.join(backupDir, `${stamp}-${process.pid}-${randomUUID()}.conf`), existing, "utf8");

    const entries = (await fs.readdir(backupDir)).filter((f) => f.endsWith(".conf")).sort();
    const excess = entries.slice(0, Math.max(0, entries.length - MAX_BACKUPS_PER_INSTANCE));
    await Promise.all(excess.map((f) => fs.rm(path.join(backupDir, f), { force: true })));
  }
}
