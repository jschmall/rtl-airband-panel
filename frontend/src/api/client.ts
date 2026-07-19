import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "@rtl-airband-panel/validate";

export interface InstanceSummary {
  name: string;
  confPath: string;
  unit: string;
}

export type UnitActiveState = "active" | "inactive" | "activating" | "deactivating" | "failed" | "unknown";

export interface UnitStatus {
  unit: string;
  activeState: UnitActiveState;
  subState: string;
}

export interface WriteResult {
  warnings: ValidationIssue[];
  status: UnitStatus;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body !== undefined ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body: ApiErrorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listInstances: (): Promise<InstanceSummary[]> => request("/instances"),

  getConfig: (name: string): Promise<RtlAirbandConfig> => request(`/instances/${encodeURIComponent(name)}`),

  getHealth: (name: string): Promise<UnitStatus> => request(`/instances/${encodeURIComponent(name)}/health`),

  updateConfig: (name: string, config: RtlAirbandConfig): Promise<WriteResult> =>
    request(`/instances/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(config),
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

  getLatestStats: (name: string): Promise<StatSample[]> => request(`/instances/${encodeURIComponent(name)}/stats/latest`),

  getStatsHistory: (name: string, params: HistoryParams): Promise<HistoryPoint[]> => {
    const query = new URLSearchParams({ metric: params.metric });
    if (params.labels) query.set("labels", JSON.stringify(params.labels));
    if (params.sinceMs !== undefined) query.set("sinceMs", String(params.sinceMs));
    if (params.untilMs !== undefined) query.set("untilMs", String(params.untilMs));
    return request(`/instances/${encodeURIComponent(name)}/stats/history?${query.toString()}`);
  },
};
