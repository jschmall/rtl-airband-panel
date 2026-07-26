import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Tracks which instances have a config saved to disk that their running
 * process hasn't picked up yet (RTLSDR-Airband has no live-reload, so a
 * write-only save always leaves the running process stale until an
 * explicit restart -- see CLAUDE.md). Persisted as a small JSON file next
 * to the instances' own .conf files so the flag survives page refreshes,
 * browser restarts, and API process restarts alike, without adding any
 * privilege beyond what ConfigStore already needs (write access to
 * instancesDir).
 */
export class PendingRestartStore {
  private readonly filePath: string;
  private pending = new Set<string>();
  private ready: Promise<void> | null = null;

  constructor(instancesDir: string) {
    this.filePath = path.join(instancesDir, ".pending-restarts.json");
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
    if (Array.isArray(parsed)) {
      for (const name of parsed) if (typeof name === "string") this.pending.add(name);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.ready) this.ready = this.load();
    return this.ready;
  }

  async list(): Promise<string[]> {
    await this.ensureLoaded();
    return [...this.pending].sort((a, b) => a.localeCompare(b));
  }

  async has(name: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.pending.has(name);
  }

  async mark(name: string): Promise<void> {
    await this.ensureLoaded();
    if (this.pending.has(name)) return;
    this.pending.add(name);
    await this.persist();
  }

  async clear(name: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.pending.has(name)) return;
    this.pending.delete(name);
    await this.persist();
  }

  /**
   * Writes via a temp file + rename so a crash mid-write can never leave a
   * truncated/corrupt state file. randomUUID (not just pid+timestamp) so two
   * overlapping persist() calls (e.g. concurrent saves to different
   * instances sharing this same store) can never generate the same temp
   * filename and have one rename fail with ENOENT after the other consumes it.
   */
  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    await fs.writeFile(tmp, JSON.stringify([...this.pending].sort((a, b) => a.localeCompare(b))), "utf8");
    await fs.rename(tmp, this.filePath);
  }
}
