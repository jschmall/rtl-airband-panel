import type { UnitActiveState } from "../api/client.js";

const COLORS: Record<UnitActiveState, string> = {
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  inactive: "bg-slate-500/20 text-slate-400 border-slate-500/40",
  activating: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  deactivating: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  failed: "bg-red-500/20 text-red-400 border-red-500/40",
  unknown: "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

export function HealthBadge({ state, subState }: { state: UnitActiveState; subState?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${COLORS[state]}`}>
      {state}
      {subState ? <span className="opacity-70">({subState})</span> : null}
    </span>
  );
}
