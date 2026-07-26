import type { ConfigStore } from "../config-store.js";
import { assertValidInstanceName } from "../instance-name.js";
import { InstanceNotFoundError } from "../instance-service.js";
import { PollStatusTracker, type PollStatus } from "./poll-status.js";
import { formatPrometheusMetrics } from "./metrics-format.js";
import type { HistoryPoint, HistoryQuery, LatestSample, StatsStore } from "./store.js";

export interface ReadinessResult {
  ready: boolean;
  checks: Record<string, "ok" | string>;
}

export class StatsService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly statsStore: StatsStore,
    /** Shared with the real StatsPoller instance in index.ts; defaults to an always-empty tracker for callers (mostly tests) that don't run a poller. */
    private readonly pollStatus: PollStatusTracker = new PollStatusTracker()
  ) {}

  async latest(name: string): Promise<LatestSample[]> {
    await this.requireExists(name);
    return this.statsStore.latest(name);
  }

  async history(name: string, query: HistoryQuery): Promise<HistoryPoint[]> {
    await this.requireExists(name);
    return this.statsStore.history(name, query);
  }

  /** Per-instance stats-poll health — surfaces a silently-broken poll pipeline for one instance among many, previously visible only in server logs. */
  async getPollStatus(name: string): Promise<PollStatus> {
    await this.requireExists(name);
    return this.pollStatus.get(name);
  }

  /** A single Prometheus-format scrape covering every managed instance's latest stats, tagged by an `instance` label. */
  async metricsText(): Promise<string> {
    const infos = await this.configStore.list();
    const perInstance = new Map<string, LatestSample[]>();
    for (const { name } of infos) {
      perInstance.set(name, this.statsStore.latest(name));
    }
    return formatPrometheusMetrics(perInstance);
  }

  /**
   * Actually exercises the two things GET /health previously assumed rather
   * than checked: that the instances directory is readable, and that the
   * stats DB handle is usable. Doesn't touch systemd — there's no
   * unit-agnostic "is systemd/sudo working at all" call, and probing it on
   * every health check (which a monitor might hit every few seconds) would
   * mean shelling out to sudo that often for no real benefit.
   */
  async checkReadiness(): Promise<ReadinessResult> {
    const checks: Record<string, "ok" | string> = {};
    try {
      await this.configStore.list();
      checks.instancesDir = "ok";
    } catch (err) {
      checks.instancesDir = err instanceof Error ? err.message : String(err);
    }
    try {
      this.statsStore.ping();
      checks.statsDb = "ok";
    } catch (err) {
      checks.statsDb = err instanceof Error ? err.message : String(err);
    }
    return { ready: Object.values(checks).every((v) => v === "ok"), checks };
  }

  private async requireExists(name: string): Promise<void> {
    assertValidInstanceName(name);
    if (!(await this.configStore.exists(name))) throw new InstanceNotFoundError(name);
  }
}
