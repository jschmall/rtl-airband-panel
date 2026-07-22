import type { ReactNode } from "react";
import { checkboxClass } from "./styles.js";

export function Field({ label, tooltip, children }: { label: string; tooltip?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className={tooltip ? "cursor-help text-xs text-slate-400 underline decoration-dotted decoration-slate-600 underline-offset-2" : "text-xs text-slate-400"}
        title={tooltip}
      >
        {label}
      </span>
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
    <label className="flex items-center gap-2 text-sm text-slate-400">
      <input type="checkbox" className={checkboxClass} checked={checked ?? false} onChange={(e) => onChange(e.target.checked)} />
      <span className={tooltip ? "cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2" : undefined} title={tooltip}>
        {label}
      </span>
    </label>
  );
}
