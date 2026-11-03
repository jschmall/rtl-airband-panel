import { useEffect, useMemo, useState } from "react";
import { api, type InstanceHardware } from "../api/client.js";
import { SdrCard } from "../components/hardware/SdrCard.js";
import { GuardedLink } from "../components/GuardedLink.js";
import { errorLog, isProblem, useErrorLog } from "../lib/error-log.js";
import {
  appendHistory,
  flattenSdrs,
  HARDWARE_SORT_LABEL,
  HISTORY_WINDOW_MS,
  instanceEditorHref,
  markTransients,
  mergeHistory,
  notLiveReason,
  sdrIssues,
  sdrKey,
  severityKey,
  sortByInstance,
  sortSdrsBySerial,
  sortSdrsBySeverity,
  type HardwareSort,
  type HistoryPoint,
  type SdrIssue,
  type TransientMarks,
} from "../lib/hardware-format.js";
import { useHardwareFeed, type FeedConnection } from "../lib/use-hardware-feed.js";
import { useInstanceList } from "../state/InstanceListContext.js";

const FEED_LABEL: Record<FeedConnection, { text: string; light: string }> = {
  connecting: { text: "Connecting…", light: "bg-slate-500" },
  live: { text: "Live", light: "bg-emerald-500" },
  polling: { text: "Polling every 2 s", light: "bg-amber-500" },
  offline: { text: "Offline", light: "bg-red-500" },
};

const SORT_KEY = "rtl-panel:hardware-sort";
const RECENT_PROBLEMS_MS = 15 * 60_000;

function loadSort(): HardwareSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === "instance" || v === "serial" || v === "severity" ? v : "serial";
  } catch {
    return "serial";
  }
}

function saveSort(v: HardwareSort) {
  try {
    localStorage.setItem(SORT_KEY, v);
  } catch {
    // Storage blocked: the choice just won't be remembered.
  }
}

type IssuesBySdr = ReadonlyMap<string, SdrIssue[]>;

function InstanceSection({
  instance,
  history,
  issues,
}: {
  instance: InstanceHardware;
  history: ReadonlyMap<string, HistoryPoint[]>;
  issues: IssuesBySdr;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-slate-200">
          <GuardedLink to={instanceEditorHref(instance.name)} className="hover:text-sky-300 hover:underline decoration-slate-500 underline-offset-2" title="Edit this instance">
            {instance.name}
          </GuardedLink>
        </h2>
        {instance.live ? (
          instance.version && <span className="text-xs text-slate-500">rtl_airband {instance.version}</span>
        ) : (
          <span className="text-xs text-amber-300">Not live: {notLiveReason(instance.reason, instance.detail)} Showing configured values.</span>
        )}
      </div>
      {instance.devices.length === 0 ? (
        <p className="text-xs text-slate-500">No devices configured.</p>
      ) : (
        instance.devices.map((sdr) => (
          <SdrCard
            key={sdr.index}
            instance={instance.name}
            sdr={sdr}
            live={instance.live}
            history={history.get(sdrKey(instance.name, sdr)) ?? EMPTY}
            issues={issues.get(sdrKey(instance.name, sdr))}
          />
        ))
      )}
    </div>
  );
}

const EMPTY: HistoryPoint[] = [];

