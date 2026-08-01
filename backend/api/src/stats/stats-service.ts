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

export interface InstanceStatsSummary {
  /** Sum of buffer_overflow_count across every device on this instance. */
  bufferOverflowTotal: number;
  /**
   * Sum of output_overrun_count across every device *and* mixer on this
   * instance -- RTLSDR-Airband's output.cpp emits this metric labeled
   * either device="N" (a device with no mixer feeding its output) or
   * mixer="N" (a mixer's own output), so both must be counted, not just
   * the mixer-labeled ones.
   */
  outputOverrunTotal: number;
  /** Count of input_overrun_count series currently reporting a nonzero value (i.e. mixer inputs actively dropping samples), not a sum of their values. */
  inputsDroppingCount: number;
  /**
   * Sum of every output-side failure counter added in the fork's "failure/health
   * counters for every output type" change: icecast_disconnect_count,
   * lame_encode_failure_count, file_write_failure_count,
   * udp_stream_dropped_packet_count, pulse_disconnect_count,
   * rdio_scanner_queue_drop_count, rdio_scanner_upload_failure_count -- across
   * every device/channel/output and mixer/output series, same as
   * outputOverrunTotal above.
   *
   * Deliberately excludes: icecast_backlog_exceeded_count (the fork's own doc
   * comment calls this a subset of icecast_disconnect_count -- both increment
   * on the same event, so summing it too would double-count); and
   * pulse_underflow_count/pulse_overflow_count (expected under normal load,
   * same reason buffer_underrun_count isn't part of bufferOverflowTotal --
   * read those as a trend, not a problem count).
   */
  outputFailureTotal: number;
  /**
   * Latest process_cpu_seconds_total value, verbatim (it's already a single
   * process-wide counter, so there's nothing to sum across). Undefined --
   * not 0 -- when the instance hasn't reported this metric at all, e.g. a
   * build predating its addition, so the UI can distinguish "not supported"
   * from "genuinely idle."
   */
  processCpuSeconds?: number;
}

/** Output-side failure counters summed into outputFailureTotal -- see its doc comment for what's excluded and why. */
const OUTPUT_FAILURE_METRICS = new Set([
  "icecast_disconnect_count",
  "lame_encode_failure_count",
  "file_write_failure_count",
  "udp_stream_dropped_packet_count",
  "pulse_disconnect_count",
  "rdio_scanner_queue_drop_count",
  "rdio_scanner_upload_failure_count",
]);

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
   * Rolled-up problem-metric totals for every managed instance, keyed by
   * name -- one JSON sibling of metricsText()'s own per-instance loop, for
   * an at-a-glance dashboard that wants numbers, not a Prometheus scrape.
   * An instance with no polled samples yet reports all-zero totals rather
   * than being omitted, so a brand-new instance still shows up.
   */
  async latestSummaries(): Promise<Record<string, InstanceStatsSummary>> {
    const infos = await this.configStore.list();
    const result: Record<string, InstanceStatsSummary> = {};
    for (const { name } of infos) {
      let bufferOverflowTotal = 0;
      let outputOverrunTotal = 0;
      let inputsDroppingCount = 0;
      let outputFailureTotal = 0;
      let processCpuSeconds: number | undefined;
      for (const sample of this.statsStore.latest(name)) {
        if (OUTPUT_FAILURE_METRICS.has(sample.metric)) {
          outputFailureTotal += sample.value;
          continue;
        }
        switch (sample.metric) {
          case "buffer_overflow_count":
            bufferOverflowTotal += sample.value;
            break;
          case "output_overrun_count":
            outputOverrunTotal += sample.value;
            break;
          case "input_overrun_count":
            if (sample.value > 0) inputsDroppingCount += 1;
            break;
          case "process_cpu_seconds_total":
            processCpuSeconds = sample.value;
            break;
        }
      }
      result[name] = {
        bufferOverflowTotal,
        outputOverrunTotal,
        inputsDroppingCount,
        outputFailureTotal,
        ...(processCpuSeconds !== undefined ? { processCpuSeconds } : {}),
      };
    }
    return result;
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
