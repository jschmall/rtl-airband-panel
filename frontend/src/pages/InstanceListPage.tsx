import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type InstanceSummary, type UnitStatus } from "../api/client.js";
import { HealthBadge } from "../components/HealthBadge.js";

export function InstanceListPage() {
  const [instances, setInstances] = useState<InstanceSummary[] | null>(null);
  const [health, setHealth] = useState<Record<string, UnitStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  useEffect(() => {
    void load();
  }, [load]);

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

  async function handleDelete(name: string) {
    if (!window.confirm(`Delete instance '${name}'? This stops and removes its systemd unit and config file.`)) return;
    setBusy(name);
    try {
      await api.deleteInstance(name);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Instances</h1>
        <Link to="/instances/new" className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">
          + New instance
        </Link>
      </div>

      {error && <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {instances === null ? (
        <p className="text-slate-400">Loading…</p>
      ) : instances.length === 0 ? (
        <p className="text-slate-400">No instances yet.</p>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="py-2">Name</th>
              <th className="py-2">Unit</th>
              <th className="py-2">Health</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((instance) => {
              const status = health[instance.name];
              return (
                <tr key={instance.name} className="border-b border-slate-800">
                  <td className="py-2">
                    <Link to={`/instances/${encodeURIComponent(instance.name)}`} className="text-sky-400 hover:underline">
                      {instance.name}
                    </Link>
                  </td>
                  <td className="py-2 text-slate-400">{instance.unit}</td>
                  <td className="py-2">{status ? <HealthBadge state={status.activeState} subState={status.subState} /> : "…"}</td>
                  <td className="space-x-3 py-2">
                    <Link to={`/instances/${encodeURIComponent(instance.name)}/stats`} className="text-sky-400 hover:underline">
                      Stats
                    </Link>
                    <button
                      type="button"
                      disabled={busy === instance.name}
                      onClick={() => void handleRestart(instance.name)}
                      className="text-sky-400 hover:text-sky-300 disabled:opacity-50"
                    >
                      Restart
                    </button>
                    <button
                      type="button"
                      disabled={busy === instance.name}
                      onClick={() => void handleDelete(instance.name)}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
