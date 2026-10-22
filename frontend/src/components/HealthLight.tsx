import type { UnitActiveState } from "../api/client.js";

/** Round status light: green running, amber transitioning, red failed, grey idle/unknown. */
const LIGHT: Record<UnitActiveState, string> = {
  active: "bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/60",
  activating: "bg-amber-500 animate-pulse",
  deactivating: "bg-amber-500 animate-pulse",
  failed: "bg-red-500 shadow-[0_0_6px] shadow-red-500/60",
  inactive: "bg-slate-500",
  unknown: "bg-slate-600",
};

const LABEL: Record<UnitActiveState, string> = {
  active: "Running",
  activating: "Starting",
  deactivating: "Stopping",
  failed: "Failed",
  inactive: "Stopped",
  unknown: "Unknown",
};

export function healthLabel(state: UnitActiveState): string {
  return LABEL[state];
}

export function HealthLight({ state, className = "" }: { state: UnitActiveState; className?: string }) {
  return <span aria-hidden="true" className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${LIGHT[state]} ${className}`} />;
}

/** Light plus a text label, e.g. on the overview cards and instance header. */
export function HealthStatus({ state, subState }: { state: UnitActiveState; subState?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-300" title={subState ? `${state} (${subState})` : state}>
      <HealthLight state={state} />
      {LABEL[state]}
    </span>
  );
}
