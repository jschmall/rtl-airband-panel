import type { RtlAirbandConfig } from "../types/config.js";
import type { ValidationIssue, ValidationResult } from "../types/config.js";
import type { HardwareSnapshot } from "../generated/HardwareSnapshot";
import type { HardwareHistory } from "../generated/HardwareHistory";
import type { AirbandBuild } from "../generated/AirbandBuild";

export type { HardwareSnapshot } from "../generated/HardwareSnapshot";
export type { HardwareHistory } from "../generated/HardwareHistory";
export type { HardwareHistoryPoint } from "../generated/HardwareHistoryPoint";
export type { InstanceHardware } from "../generated/InstanceHardware";
export type { SdrHealth } from "../generated/SdrHealth";
export type { ChannelHealth } from "../generated/ChannelHealth";
export type { AirbandBuild } from "../generated/AirbandBuild";

export interface InstanceSummary {
  name: string;
  confPath: string;
  unit: string;
  /** True if the .conf on disk has been saved since the running unit last (re)started, so it's not live yet. */
  pendingRestart: boolean;
  /** Whether this instance's unit is started with -j (single-line JSON log output). See InstanceOptions.jsonLogging. */
  jsonLogging: boolean;
  /** Account the unit's User=/Group= are set to, if configured. See InstanceOptions.serviceUser/serviceGroup. */
  serviceUser?: string;
  serviceGroup?: string;
  /** This instance's current systemd unit status, including uptime/last-restart via activeEnterTimestamp. */
  status: UnitStatus;
  /** Every free-text term worth matching a global search against -- channel labels, frequencies (MHz), modulations, device type/serial. */
  searchFields: string[];
  /** Distinct active channel frequencies, Hz ascending (Rust panel only). */
  frequencies?: number[];
}

export interface InstanceOptions {
  jsonLogging: boolean;
  serviceUser?: string;
  serviceGroup?: string;
}

export type UnitActiveState = "active" | "inactive" | "activating" | "deactivating" | "failed" | "unknown";

export interface UnitStatus {
  unit: string;
  activeState: UnitActiveState;
  subState: string;
  /** ISO 8601 -- when this unit last transitioned to active. Doubles as uptime source and last-(re)started time. Undefined if never active or unparseable. */
  activeEnterTimestamp?: string;
}

export interface LogLine {
  timestamp: string;
  message: string;
  /** Severity, when the line is one of rtl_airband's -j JSON log lines (Rust panel only). */
  level?: string;
}

/** How a change would reach the running process -- see airband-supervisor's plan.rs. */
export type ApplyMethod = "no_change" | "live" | "restart";

/** Prediction of what applying a config change does (Rust panel only; absent from the TS backend). */
export interface PlanReport {
  method: ApplyMethod;
  /** Changes reload_diff will apply live. */
  live: string[];
  /** Changes that need a restart of this instance's unit. */
  restart: string[];
  /** Audio interruptions a live apply causes (channels re-created, device reopened). */
  interrupts: string[];
  /** False when the panel never started this instance, so the current file was assumed to be what's running. */
  baselineKnown: boolean;
}

export interface WriteResult {
  warnings: ValidationIssue[];
  status: UnitStatus;
  /** The written config's new version — pass as `ifMatch` on the next updateConfig call. */
  version: string;
  /** What applying this save to the running process does (Rust panel, saves without restart). */
  plan?: PlanReport;
}

/** Outcome of a dynamic_reload `reload_diff` attempt -- see InstanceService.applyConfigLive on the backend. */
export type LiveApplyOutcome =
  | { attempted: true; applied: string[]; skippedRequiresRestart: string[] }
  | {
      attempted: false;
      reason: "no-control-socket" | "unreachable" | "protocol-error" | "cooldown" | "stock-rtl-airband";
      detail?: string;
    };

export interface ApplyLiveResult {
  warnings: ValidationIssue[];
  status: UnitStatus;
  version: string;
  liveApply: LiveApplyOutcome;
  plan?: PlanReport;
}

export interface ConfigWithVersion {
  config: RtlAirbandConfig;
  /** Identifies this exact on-disk content; null if the server didn't send one (e.g. an older server). Pass to updateConfig's `ifMatch` to detect a conflicting edit. */
  version: string | null;
}

export interface StatSample {
  metric: string;
  labels: Record<string, string>;
  value: number;
}

export interface HistoryPoint {
  ts: number;
  value: number;
}

export interface InstanceStatsSummary {
  bufferOverflowTotal: number;
  outputOverrunTotal: number;
  inputsDroppingCount: number;
  /**
   * Sum of every output-side failure counter (icecast_disconnect_count,
   * lame_encode_failure_count, file_write_failure_count,
   * udp_stream_dropped_packet_count, pulse_disconnect_count,
   * rdio_scanner_queue_drop_count, rdio_scanner_upload_failure_count) across
   * every device/channel/output and mixer/output series. Excludes
   * icecast_backlog_exceeded_count (a subset of icecast_disconnect_count) and
   * pulse_underflow_count/pulse_overflow_count (expected under normal load).
   */
  outputFailureTotal: number;
  /** Undefined when the instance's build doesn't report process_cpu_seconds_total. */
  processCpuSeconds?: number;
}

export interface HistoryParams {
  metric: string;
  labels?: Record<string, string>;
  sinceMs?: number;
  untilMs?: number;
}

interface ApiErrorBody {
  error: string;
  errors?: ValidationIssue[];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody
  ) {
    super(body.error || `Request failed with status ${status}`);
    this.name = "ApiError";
  }
}

const API_BASE = "/api";

