import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryPoint } from "../../api/client.js";
import { CHART_CHROME } from "../../lib/stats-palette.js";

export interface Series {
  key: string;
  label: string;
  color: string;
  points: HistoryPoint[];
}

interface SeriesChartProps {
  title: string;
  series: Series[];
  emptyMessage?: string;
}

type MergedRow = { ts: number } & Record<string, number | undefined>;

function mergeByTimestamp(series: Series[]): MergedRow[] {
  const rows = new Map<number, MergedRow>();
  for (const s of series) {
    for (const point of s.points) {
      let row = rows.get(point.ts);
      if (!row) {
        row = { ts: point.ts };
        rows.set(point.ts, row);
      }
      row[s.key] = point.value;
    }
  }
  return [...rows.values()].sort((a, b) => a.ts - b.ts);
}

function formatTick(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTooltipLabel(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function SeriesChart({ title, series, emptyMessage = "No data in this time range yet." }: SeriesChartProps) {
  const [showTable, setShowTable] = useState(false);
  const data = useMemo(() => mergeByTimestamp(series), [series]);
  const hasData = data.length > 0;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-slate-200">{title}</h3>
        {hasData && (
          <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs text-sky-400 hover:text-sky-300">
            {showTable ? "View chart" : "View table"}
          </button>
        )}
      </div>

      {!hasData ? (
        <p className="py-8 text-center text-sm text-slate-500">{emptyMessage}</p>
      ) : showTable ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="py-1 pr-4">Time</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 pr-4">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.ts} className="border-t border-slate-800 text-slate-300">
                  <td className="py-1 pr-4 tabular-nums">{formatTooltipLabel(row.ts)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 pr-4 tabular-nums">
                      {row[s.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke={CHART_CHROME.gridline} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="ts"
              tickFormatter={formatTick}
              stroke={CHART_CHROME.axis}
              tick={{ fill: CHART_CHROME.muted, fontSize: 11 }}
              minTickGap={40}
            />
            <YAxis stroke={CHART_CHROME.axis} tick={{ fill: CHART_CHROME.muted, fontSize: 11 }} width={48} />
            <Tooltip
              labelFormatter={formatTooltipLabel}
              contentStyle={{ background: CHART_CHROME.surface, border: `1px solid ${CHART_CHROME.gridline}`, fontSize: 12 }}
              labelStyle={{ color: CHART_CHROME.textSecondary }}
              itemStyle={{ color: CHART_CHROME.textPrimary }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: CHART_CHROME.textSecondary }} />}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
