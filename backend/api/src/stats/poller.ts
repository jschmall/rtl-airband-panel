import { readFile, stat } from "node:fs/promises";
import type { ConfigStore } from "../config-store.js";
import { parsePrometheusText } from "./prometheus-parser.js";
import type { StatsStore } from "./store.js";

export interface PollerOptions {
  intervalMs: number;
  retentionDays: number;
}

// stats_filepath comes straight from an instance's own config, with no
// restriction on what it points at (see backend/validate's post_write_script
// warning for the same category of concern) — a misconfigured or malicious
// instance could point it at something huge or slow (a device node, a FIFO, a
// network mount). These bound the damage one bad instance's stats file can do
// to the whole poll cycle: a real RTLSDR-Airband stats snapshot is a few KB.
const MAX_STATS_FILE_BYTES = 5 * 1024 * 1024;
const READ_TIMEOUT_MS = 5000;

/** Rejects if `promise` hasn't settled within `ms`. Doesn't cancel the underlying read — fs/promises has no built-in way to abort a readFile mid-flight — it just stops the poller from waiting on it, so one stuck read can't stall every other instance's poll. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err as Error);
      }
    );
  });
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
  // Tracks whichever pollOnce() call is currently running (or the last one
  // that finished), so stop() can await it — closing the stats DB out from
  // under a poll cycle still in flight would otherwise throw inside a
  // fire-and-forget promise with no catch, i.e. an unhandled rejection.
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly statsStore: StatsStore,
    private readonly options: PollerOptions,
    private readonly onError: (instance: string, err: unknown) => void = () => undefined
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.inFlight = this.pollOnce();
    }, this.options.intervalMs);
    this.timer.unref();
    this.inFlight = this.pollOnce();
  }

  /** Stops scheduling further polls and waits for any poll currently in flight to finish, so it's safe to close the stats DB right after this resolves. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
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
    try {
      this.statsStore.prune(this.options.retentionDays);
    } catch (err) {
      this.onError("<prune>", err);
    }
  }

  private async pollInstance(name: string): Promise<void> {
    const config = await this.configStore.read(name);
    if (!config.stats_filepath) return;

    let fileStat: { mtimeMs: number; size: number };
    try {
      fileStat = await stat(config.stats_filepath);
    } catch {
      return; // stats file doesn't exist yet -- instance hasn't run/written stats
    }

    if (this.lastMtimeMs.get(name) === fileStat.mtimeMs) return;
    this.lastMtimeMs.set(name, fileStat.mtimeMs);

    if (fileStat.size > MAX_STATS_FILE_BYTES) {
      throw new Error(`stats_filepath (${config.stats_filepath}) is ${fileStat.size} bytes, over the ${MAX_STATS_FILE_BYTES}-byte cap -- refusing to read it`);
    }

    const text = await withTimeout(
      readFile(config.stats_filepath, "utf8"),
      READ_TIMEOUT_MS,
      `reading stats_filepath (${config.stats_filepath}) timed out after ${READ_TIMEOUT_MS}ms`
    );
    const samples = parsePrometheusText(text);
    this.statsStore.insertBatch(name, samples, Date.now());
  }
}
