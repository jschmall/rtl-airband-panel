import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError, type InstanceSummary } from "../api/client.js";

interface InstanceListContextValue {
  instances: InstanceSummary[] | null;
  error: string | null;
  /** Re-fetches the instance list (including each instance's pendingRestart flag) from the server. */
  refresh: () => Promise<void>;
}

const InstanceListContext = createContext<InstanceListContextValue | null>(null);

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

  const refresh = useCallback(async () => {
    try {
      const list = await api.listInstances();
      setInstances(list);
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

  const value = useMemo(() => ({ instances, error, refresh }), [instances, error, refresh]);

  return <InstanceListContext.Provider value={value}>{children}</InstanceListContext.Provider>;
}

export function useInstanceList(): InstanceListContextValue {
  const ctx = useContext(InstanceListContext);
  if (!ctx) throw new Error("useInstanceList must be used within an InstanceListProvider");
  return ctx;
}
