import { HEADROOM_LABEL, headroomLevel, type HealthLevel } from "../../lib/hardware-format.js";

const FLOOR_DBFS = -30;

const LEVEL_STYLE: Record<HealthLevel, { fill: string; text: string }> = {
  good: { fill: "bg-emerald-500", text: "text-emerald-300" },
  warning: { fill: "bg-amber-500", text: "text-amber-300" },
  critical: { fill: "bg-red-500", text: "text-red-300" },
};

function LevelIcon({ level }: { level: HealthLevel }) {
  if (level === "good") {
    return (
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="2.5,6.5 5,9 9.5,3.5" />
      </svg>
    );
  }
  if (level === "warning") {
    return (
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-current">
        <path d="M6 1.2 11.2 10.5H.8z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

/** Peak ADC level on a -30..0 dBFS track; the gap to the right edge is the headroom. */
export function HeadroomMeter({ peakDbfs, headroomDb }: { peakDbfs: number | null; headroomDb: number | null }) {
  const level = headroomLevel(headroomDb);
  const fraction = peakDbfs === null ? 0 : Math.min(1, Math.max(0, (peakDbfs - FLOOR_DBFS) / -FLOOR_DBFS));
  return (
    <div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-800"
        role="meter"
        aria-label="ADC peak level"
        aria-valuemin={FLOOR_DBFS}
        aria-valuemax={0}
        aria-valuenow={peakDbfs ?? undefined}
        aria-valuetext={peakDbfs === null ? "not measured" : `${peakDbfs.toFixed(1)} dBFS`}
      >
        {level && <div className={`h-full rounded-full ${LEVEL_STYLE[level].fill}`} style={{ width: `${fraction * 100}%` }} />}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
        <span>{FLOOR_DBFS} dBFS</span>
        {level ? (
          <span className={`flex items-center gap-1 font-medium ${LEVEL_STYLE[level].text}`}>
            <LevelIcon level={level} />
            {HEADROOM_LABEL[level]}
          </span>
        ) : (
          <span>not measured</span>
        )}
        <span>0</span>
      </div>
    </div>
  );
}
