import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue, ValidationResult } from "@rtl-airband-panel/validate";

export interface InstanceSummary {
  name: string;
  confPath: string;
  unit: string;
  /** True if the .conf on disk has been saved since the running unit last (re)started, so it's not live yet. */
  pendingRestart: boolean;
  /** Whether this instance's unit is started with -j (single-line JSON log output). See InstanceOptions.jsonLogging. */
  jsonLogging: boolean;
  /** This instance's current systemd unit status, including uptime/last-restart via activeEnterTimestamp. */
  status: UnitStatus;
  /** Every free-text term worth matching a global search against -- channel labels, frequencies (MHz), modulations, device type/serial. */
  searchFields: string[];
}

export interface InstanceOptions {
  jsonLogging: boolean;
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
}

export interface WriteResult {
  warnings: ValidationIssue[];
  status: UnitStatus;
  /** The written config's new version — pass as `ifMatch` on the next updateConfig call. */
  version: string;
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

  createInstance: (name: string, config: RtlAirbandConfig): Promise<WriteResult> =>
    request("/instances", {
      method: "POST",
      body: JSON.stringify({ name, config }),
    }),

  deleteInstance: (name: string): Promise<void> =>
    request(`/instances/${encodeURIComponent(name)}`, { method: "DELETE" }),

  restartInstance: (name: string): Promise<UnitStatus> =>
    request(`/instances/${encodeURIComponent(name)}/restart`, { method: "POST" }),

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

  getLatestStats: (name: string): Promise<StatSample[]> => request(`/instances/${encodeURIComponent(name)}/stats/latest`),

  getStatsHistory: (name: string, params: HistoryParams): Promise<HistoryPoint[]> => {
    const query = new URLSearchParams({ metric: params.metric });
    if (params.labels) query.set("labels", JSON.stringify(params.labels));
    if (params.sinceMs !== undefined) query.set("sinceMs", String(params.sinceMs));
    if (params.untilMs !== undefined) query.set("untilMs", String(params.untilMs));
    return request(`/instances/${encodeURIComponent(name)}/stats/history?${query.toString()}`);
  },
};
