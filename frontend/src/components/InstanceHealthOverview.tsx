import { useEffect, useState } from "react";
import { api, type InstanceStatsSummary } from "../api/client.js";
import { useInstanceList } from "../state/InstanceListContext.js";
import { AUTO_REFRESH_MS } from "../lib/polling.js";
import { formatDateTime, formatUptime } from "../lib/time-format.js";
import { formatCpuSeconds } from "../lib/stats-format.js";
import { HealthBadge } from "./HealthBadge.js";
import { GuardedLink } from "./GuardedLink.js";

/** Neutral at 0, amber once an instance has anything worth a second look. */
function countClass(value: number): string {
  return value > 0 ? "font-semibold text-amber-300" : "text-slate-300";
}

/**
 * At-a-glance status for every managed instance, shown on the landing page.
 * Instance status/uptime rides along on the shared instance list (already
 * polled by InstanceListProvider); this component only needs to poll the
 * separate stats-summary endpoint on the same cadence.
 */
export function InstanceHealthOverview() {
  const { instances } = useInstanceList();
  const [summaries, setSummaries] = useState<Record<string, InstanceStatsSummary>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api.getInstanceStatsSummary();
        if (!cancelled) setSummaries(result);
      } catch {
        // Leave the previous summaries in place -- a table showing slightly
        // stale numbers beats one that blanks out on a transient fetch error.
      }
    }
    void load();
    const interval = setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!instances || instances.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-400">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Uptime</th>
            <th className="px-3 py-2 font-medium">Active since</th>
            <th className="px-3 py-2 text-right font-medium">Buffer overflows</th>
            <th className="px-3 py-2 text-right font-medium">Output overruns</th>
            <th className="px-3 py-2 text-right font-medium">Output failures</th>
            <th className="px-3 py-2 text-right font-medium">CPU (s)</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((instance) => {
            const summary = summaries[instance.name];
            const isActive = instance.status.activeState === "active";
            return (
              <tr key={instance.name} className="border-b border-slate-800 last:border-b-0 text-slate-200">
                <td className="px-3 py-2">
                  <GuardedLink to={`/instances/${encodeURIComponent(instance.name)}`} className="text-sky-400 hover:text-sky-300">
                    {instance.name}
                  </GuardedLink>
                </td>
                <td className="px-3 py-2">
                  <HealthBadge state={instance.status.activeState} subState={instance.status.subState} />
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-300">{isActive ? formatUptime(instance.status.activeEnterTimestamp) : "—"}</td>
                <td className="px-3 py-2 tabular-nums text-slate-300">{formatDateTime(instance.status.activeEnterTimestamp)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${countClass(summary?.bufferOverflowTotal ?? 0)}`}>
                  {summary?.bufferOverflowTotal ?? 0}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${countClass(summary?.outputOverrunTotal ?? 0)}`}>
                  {summary?.outputOverrunTotal ?? 0}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${countClass(summary?.outputFailureTotal ?? 0)}`}>
                  {summary?.outputFailureTotal ?? 0}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">{formatCpuSeconds(summary?.processCpuSeconds)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
