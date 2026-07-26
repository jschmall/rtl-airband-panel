import type { ReactNode } from "react";
import { checkboxClass } from "./styles.js";

export function Field({ label, tooltip, children }: { label: string; tooltip?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 self-start">
      <span
        className={
          tooltip
            ? "min-h-10 cursor-help text-xs text-slate-400 underline decoration-dotted decoration-slate-600 underline-offset-2"
            : "min-h-10 text-xs text-slate-400"
        }
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
  alignWithField,
}: {
  label: string;
  tooltip?: string;
  checked?: boolean;
  onChange: (v: boolean) => void;
  /** Set when this sits in a grid alongside `Field`s, so its checkbox lines up with their inputs instead of sitting under wherever their (possibly multi-line) label ends. Leave unset for standalone uses like a Collapsible's header actions. */
  alignWithField?: boolean;
}) {
  const checkboxAndLabel = (
    <>
      <input type="checkbox" className={checkboxClass} checked={checked ?? false} onChange={(e) => onChange(e.target.checked)} />
      <span className={tooltip ? "cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2" : undefined} title={tooltip}>
        {label}
      </span>
    </>
  );

  if (!alignWithField) {
    return <label className="flex items-center gap-2 self-start text-sm text-slate-400">{checkboxAndLabel}</label>;
  }

  return (
    <label className="flex flex-col gap-1 self-start">
      <span className="min-h-10" aria-hidden="true" />
      <span className="flex items-center gap-2 text-sm text-slate-400">{checkboxAndLabel}</span>
    </label>
  );
}