/** URL for the live-follow log stream (SSE) -- an EventSource connects here directly, so it needs a plain URL rather than the `request` helper's fetch-and-parse shape. */
export function logsStreamUrl(name: string): string {
  return `${API_BASE}/instances/${encodeURIComponent(name)}/logs/stream`;
}

async function requestRaw(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body !== undefined ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body: ApiErrorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body);
  }
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await requestRaw(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listInstances: (): Promise<InstanceSummary[]> => request("/instances"),

  getConfig: async (name: string): Promise<ConfigWithVersion> => {
    const res = await requestRaw(`/instances/${encodeURIComponent(name)}`);
    return { config: (await res.json()) as RtlAirbandConfig, version: res.headers.get("etag") };
  },

  getHealth: (name: string): Promise<UnitStatus> => request(`/instances/${encodeURIComponent(name)}/health`),

  /** Every instance's health in one request -- what the sidebar polls, instead of fanning out to one getHealth() call per instance. */
  getAllHealth: (): Promise<Record<string, UnitStatus>> => request("/instances/health"),

  /** Unredacted config -- only ever called when the user clicks "Show" on a field still holding the redaction sentinel. */
  getSecrets: (name: string): Promise<RtlAirbandConfig> => request(`/instances/${encodeURIComponent(name)}/secrets`),

  /** Runs the same validation a save would, without writing anything -- lets the UI surface errors before Save. */
  validate: (name: string, config: RtlAirbandConfig): Promise<ValidationResult> =>
    request(`/instances/${encodeURIComponent(name)}/validate`, {
      method: "POST",
      body: JSON.stringify(config),
    }),

  updateConfig: (name: string, config: RtlAirbandConfig, options: { restart?: boolean; ifMatch?: string } = {}): Promise<WriteResult> =>
    request(`/instances/${encodeURIComponent(name)}?restart=${options.restart ?? true}`, {
      method: "PUT",
      body: JSON.stringify(config),
      headers: options.ifMatch !== undefined ? { "If-Match": options.ifMatch } : undefined,
    }),

  /** Writes the config, then asks the running process to live-apply whatever it safely can via its dynamic_reload control socket, instead of restarting. Only meaningful when the config has control_socket_path set. */
  applyConfigLive: (name: string, config: RtlAirbandConfig, options: { ifMatch?: string } = {}): Promise<ApplyLiveResult> =>
    request(`/instances/${encodeURIComponent(name)}/apply-live`, {
      method: "POST",
      body: JSON.stringify(config),
      headers: options.ifMatch !== undefined ? { "If-Match": options.ifMatch } : undefined,
    }),

  createInstance: (name: string, config: RtlAirbandConfig): Promise<WriteResult> =>
    request("/instances", {
      method: "POST",
      body: JSON.stringify({ name, config }),
    }),

  deleteInstance: (name: string): Promise<void> =>
    request(`/instances/${encodeURIComponent(name)}`, { method: "DELETE" }),

  restartInstance: (name: string): Promise<UnitStatus> =>
    request(`/instances/${encodeURIComponent(name)}/restart`, { method: "POST" }),

  /** Restarts every instance with a saved-but-not-applied config; each result is independent. */
  restartPending: (): Promise<Record<string, { status: UnitStatus } | { error: string }>> =>
    request("/instances/restart-pending", { method: "POST" }),

  /**
   * Predicts what applying `config` to the running process would do, without
   * writing anything. Resolves to null against a backend without this endpoint
   * (the TypeScript API), so callers can simply hide the preview.
   */
  planChange: async (name: string, config: RtlAirbandConfig): Promise<PlanReport | null> => {
    try {
      return await request<PlanReport>(`/instances/${encodeURIComponent(name)}/plan`, {
        method: "POST",
        body: JSON.stringify(config),
      });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null;
      throw err;
    }
  },

  updateInstanceOptions: (name: string, patch: Partial<InstanceOptions>): Promise<{ status: UnitStatus; options: InstanceOptions }> =>
    request(`/instances/${encodeURIComponent(name)}/options`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  renameInstance: (name: string, newName: string): Promise<WriteResult> =>
    request(`/instances/${encodeURIComponent(name)}/rename`, {
      method: "POST",
      body: JSON.stringify({ newName }),
    }),

  /** Which rtl_airband build the instance runs: the jschmall fork, a stock build, or unknown (Rust panel only). */
  getAirband: (name: string): Promise<AirbandBuild> => request(`/instances/${encodeURIComponent(name)}/airband`),

  /** Every instance's SDRs with live readings where the control socket answers `status` (Rust panel only). */
  getHardware: (): Promise<HardwareSnapshot> => request("/hardware"),

  /** Each SDR's recorded readings from the last `windowMs` (default 5 minutes). */
  getHardwareHistory: (windowMs?: number): Promise<HardwareHistory> =>
    request(windowMs === undefined ? "/hardware/history" : `/hardware/history?windowMs=${windowMs}`),

  getLatestStats: (name: string): Promise<StatSample[]> => request(`/instances/${encodeURIComponent(name)}/stats/latest`),

  /** Rolled-up buffer-overflow/output-overrun/dropping-input totals for every instance, keyed by name -- what the landing-page health dashboard polls. */
  getInstanceStatsSummary: (): Promise<Record<string, InstanceStatsSummary>> => request("/instances/stats-summary"),

  getStatsHistory: (name: string, params: HistoryParams): Promise<HistoryPoint[]> => {
    const query = new URLSearchParams({ metric: params.metric });
    if (params.labels) query.set("labels", JSON.stringify(params.labels));
    if (params.sinceMs !== undefined) query.set("sinceMs", String(params.sinceMs));
    if (params.untilMs !== undefined) query.set("untilMs", String(params.untilMs));
    return request(`/instances/${encodeURIComponent(name)}/stats/history?${query.toString()}`);
  },
};
