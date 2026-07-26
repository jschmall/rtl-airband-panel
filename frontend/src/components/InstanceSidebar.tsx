import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, type UnitStatus } from "../api/client.js";
import { useInstanceList } from "../state/InstanceListContext.js";
import { HealthBadge } from "./HealthBadge.js";
import { GuardedNavLink } from "./GuardedLink.js";

export function InstanceSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { instances, error: listError, refresh, pollBriefly } = useInstanceList();

  const [health, setHealth] = useState<Record<string, UnitStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Separate from `busy`: covers the pollBriefly() window after the restart
  // request itself has resolved, so the button keeps saying "Restarting…"
  // while the health badge above is still catching up to the real state,
  // without also mislabeling a concurrent rename/delete on the same row.
  const [restarting, setRestarting] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Re-fetch health whenever the shared instance list changes (navigation,
  // create/delete/rename/restart, or a save on the edit page).
  useEffect(() => {
    if (!instances) return;
    let cancelled = false;
    void Promise.all(
      instances.map(async (instance) => {
        try {
          return [instance.name, await api.getHealth(instance.name)] as const;
        } catch {
          return [instance.name, { unit: instance.unit, activeState: "unknown", subState: "unknown" } as UnitStatus] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setHealth(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [instances]);

  async function handleRestart(name: string) {
    setBusy(name);
    setRestarting(name);
    try {
      await api.restartInstance(name);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Restart failed");
    } finally {
      setBusy(null);
    }
    // The restart command has been issued, but the unit may still be settling
    // (activating -> active/failed) -- keep refreshing for a few more seconds so
    // the health badge above shows the real transition instead of whatever
    // snapshot the awaits above happened to catch, then clear the button label.
    await pollBriefly();
    setRestarting(null);
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
      await refresh();
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
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 border-b border-slate-800 p-3">
        <GuardedNavLink
          to="/instances/new"
          className="block rounded bg-sky-600 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-sky-500"
        >
          + New instance
        </GuardedNavLink>
      </div>

      {(error || listError) && (
        <div className="flex-shrink-0 border-b border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">{error ?? listError}</div>
      )}

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
                  <GuardedNavLink
                    to={`/instances/${encodeURIComponent(instance.name)}`}
                    className={({ isActive }) =>
                      `flex items-center justify-between gap-2 rounded px-1 py-0.5 text-sm ${
                        isActive ? "bg-slate-800 text-sky-400" : "text-slate-100 hover:text-sky-400"
                      }`
                    }
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {instance.pendingRestart && (
                        <span
                          title="Saved but not yet restarted -- this instance is still running its previous config"
                          className="h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500"
                        />
                      )}
                      <span className="min-w-0 flex-shrink truncate">{instance.name}</span>
                    </span>
                    {status && <span className="flex-shrink-0"><HealthBadge state={status.activeState} subState={status.subState} /></span>}
                  </GuardedNavLink>
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
                        disabled={isBusy || restarting === instance.name}
                        onClick={() => void handleRestart(instance.name)}
                        className="text-sky-400 hover:text-sky-300 disabled:opacity-50"
                      >
                        {restarting === instance.name ? "Restarting…" : "Restart"}
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
        <GuardedNavLink
          to="/stats"
          className={({ isActive }) =>
            `block text-center text-sm font-medium ${isActive ? "text-sky-400" : "text-slate-300 hover:text-sky-400"}`
          }
        >
          Stats
        </GuardedNavLink>
      </div>
    </div>
  );
}
