interface StatTileProps {
  label: string;
  value: string | number;
  sublabel?: string;
}

export function StatTile({ label, value, sublabel }: StatTileProps) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-100">{value}</p>
      {sublabel && <p className="text-xs text-slate-500">{sublabel}</p>}
    </div>
  );
}
