import { useEffect, useState } from "react";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { api, type PlanReport } from "../api/client.js";

/**
 * Asks the server what applying `config` to the running process would do,
 * debounced while the user types. Null when there's nothing to compare
 * (`active` false) or the backend has no plan endpoint.
 */
export function usePlanPreview(name: string | undefined, config: RtlAirbandConfig | null, active: boolean): PlanReport | null {
  const [plan, setPlan] = useState<PlanReport | null>(null);
  useEffect(() => {
    if (!name || !config || !active) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .planChange(name, config)
        .then((p) => !cancelled && setPlan(p))
        .catch(() => !cancelled && setPlan(null)); // e.g. a shape error mid-edit; validation reports those
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, config, active]);
  return plan;
}

const SUMMARY = {
  no_change: { text: "The running process already has this configuration", tone: "text-slate-400", light: "bg-slate-500" },
  live: { text: "Can be applied live, without a restart", tone: "text-emerald-300", light: "bg-emerald-500" },
  restart: { text: "Needs a restart to take effect", tone: "text-amber-300", light: "bg-amber-500" },
} as const;

function Items({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={`text-xs font-medium ${tone}`}>{title}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-xs text-slate-300">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** One-line verdict with expandable details: what goes live, what needs a restart, what gets interrupted. */
export function ChangePreview({ plan }: { plan: PlanReport }) {
  const [open, setOpen] = useState(false);
  const s = SUMMARY[plan.method];
  const hasDetails = plan.live.length + plan.restart.length + plan.interrupts.length > 0 || !plan.baselineKnown;
  return (
    <div className="min-w-0 flex-1 text-sm">
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex max-w-full items-center gap-2 text-left ${s.tone} disabled:cursor-default`}
      >
        <span aria-hidden="true" className={`h-2 w-2 flex-shrink-0 rounded-full ${s.light}`} />
        <span className="truncate">{s.text}</span>
        {plan.interrupts.length > 0 && <span className="flex-shrink-0 text-xs text-amber-300">· briefly interrupts audio</span>}
        {hasDetails && <span className="flex-shrink-0 text-xs text-slate-500">{open ? "Hide details" : "Details"}</span>}
      </button>
      {open && (
        <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-2">
          <Items title="Applied live" items={plan.live} tone="text-emerald-300" />
          <Items title="Needs a restart" items={plan.restart} tone="text-amber-300" />
          <Items title="Interruptions during a live apply" items={plan.interrupts} tone="text-amber-300" />
          {!plan.baselineKnown && (
            <p className="text-xs text-slate-500">
              This instance wasn't started by the panel, so this compares against the config on disk. Restart it once from here for exact
              predictions.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
