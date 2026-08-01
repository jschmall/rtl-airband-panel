import { Tooltip } from "../Tooltip.js";

interface StatTileProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tooltip?: string;
}

export function StatTile({ label, value, sublabel, tooltip }: StatTileProps) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-slate-400">
          {tooltip ? (
            <Tooltip content={tooltip} className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
              {label}
            </Tooltip>
          ) : (
            label
          )}
        </p>
        {sublabel && <p className="shrink-0 text-xs text-slate-400">{sublabel}</p>}
      </div>
      <p className="text-lg font-semibold tabular-nums text-slate-100">{value}</p>
    </div>
  );
}
