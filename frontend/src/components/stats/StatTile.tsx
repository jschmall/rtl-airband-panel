interface StatTileProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tooltip?: string;
}

export function StatTile({ label, value, sublabel, tooltip }: StatTileProps) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <p
        className={
          tooltip
            ? "cursor-help text-xs text-slate-400 underline decoration-dotted decoration-slate-600 underline-offset-2"
            : "text-xs text-slate-400"
        }
        title={tooltip}
      >
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums text-slate-100">{value}</p>
      {sublabel && <p className="text-xs text-slate-500">{sublabel}</p>}
    </div>
  );
}
