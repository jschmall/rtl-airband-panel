import { Fragment, useEffect, useMemo, useState } from "react";
import type { ErrorLogEvent } from "../api/client.js";
import { GuardedLink } from "../components/GuardedLink.js";
import { errorLog, isMarker, useErrorLog } from "../lib/error-log.js";
import { useInstanceList } from "../state/InstanceListContext.js";

type Level = "all" | "error";

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const dayOf = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });

const SOURCE: Record<string, string> = {
  log: "Log",
  counter: "Counter",
  "unit-failed": "systemd",
  "unit-stopped": "systemd",
};

const SEVERITY_CHIP: Record<string, string> = {
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  info: "border-slate-600 bg-slate-800 text-slate-300",
};

const MARKER_STYLE: Record<string, { icon: string; line: string; pill: string }> = {
  restart: { icon: "↻", line: "border-sky-500/40", pill: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  "live-apply": { icon: "⚡", line: "border-emerald-500/40", pill: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  "unexpected-restart": { icon: "↻", line: "border-amber-500/50", pill: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
};

function InstanceName({ name }: { name: string }) {
  return (
    <GuardedLink
      to={`/instances/${encodeURIComponent(name)}`}
      className="font-medium text-slate-200 decoration-slate-500 underline-offset-2 hover:text-sky-300 hover:underline"
    >
      {name}
    </GuardedLink>
  );
}

/** A restart or live apply: a divider across the timeline, so what came before and after it is easy to tell apart. */
function MarkerRow({ event, showInstance }: { event: ErrorLogEvent; showInstance: boolean }) {
  const style = MARKER_STYLE[event.kind] ?? MARKER_STYLE.restart!;
  const skipped = (event.detail?.skippedRequiresRestart as string[] | undefined) ?? [];
  const applied = (event.detail?.applied as string[] | undefined) ?? [];
  const title = [new Date(event.ts).toISOString(), ...applied.map((a) => `applied: ${a}`), ...skipped.map((s) => `needs restart: ${s}`)].join("\n");
  return (
    <li className="flex items-center gap-2 py-2" title={title} data-kind={event.kind}>
      <span aria-hidden="true" className={`w-3 flex-shrink-0 border-t-2 sm:w-8 ${style.line}`} />
      <span className={`flex min-w-0 flex-wrap items-center gap-x-1.5 rounded-lg border px-2.5 py-0.5 text-xs ${style.pill}`}>
        <span aria-hidden="true">{style.icon}</span>
        {showInstance && <InstanceName name={event.instance} />}
        <span>{event.message}</span>
        <span className="tabular-nums opacity-75">· {timeOf(event.ts)}</span>
      </span>
      <span aria-hidden="true" className={`flex-1 border-t-2 ${style.line}`} />
    </li>
  );
}

function EventRow({ event, showInstance, isNew }: { event: ErrorLogEvent; showInstance: boolean; isNew: boolean }) {
  const d = event.detail ?? {};
  const repeated = typeof d.repeatedBefore === "number" ? d.repeatedBefore : 0;
  return (
    <li
      className={`grid grid-cols-[4.5rem_1fr] gap-x-3 border-l-2 py-1.5 pl-2 text-sm ${isNew ? "border-sky-500" : "border-transparent"}`}
      data-kind={event.kind}
    >
      <span className="pt-0.5 text-xs tabular-nums text-slate-500" title={new Date(event.ts).toISOString()}>
        {timeOf(event.ts)}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`rounded border px-1.5 text-[10px] font-medium uppercase tracking-wide ${SEVERITY_CHIP[event.severity] ?? SEVERITY_CHIP.info}`}>
            {event.severity}
          </span>
          {showInstance && <InstanceName name={event.instance} />}
          <span className="text-xs text-slate-500">{SOURCE[event.kind] ?? event.kind}</span>
          {d.heuristic === true && (
            <span
              className="text-[10px] text-slate-500"
              title="Logged without -j, so rtl_airband's own level isn't known: this line was flagged by keywords (error, failed, lost connection, …)"
            >
              keyword match
            </span>
          )}
          {repeated > 0 && (
            <span className="text-[10px] text-slate-500" title="The same line was logged this many more times in the minute before this one">
              +{repeated} repeats
            </span>
          )}
        </div>
        <p className={`mt-0.5 break-words text-slate-300 ${event.kind === "log" ? "font-mono text-xs" : ""}`}>{event.message}</p>
      </div>
    </li>
  );
}

/** The error log: every instance's failures, errors and oddities, with restart markers between them. */
export function ErrorsPage() {
  const log = useErrorLog();
  const { instances } = useInstanceList();
  const [instance, setInstance] = useState("");
  const [level, setLevel] = useState<Level>("all");
  const [showMarkers, setShowMarkers] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // What was already seen when the page opened: newer rows get highlighted.
  const [seenAtOpen] = useState(() => errorLog.get().seenId);

  useEffect(() => {
    void errorLog.ensureLoaded();
  }, []);
  // Viewing the page clears the sidebar badge, including for events that arrive while it's open.
  useEffect(() => {
    errorLog.markSeen();
  }, [log.events]);

  const names = useMemo(() => {
    const all = new Set((instances ?? []).map((i) => i.name));
    for (const e of log.events ?? []) all.add(e.instance);
    return [...all].sort();
  }, [instances, log.events]);

  const rows = useMemo(
    () =>
      (log.events ?? []).filter((e) => {
        if (instance && e.instance !== instance) return false;
        if (isMarker(e)) return showMarkers;
        return level === "all" || e.severity === "error";
      }),
    [log.events, instance, level, showMarkers]
  );

  const selectClass =
    "h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Errors</h1>
        <p className="text-sm text-slate-400">
          Failures, errors and oddities from every instance's log, stats and systemd unit, newest first. Restarts and live applies are marked in
          between, so you can tell whether a problem came before or after a change.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-400">
          Instance
          <select value={instance} onChange={(e) => setInstance(e.target.value)} className={selectClass}>
            <option value="">All</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          Show
          <select value={level} onChange={(e) => setLevel(e.target.value as Level)} className={selectClass}>
            <option value="all">Errors and warnings</option>
            <option value="error">Errors only</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} className="accent-sky-500" />
          Restart markers
        </label>
      </div>

      {log.error && <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{log.error}</p>}

      {log.events === null ? (
        !log.error && <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">{log.events.length === 0 ? "Nothing logged yet." : "Nothing matches these filters."}</p>
      ) : (
        <ol className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 sm:px-4">
          {rows.map((e, i) => {
            const day = dayOf(e.ts);
            const newDay = i === 0 || dayOf(rows[i - 1]!.ts) !== day;
            return (
              <Fragment key={e.id}>
                {newDay && (
                  <li className={`pb-1 text-xs font-medium uppercase tracking-wide text-slate-500 ${i === 0 ? "pt-1" : "pt-4"}`}>{day}</li>
                )}
                {isMarker(e) ? (
                  <MarkerRow event={e} showInstance={!instance} />
                ) : (
                  <EventRow event={e} showInstance={!instance} isNew={e.id > seenAtOpen} />
                )}
              </Fragment>
            );
          })}
        </ol>
      )}

      {log.hasMore && (
        <button
          type="button"
          disabled={loadingOlder}
          onClick={() => {
            setLoadingOlder(true);
            void errorLog.loadOlder().finally(() => setLoadingOlder(false));
          }}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {loadingOlder ? "Loading…" : "Load older"}
        </button>
      )}
    </div>
  );
}
