import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, type InstanceSummary, type UnitStatus } from "../api/client.js";
import { HealthBadge } from "./HealthBadge.js";

export function InstanceSidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const [instances, setInstances] = useState<InstanceSummary[] | null>(null);
  const [health, setHealth] = useState<Record<string, UnitStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.listInstances();
      setInstances(list);
      const entries = await Promise.all(
        list.map(async (instance) => {
          try {
            return [instance.name, await api.getHealth(instance.name)] as const;
          } catch {
            return [instance.name, { unit: instance.unit, activeState: "unknown", subState: "unknown" } as UnitStatus] as const;
          }
        })
      );
      setHealth(Object.fromEntries(entries));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load instances");
    }
  }, []);

  // Re-fetch on every navigation so creates/deletes/renames triggered from
  // anywhere (e.g. the create form) keep this always-visible list in sync.
  useEffect(() => {
    void load();
  }, [load, location.pathname]);

  async function handleRestart(name: string) {
    setBusy(name);
    try {
      await api.restartInstance(name);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Restart failed");
    } finally {
      setBusy(null);
    }
  }

  function startRename(name: string) {
    setError(null);
    setRenaming(name);
    setRenameValue(name);
  }

  function cancelRename() {
    setRenaming(null);
    setRenameValue("");
  }

  async function handleRename(name: string) {
    setBusy(name);
    try {
      await api.renameInstance(name, renameValue);
      const wasOpen = location.pathname === `/instances/${encodeURIComponent(name)}`;
      setRenaming(null);
      if (wasOpen) navigate(`/instances/${encodeURIComponent(renameValue)}`);
      setRenameValue("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rename failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(name: string) {
    if (!window.confirm(`Delete instance '${name}'? This stops and removes its systemd unit and config file.`)) return;
    setBusy(name);
    try {
      await api.deleteInstance(name);
      if (location.pathname === `/instances/${encodeURIComponent(name)}`) navigate("/");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 border-b border-slate-800 p-3">
        <NavLink
          to="/instances/new"
          className="block rounded bg-sky-600 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-sky-500"
        >
          + New instance
        </NavLink>
      </div>

      {error && <div className="flex-shrink-0 border-b border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>}

      <div className="flex-1 overflow-y-auto">
        {instances === null ? (
          <p className="p-3 text-sm text-slate-400">Loading…</p>
        ) : instances.length === 0 ? (
          <p className="p-3 text-sm text-slate-400">No instances yet.</p>
        ) : (
          instances.map((instance) => {
            const status = health[instance.name];
            const isRenaming = renaming === instance.name;
            const isBusy = busy === instance.name;
            return (
              <div key={instance.name} className="border-b border-slate-800 px-3 py-2">
                {isRenaming ? (
                  <input
                    type="text"
                    value={renameValue}
                    disabled={isBusy}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename(instance.name);
                      if (e.key === "Escape") cancelRename();
                    }}
                    className="w-full rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-sm text-slate-100"
                  />
                ) : (
                  <NavLink
                    to={`/instances/${encodeURIComponent(instance.name)}`}
                    className={({ isActive }) =>
                      `flex items-center justify-between gap-2 rounded px-1 py-0.5 text-sm ${
                        isActive ? "bg-slate-800 text-sky-400" : "text-slate-100 hover:text-sky-400"
                      }`
                    }
                  >
                    <span className="min-w-0 flex-shrink truncate">{instance.name}</span>
                    {status && <span className="flex-shrink-0"><HealthBadge state={status.activeState} subState={status.subState} /></span>}
                  </NavLink>
                )}

                <div className="ml-4 mt-1 flex gap-3 text-xs">
                  {isRenaming ? (
                    <>
                      <button
                        type="button"
                        disabled={isBusy || renameValue.trim() === ""}
                        onClick={() => void handleRename(instance.name)}
                        className="text-sky-400 hover:text-sky-300 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={cancelRename}
                        className="text-slate-400 hover:text-slate-200 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleRestart(instance.name)}
                        className="text-sky-400 hover:text-sky-300 disabled:opacity-50"
                      >
                        Restart
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => startRename(instance.name)}
                        className="text-sky-400 hover:text-sky-300 disabled:opacity-50"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDelete(instance.name)}
                        className="text-red-400 hover:text-red-300 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex-shrink-0 border-t border-slate-800 p-3">
        <NavLink
          to="/stats"
          className={({ isActive }) =>
            `block text-center text-sm font-medium ${isActive ? "text-sky-400" : "text-slate-300 hover:text-sky-400"}`
          }
        >
          Stats
        </NavLink>
      </div>
    </div>
  );
}
