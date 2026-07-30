import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface InstanceOptions {
  /**
   * Adds `-j` to the generated unit's ExecStart, so the running process emits
   * single-line JSON log records instead of plain text. Fork-only; requires
   * RTLSDR-Airband built from jschmall/RTLSDR-Airband — a vanilla-upstream
   * binary doesn't recognize -j and would refuse to start, so this defaults
   * to false and is never turned on implicitly.
   */
  jsonLogging: boolean;
}

const DEFAULT_OPTIONS: InstanceOptions = { jsonLogging: false };

/**
 * Tracks per-instance settings that affect the generated systemd unit's
 * ExecStart line (e.g. the -j flag) but aren't part of the RTLSDR-Airband
 * .conf file itself, so they can't be recovered by re-parsing the config --
 * and the panel never reads back an installed unit file's content either
 * (unit files are write-only/regenerated fresh, see InstanceService). Persisted
 * the same way as PendingRestartStore: a small JSON file next to the
 * instances' own .conf files, so it survives page refreshes, browser
 * restarts, and API process restarts alike.
 */
export class InstanceOptionsStore {
  private readonly filePath: string;
  private options = new Map<string, InstanceOptions>();
  private ready: Promise<void> | null = null;

  constructor(instancesDir: string) {
    this.filePath = path.join(instancesDir, ".instance-options.json");
  }

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const jsonLogging = (value as Record<string, unknown>)["jsonLogging"];
      this.options.set(name, { jsonLogging: jsonLogging === true });
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.ready) this.ready = this.load();
    return this.ready;
  }

  async get(name: string): Promise<InstanceOptions> {
    await this.ensureLoaded();
    return this.options.get(name) ?? DEFAULT_OPTIONS;
  }

  async set(name: string, options: Partial<InstanceOptions>): Promise<InstanceOptions> {
    await this.ensureLoaded();
    const merged = { ...(this.options.get(name) ?? DEFAULT_OPTIONS), ...options };
    this.options.set(name, merged);
    await this.persist();
    return merged;
  }

  async remove(name: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.options.has(name)) return;
    this.options.delete(name);
    await this.persist();
  }

  /** Moves name's stored options to a new key, e.g. on instance rename. No-op if name has no stored (non-default) options. */
  async rename(name: string, newName: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.options.get(name);
    if (!existing) return;
    this.options.delete(name);
    this.options.set(newName, existing);
    await this.persist();
  }

  /** Writes via a temp file + rename, same atomic-write discipline as PendingRestartStore. */
  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    const obj: Record<string, InstanceOptions> = {};
    for (const [name, options] of [...this.options.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      obj[name] = options;
    }
    await fs.writeFile(tmp, JSON.stringify(obj), "utf8");
    await fs.rename(tmp, this.filePath);
  }
}
