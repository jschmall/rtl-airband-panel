import { useEffect, useState } from "react";
import { api, type InstanceStatsSummary, type InstanceSummary } from "../api/client.js";
import { useInstanceList } from "../state/InstanceListContext.js";
import { formatDateTime, formatUptime } from "../lib/time-format.js";
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
    <div title={title} className="text-right">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-sm tabular-nums ${value > 0 ? "font-semibold text-amber-300" : "text-slate-300"}`}>{value}</dd>
    </div>
  );
}

function InstanceCard({ instance, summary }: { instance: InstanceSummary; summary?: InstanceStatsSummary }) {
  const state = instance.status.activeState;
  const freqs = frequencies(instance);
  const windows = instance.deviceWindows ?? [];
  const running = state === "active";
  return (
    <GuardedLink
      to={`/instances/${encodeURIComponent(instance.name)}`}
      className={`group block rounded-lg border bg-slate-900/50 px-4 py-3 transition-colors hover:border-slate-600 hover:bg-slate-900 ${
        state === "failed" ? "border-red-500/50" : "border-slate-800"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-50">{instance.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-400">
            <HealthLight state={state} />
            {healthLabel(state)}
            {running && <span className="text-slate-500">· up {formatUptime(instance.status.activeEnterTimestamp)}</span>}
            {instance.pendingRestart && (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                Pending restart
              </span>
            )}
          </p>
        </div>
        <dl className="flex flex-shrink-0 gap-4">
          <Counter label="Overflows" value={summary?.bufferOverflowTotal ?? 0} title="Device buffer overflows (samples dropped before demodulation)" />
          <Counter label="Failures" value={summary?.outputFailureTotal ?? 0} title="Output failures: icecast disconnects, write/encode/upload failures, dropped UDP packets" />
        </dl>
      </div>

      <p className="mt-2 text-sm text-slate-300">
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
      {windows.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
          {windows.map((w, i) => (
            <li key={i} title="Where a new channel fits on this SDR: its usable capture window around the center frequency">
              {windows.length > 1 && w.serial ? `SN ${w.serial} window` : "Window"}{" "}
              <span className="tabular-nums text-slate-400">
                {(w.lowHz / 1e6).toFixed(3)}–{(w.highHz / 1e6).toFixed(3)} MHz
              </span>
            </li>
          ))}
        </ul>
      )}

      {!running && instance.status.activeEnterTimestamp && (
        <p className="mt-2 text-xs text-slate-500">Last started {formatDateTime(instance.status.activeEnterTimestamp)}</p>
      )}
    </GuardedLink>
  );
}

interface Tally {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "bad";
}

function TallyValue({ label, value, tone }: Tally) {
  const color = value === 0 || !tone ? "text-slate-50" : tone === "ok" ? "text-emerald-400" : tone === "warn" ? "text-amber-300" : "text-red-400";
  return (
    <p className="flex items-baseline gap-1.5 px-3">
      <span className={`text-lg font-semibold tabular-nums ${color}`}>{value}</span>
      <span className="text-xs text-slate-400">{label}</span>
    </p>
  );
}

/** One compact summary tile holding two related counts side by side. */
function TallyPair({ left, right }: { left: Tally; right: Tally }) {
  return (
    <div className="flex divide-x divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/50 py-1.5">
      <TallyValue {...left} />
      <TallyValue {...right} />
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
      <div className="flex flex-wrap gap-3">
        <TallyPair
          left={{ label: "Instances", value: instances.length }}
          right={{ label: "Running", value: count((i) => i.status.activeState === "active"), tone: "ok" }}
        />
        <TallyPair
          left={{ label: "Failed", value: count((i) => i.status.activeState === "failed"), tone: "bad" }}
          right={{ label: "Pending restart", value: count((i) => i.pendingRestart), tone: "warn" }}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {instances.map((instance) => (
          <InstanceCard key={instance.name} instance={instance} summary={summaries[instance.name]} />
        ))}
      </div>
    </div>
  );
}
