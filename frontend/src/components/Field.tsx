import type { ReactNode } from "react";
import { checkboxClass } from "./styles.js";
import { Tooltip } from "./Tooltip.js";

export function Field({ label, tooltip, children }: { label: string; tooltip?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      {tooltip ? (
        <Tooltip content={tooltip} className="cursor-help text-xs text-slate-300 underline decoration-dotted decoration-slate-600 underline-offset-2">
          {label}
        </Tooltip>
      ) : (
        <span className="text-xs text-slate-300">{label}</span>
      )}
      {children}
    </label>
  );
}

export function BoolField({
  label,
  tooltip,
  checked,
  onChange,
}: {
  label: string;
  tooltip?: string;
  checked?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input type="checkbox" className={checkboxClass} checked={checked ?? false} onChange={(e) => onChange(e.target.checked)} />
      {tooltip ? (
        <Tooltip content={tooltip} className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
          {label}
        </Tooltip>
      ) : (
        <span>{label}</span>
      )}
    </label>
  );
}
