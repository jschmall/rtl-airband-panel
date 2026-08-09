import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError, type InstanceSummary } from "../api/client.js";
import { AUTO_REFRESH_MS } from "../lib/polling.js";

interface InstanceListContextValue {
  instances: InstanceSummary[] | null;
  /** `instances` filtered by `searchQuery` -- case-insensitive substring match against
   *  the instance name OR any of its `searchFields` (channel labels, frequencies,
   *  modulations, device type/serial), so e.g. searching "CHP", "146.94", or "nfm" all
   *  surface the right instance, not just one named to match. Equal to `instances` when
   *  the query is empty. Lives here rather than in the sidebar alone so the search box
   *  in the header (which filters "across all instances") and the sidebar list it
   *  filters share one source of truth. */
  filteredInstances: InstanceSummary[] | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  error: string | null;
  /** Re-fetches the instance list (including each instance's pendingRestart flag) from the server. */
  refresh: () => Promise<void>;
  /**
   * Refreshes a handful of times over the next few seconds instead of once --
   * call this right after triggering a restart so the sidebar's health badges
   * (which re-fetch whenever `instances` changes identity) show the real
   * activating -> active/failed transition instead of freezing until the next
   * background poll up to `AUTO_REFRESH_MS` later. Callers can await it (e.g.
   * to clear a "Restarting..." label once it's done) or not, as needed.
   */
  pollBriefly: () => Promise<void>;
  /**
   * Bumped once per background poll tick (not on route-triggered refreshes).
   * Other components that need to refetch their own data on the same
   * cadence -- e.g. InstanceHealthOverview's separate stats-summary endpoint
   * -- can depend on this instead of running their own independent
   * setInterval, so all background polling fires in lockstep on one shared
   * clock rather than several timers drifting out of phase with each other.
   */
  pollTick: number;
}

const InstanceListContext = createContext<InstanceListContextValue | null>(null);

/**
 * InstanceSummary is a flat, JSON-serializable shape with no cycles, so a
 * stringify comparison is a cheap, reliable way to tell "nothing actually
 * changed" apart from "a new array came back with the same content" --
 * without it, every background poll tick replaces `instances` with a new
 * array identity even when unchanged, which cascades into a re-render of
 * every consumer of this context (most of the always-mounted app shell).
 */
export function sameInstanceList(a: InstanceSummary[] | null, b: InstanceSummary[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Single shared source of truth for the instance list, so the sidebar (per-
 * instance dot) and the header (pending-restart count) never drift out of
 * sync with each other or with the server -- which is what happened when
 * "pending restart" lived as component-local state on the edit page.
 */
export function InstanceListProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [instances, setInstances] = useState<InstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pollTick, setPollTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listInstances();
      setInstances((prev) => (sameInstanceList(prev, list) ? prev : list));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load instances");
    }
  }, []);

  // Re-fetch on every navigation so creates/deletes/renames/saves triggered
  // from anywhere keep this always-visible state in sync.
  useEffect(() => {
    void refresh();
  }, [refresh, location.pathname]);

  // Separate background poll on its own fixed cadence, independent of
  // navigation, so a unit that dies, or a pending-restart flag set by another
  // tab/session, shows up without the user having to click around to trigger
  // a route change. Split from the effect above (rather than one effect doing
  // both) so navigating around doesn't reset this timer's phase.
  useEffect(() => {
    const interval = setInterval(() => {
      void refresh();
      setPollTick((t) => t + 1);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const pollBriefly = useCallback(async () => {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await refresh();
    }
  }, [refresh]);

  const filteredInstances = useMemo(() => {
    if (!instances) return instances;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return instances;
    return instances.filter(
      (instance) =>
        instance.name.toLowerCase().includes(query) || instance.searchFields.some((field) => field.toLowerCase().includes(query))
    );
  }, [instances, searchQuery]);

  const value = useMemo(
    () => ({ instances, filteredInstances, searchQuery, setSearchQuery, error, refresh, pollBriefly, pollTick }),
    [instances, filteredInstances, searchQuery, error, refresh, pollBriefly, pollTick]
  );

  return <InstanceListContext.Provider value={value}>{children}</InstanceListContext.Provider>;
}

export function useInstanceList(): InstanceListContextValue {
  const ctx = useContext(InstanceListContext);
  if (!ctx) throw new Error("useInstanceList must be used within an InstanceListProvider");
  return ctx;
}
