import { useEffect, useState } from "react";
import { api, type InstanceStatsSummary, type InstanceSummary } from "../api/client.js";
import { useInstanceList } from "../state/InstanceListContext.js";
import { formatDateTime, formatUptime } from "../lib/time-format.js";
import { formatCpuSeconds } from "../lib/stats-format.js";
import { GuardedLink } from "../components/GuardedLink.js";
import { HealthLight, healthLabel } from "../components/HealthLight.js";

/** Frequencies (MHz) an instance listens on. */
function frequencies(instance: InstanceSummary): number[] {
  if (instance.frequencies) return instance.frequencies.map((hz) => hz / 1_000_000);
  // Older backends: MHz values among the search terms (device serials are integers, so require a decimal point).
  return [...new Set(instance.searchFields.filter((f) => /^\d+\.\d+$/.test(f)).map(Number))].sort((a, b) => a - b);
}

function Counter({ label, value, title }: { label: string; value: number; title: string }) {
  return (
    <div title={title}>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`tabular-nums ${value > 0 ? "font-semibold text-amber-300" : "text-slate-300"}`}>{value}</dd>
    </div>
  );
}

function InstanceCard({ instance, summary }: { instance: InstanceSummary; summary?: InstanceStatsSummary }) {
  const state = instance.status.activeState;
  const freqs = frequencies(instance);
  const running = state === "active";
  return (
    <GuardedLink
      to={`/instances/${encodeURIComponent(instance.name)}`}
      className={`group block rounded-lg border bg-slate-900/50 p-4 transition-colors hover:border-slate-600 hover:bg-slate-900 ${
        state === "failed" ? "border-red-500/50" : "border-slate-800"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-50">{instance.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            <HealthLight state={state} />
            {healthLabel(state)}
            {running && <span className="text-slate-500">· up {formatUptime(instance.status.activeEnterTimestamp)}</span>}
          </p>
        </div>
        {instance.pendingRestart && (
          <span className="flex-shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
            Pending restart
          </span>
        )}
      </div>

      <p className="mt-3 text-sm text-slate-300">
        {freqs.length === 0 ? (
          <span className="text-slate-500">No channels</span>
        ) : (
          <>
            <span className="tabular-nums">{freqs.length}</span> frequenc{freqs.length === 1 ? "y" : "ies"}
            <span className="text-slate-500">
              {" "}
              · {freqs[0]!.toFixed(3)}
              {freqs.length > 1 && `–${freqs[freqs.length - 1]!.toFixed(3)}`} MHz
            </span>
          </>
        )}
      </p>

      <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-slate-800 pt-3 text-sm">
        <Counter label="Overflows" value={summary?.bufferOverflowTotal ?? 0} title="Device buffer overflows (samples dropped before demodulation)" />
        <Counter label="Overruns" value={summary?.outputOverrunTotal ?? 0} title="Output overruns across devices and mixers" />
        <Counter label="Failures" value={summary?.outputFailureTotal ?? 0} title="Output failures: icecast disconnects, write/encode/upload failures, dropped UDP packets" />
        <div title="Process CPU time since start">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">CPU</dt>
          <dd className="tabular-nums text-slate-300">{formatCpuSeconds(summary?.processCpuSeconds)}</dd>
        </div>
      </dl>
      {!running && instance.status.activeEnterTimestamp && (
        <p className="mt-2 text-xs text-slate-500">Last started {formatDateTime(instance.status.activeEnterTimestamp)}</p>
      )}
    </GuardedLink>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "bad" }) {
  const color = value === 0 || !tone ? "text-slate-50" : tone === "ok" ? "text-emerald-400" : tone === "warn" ? "text-amber-300" : "text-red-400";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3">
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

/** Landing page: fleet totals, then one card per instance. */
export function OverviewPage() {
  const { instances, pollTick } = useInstanceList();
  const [summaries, setSummaries] = useState<Record<string, InstanceStatsSummary>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .getInstanceStatsSummary()
      .then((s) => !cancelled && setSummaries(s))
      .catch(() => undefined); // keep the last numbers on a transient failure
    return () => {
      cancelled = true;
    };
  }, [pollTick, instances]);

  if (instances === null) return <p className="text-slate-400">Loading…</p>;

  if (instances.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg font-medium text-slate-200">No instances yet</p>
        <p className="max-w-sm text-sm text-slate-400">Each instance is one rtl_airband process with its own config and systemd unit.</p>
        <GuardedLink to="/instances/new" className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">
          Create an instance
        </GuardedLink>
      </div>
    );
  }

  const count = (pred: (i: InstanceSummary) => boolean) => instances.filter(pred).length;
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-xl font-semibold text-slate-50">Overview</h1>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tally label="Instances" value={instances.length} />
        <Tally label="Running" value={count((i) => i.status.activeState === "active")} tone="ok" />
        <Tally label="Failed" value={count((i) => i.status.activeState === "failed")} tone="bad" />
        <Tally label="Pending restart" value={count((i) => i.pendingRestart)} tone="warn" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {instances.map((instance) => (
          <InstanceCard key={instance.name} instance={instance} summary={summaries[instance.name]} />
        ))}
      </div>
    </div>
  );
}
