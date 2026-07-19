const PRESETS = [
  { label: "Last hour", ms: 60 * 60 * 1000 },
  { label: "Last 6 hours", ms: 6 * 60 * 60 * 1000 },
  { label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
] as const;

export function TimeRangePicker({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  return (
    <div className="flex gap-2">
      {PRESETS.map((preset) => (
        <button
          key={preset.ms}
          type="button"
          onClick={() => onChange(preset.ms)}
          className={`rounded px-3 py-1.5 text-sm ${
            value === preset.ms ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
