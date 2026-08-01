import { Tooltip } from "../Tooltip.js";
import { exactCount, formatCompactCount } from "../../lib/stats-format.js";

interface BufferHealthTileProps {
  device: string;
  overflow: number | undefined;
  underrun: number | undefined;
  tooltip: string;
}

/**
 * buffer_overflow_count and buffer_underrun_count are read together, not in
 * isolation -- a device whose underrun count goes flat while its overflow
 * count climbs is the signature of CPU saturation rather than USB/host
 * starvation (see the tooltip). One combined tile makes that pairing visible
 * at a glance instead of two side-by-side tiles a reader has to mentally
 * correlate.
 */
export function BufferHealthTile({ device, overflow, underrun, tooltip }: BufferHealthTileProps) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <p className="text-xs text-slate-400">
        <Tooltip content={tooltip} className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
          Buffer Health
        </Tooltip>
      </p>
      <div className="mt-1 space-y-1">
        <BufferHealthRow label="Overflow" value={overflow} />
        <BufferHealthRow label="Underrun" value={underrun} />
      </div>
      <p className="text-xs text-slate-400">Device {device}</p>
    </div>
  );
}

function BufferHealthRow({ label, value }: { label: string; value: number | undefined }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-slate-400">{label}</span>
      {value === undefined ? (
        <span className="text-lg font-semibold tabular-nums text-slate-600">—</span>
      ) : (
        <Tooltip content={exactCount(value)} className="text-lg font-semibold tabular-nums text-slate-100 cursor-help">
          {formatCompactCount(value)}
        </Tooltip>
      )}
    </p>
  );
}
