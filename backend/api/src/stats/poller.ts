import { readFile, stat } from "node:fs/promises";
import type { ConfigStore } from "../config-store.js";
import { parsePrometheusText } from "./prometheus-parser.js";
import type { StatsStore } from "./store.js";

export interface PollerOptions {
  intervalMs: number;
  retentionDays: number;
}

/**
 * Periodically reads each instance's stats_filepath and records a snapshot.
 * RTLSDR-Airband rewrites that file every ~15s while running; a stopped
 * instance leaves its last-written file in place forever, so this skips a
 * read (via mtime) once nothing has changed since the last poll, rather
 * than inserting identical duplicate rows on every cycle.
 */
export class StatsPoller {
  private timer: NodeJS.Timeout | undefined;
  private readonly lastMtimeMs = new Map<string, number>();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly statsStore: StatsStore,
    private readonly options: PollerOptions,
    private readonly onError: (instance: string, err: unknown) => void = () => undefined
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollOnce(), this.options.intervalMs);
    this.timer.unref();
    void this.pollOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async pollOnce(): Promise<void> {
    const instances = await this.configStore.list();
    for (const info of instances) {
      try {
        await this.pollInstance(info.name);
      } catch (err) {
        this.onError(info.name, err);
      }
    }
    this.statsStore.prune(this.options.retentionDays);
  }

  private async pollInstance(name: string): Promise<void> {
    const config = await this.configStore.read(name);
    if (!config.stats_filepath) return;

    let mtimeMs: number;
    try {
      mtimeMs = (await stat(config.stats_filepath)).mtimeMs;
    } catch {
      return; // stats file doesn't exist yet -- instance hasn't run/written stats
    }

    if (this.lastMtimeMs.get(name) === mtimeMs) return;
    this.lastMtimeMs.set(name, mtimeMs);

    const text = await readFile(config.stats_filepath, "utf8");
    const samples = parsePrometheusText(text);
    this.statsStore.insertBatch(name, samples, Date.now());
  }
}
