import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

interface SparklineProps {
  points: { ts: number; value: number | null }[];
  label: string;
  format: (value: number) => string;
}

const STROKE = "rgb(var(--sky-500))";

/** A single-series trend under a stat tile: no axes, a hover tooltip with the exact value and time. */
export function Sparkline({ points, label, format }: SparklineProps) {
  if (points.filter((p) => p.value !== null).length < 2) {
    return <div className="h-9" aria-hidden="true" />;
  }
  return (
    <div className="h-9" role="img" aria-label={`${label}, last ${Math.round((points[points.length - 1]!.ts - points[0]!.ts) / 60_000) || 1} min`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
          <Tooltip
            cursor={{ stroke: "rgb(var(--slate-500))", strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { ts: number; value: number | null } | undefined;
              if (!active || !p || p.value === null) return null;
              return (
                <div className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 shadow">
                  <span className="tabular-nums">{format(p.value)}</span>
                  <span className="ml-2 text-slate-400">{new Date(p.ts).toLocaleTimeString()}</span>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="value" stroke={STROKE} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
