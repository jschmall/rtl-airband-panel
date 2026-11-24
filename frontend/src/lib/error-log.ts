import { useSyncExternalStore } from "react";
import { api, type ErrorLogEvent } from "../api/client.js";

/** Kinds that mark a restart or live apply: drawn as dividers, not counted as problems. */
export const MARKER_KINDS = new Set(["restart", "live-apply", "unexpected-restart"]);

export const isMarker = (e: ErrorLogEvent) => MARKER_KINDS.has(e.kind);

/** Counts toward the sidebar badge. */
export const isProblem = (e: ErrorLogEvent) => !isMarker(e) && (e.severity === "error" || e.severity === "warning");

const PAGE = 200;
const SEEN_KEY = "rtl-panel:errors-seen-id";

function loadSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

export interface ErrorLogState {
  /** Newest first; null until the first load. */
  events: ErrorLogEvent[] | null;
  /** The server may have older events than the oldest loaded. */
  hasMore: boolean;
  /** Highest event id this browser has seen on the Errors page; newer rows are marked there. */
  seenId: number;
  /** Events up to this id have been acknowledged; the panel stores it, so every browser agrees. */
  ackId: number;
  error: string | null;
}

let state: ErrorLogState = { events: null, hasMore: false, seenId: loadSeen(), ackId: 0, error: null };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function set(next: Partial<ErrorLogState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

/** Newest-first merge by id, dropping duplicates. */
export function mergeEvents(a: readonly ErrorLogEvent[], b: readonly ErrorLogEvent[]): ErrorLogEvent[] {
  const byId = new Map<number, ErrorLogEvent>();
  for (const e of a) byId.set(e.id, e);
  for (const e of b) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => y.id - x.id);
}

/**
 * Shared, app-wide error-log state: loaded once, then kept current by the
 * websocket's "event" pushes (see InstanceListContext), so the sidebar
 * badge and the Errors page agree.
 */
export const errorLog = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => state,

  /** Fetches the newest page and merges it in (also fills a gap after a reconnect). */
  reload(): Promise<void> {
    loading ??= api
      .listEvents({ limit: PAGE })
      .then((page) => {
        set({
          events: mergeEvents(state.events ?? [], page.events),
          hasMore: state.events === null ? page.events.length === PAGE : state.hasMore,
          ackId: Math.max(state.ackId, page.acknowledgedId),
          error: null,
        });
      })
      .catch((err: unknown) => set({ error: err instanceof Error ? err.message : "Failed to load the error log" }))
      .finally(() => {
        loading = null;
      });
    return loading;
  },

  ensureLoaded(): Promise<void> {
    return state.events === null ? errorLog.reload() : Promise.resolve();
  },

  async loadOlder(): Promise<void> {
    const oldest = state.events?.at(-1)?.id;
    if (oldest === undefined) return;
    try {
      const page = await api.listEvents({ before: oldest, limit: PAGE });
      set({
        events: mergeEvents(state.events ?? [], page.events),
        hasMore: page.events.length === PAGE,
        ackId: Math.max(state.ackId, page.acknowledgedId),
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load older events" });
    }
  },

  /** A pushed event. Ignored until the first load, which will include it. */
  push(event: ErrorLogEvent) {
    if (state.events !== null) set({ events: mergeEvents(state.events, [event]) });
  },

  /** A pushed acknowledgement. It only ever moves forward, so a late one can't undo a newer one. */
  setAcknowledged(id: number) {
    if (id > state.ackId) set({ ackId: id });
  },

  /** Acknowledges every loaded event, for every browser. Anything logged since stays unacknowledged. */
  async acknowledgeAll(): Promise<void> {
    const newest = state.events?.[0]?.id ?? 0;
    if (newest <= state.ackId) return;
    try {
      const { acknowledgedId } = await api.acknowledgeEvents(newest);
      errorLog.setAcknowledged(acknowledgedId);
      set({ error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to acknowledge the errors" });
    }
  },

  markSeen() {
    const newest = state.events?.[0]?.id ?? 0;
    if (newest <= state.seenId) return;
    try {
      localStorage.setItem(SEEN_KEY, String(newest));
    } catch {
      // per-browser convenience only
    }
    set({ seenId: newest });
  },
};

export function useErrorLog(): ErrorLogState {
  return useSyncExternalStore(errorLog.subscribe, errorLog.get);
}

/** Problems nobody has acknowledged, and whether any is an error. */
export function unacknowledgedProblems(s: ErrorLogState): { count: number; anyError: boolean } {
  let count = 0;
  let anyError = false;
  for (const e of s.events ?? []) {
    if (e.id <= s.ackId) break; // newest first
    if (isProblem(e)) {
      count++;
      anyError ||= e.severity === "error";
    }
  }
  return { count, anyError };
}