/** Live per-SDR hardware health across every instance. */
export function HardwarePage() {
  const { snapshot, connection, error } = useHardwareFeed();
  const { searchQuery } = useInstanceList();
  const [history, setHistory] = useState<ReadonlyMap<string, HistoryPoint[]>>(new Map());
  const [marks, setMarks] = useState<TransientMarks>(new Map());
  const [sort, setSort] = useState<HardwareSort>(loadSort);
  const log = useErrorLog();

  useEffect(() => {
    void errorLog.ensureLoaded();
  }, []);

  // Seed from the panel's recorded readings, so the trends and gain advice
  // don't start from nothing on every visit. Best-effort: without it the
  // page just builds its history from the live feed.
  useEffect(() => {
    let stopped = false;
    api
      .getHardwareHistory(HISTORY_WINDOW_MS)
      .then((recorded) => {
        if (!stopped) setHistory((prev) => mergeHistory(prev, recorded, Date.now()));
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const sdrs = snapshot.instances
      .filter((i) => i.live)
      .flatMap((i) => i.devices.map((sdr) => ({ key: sdrKey(i.name, sdr), sdr })));
    setHistory((prev) => appendHistory(prev, snapshot.sampledAtMs, sdrs));
    setMarks((prev) => markTransients(prev, snapshot.sampledAtMs, sdrs));
  }, [snapshot]);

  const query = searchQuery.trim().toLowerCase();
  const filtered = useMemo(
    () => (snapshot?.instances ?? []).filter((i) => !query || i.name.toLowerCase().includes(query)),
    [snapshot, query]
  );
  const now = snapshot?.sampledAtMs ?? 0;

  // Errors and warnings each instance logged in the last 15 minutes.
  const recentProblems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of log.events ?? []) {
      if (now - e.ts < RECENT_PROBLEMS_MS && isProblem(e)) counts.set(e.instance, (counts.get(e.instance) ?? 0) + 1);
    }
    return counts;
  }, [log.events, now]);

  const issues = useMemo(() => {
    const out = new Map<string, SdrIssue[]>();
    for (const instance of filtered) {
      for (const sdr of instance.devices) {
        const key = sdrKey(instance.name, sdr);
        out.set(key, sdrIssues(instance, sdr, { history: history.get(key) ?? EMPTY, marks: marks.get(key), now, recentProblems: recentProblems.get(instance.name) }));
      }
    }
    return out;
  }, [filtered, history, marks, now, recentProblems]);

  const grouped = useMemo(() => (sort === "instance" ? sortByInstance(filtered) : null), [sort, filtered]);
  const flat = useMemo(() => {
    if (sort === "instance") return null;
    const placed = flattenSdrs(filtered);
    if (sort === "serial") return sortSdrsBySerial(placed);
    return sortSdrsBySeverity(placed.map((p) => ({ ...p, key: severityKey(issues.get(sdrKey(p.instance.name, p.sdr)) ?? [], p.sdr) })));
  }, [sort, filtered, issues]);
  const feed = FEED_LABEL[connection];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Hardware</h1>
          <p className="text-sm text-slate-400">Live health of every SDR: ADC headroom, noise floor, frequency error and dropped samples.</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Sort by
            <select
              value={sort}
              onChange={(e) => {
                const v = e.target.value as HardwareSort;
                setSort(v);
                saveSort(v);
              }}
              className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              {(Object.keys(HARDWARE_SORT_LABEL) as HardwareSort[]).map((k) => (
                <option key={k} value={k}>
                  {HARDWARE_SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${feed.light}`} />
            {feed.text}
          </span>
        </div>
      </div>
      {error && <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {snapshot === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400">{query ? `No instance matches "${searchQuery}".` : "No instances yet."}</p>
      ) : grouped ? (
        grouped.map((instance) => <InstanceSection key={instance.name} instance={instance} history={history} issues={issues} />)
      ) : (
        <div className="space-y-3">
          {sort === "severity" && (
            <p className="text-xs text-slate-500">
              Worst first: SDRs not receiving properly (down, clipping, dropping samples), then ones with something to change (gain, PPM correction,
              auto_ppm, recent errors), then optional improvements. Hover a card's badge for its list.
            </p>
          )}
          {flat!.map(({ instance, sdr }) => {
            const key = sdrKey(instance.name, sdr);
            return (
              <SdrCard
                key={key}
                instance={instance.name}
                sdr={sdr}
                live={instance.live}
                history={history.get(key) ?? EMPTY}
                issues={issues.get(key)}
                notLive={instance.live ? undefined : notLiveReason(instance.reason, instance.detail)}
              />
            );
          })}
          {filtered.filter((i) => i.devices.length === 0).map((i) => (
            <p key={i.name} className="text-xs text-slate-500">
              <GuardedLink to={instanceEditorHref(i.name)} className="text-slate-300 hover:text-sky-300 hover:underline">
                {i.name}
              </GuardedLink>
              : no devices configured.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
