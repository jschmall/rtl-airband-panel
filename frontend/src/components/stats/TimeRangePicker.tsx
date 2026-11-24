const PRESETS = [
  { label: "Last hour", ms: 60 * 60 * 1000 },
  { label: "Last 6 hours", ms: 6 * 60 * 60 * 1000 },
  { label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
] as const;

export function TimeRangePicker({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  return (
    <div className="flex w-full gap-2 sm:w-auto">
      {PRESETS.map((preset) => (
        <button
          key={preset.ms}
          type="button"
          onClick={() => onChange(preset.ms)}
          className={`flex-auto whitespace-nowrap rounded px-2 py-2 text-sm sm:flex-none sm:px-3 lg:py-1.5 ${
            value === preset.ms ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
