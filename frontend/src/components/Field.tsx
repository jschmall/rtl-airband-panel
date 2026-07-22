import type { ReactNode } from "react";
import { checkboxClass } from "./styles.js";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export function BoolField({ label, checked, onChange }: { label: string; checked?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-400">
      <input type="checkbox" className={checkboxClass} checked={checked ?? false} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
