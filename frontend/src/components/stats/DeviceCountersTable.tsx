import type { StatSample } from "../../api/client.js";
import { Collapsible } from "../Collapsible.js";
import { Tooltip } from "../Tooltip.js";
import { deviceMetricTooltip } from "../../lib/stats-descriptions.js";
import { formatCpuSeconds, friendlyMetricLabel } from "../../lib/stats-format.js";

interface DeviceCountersTableProps {
  /** Non-channel, non-output-counter samples (device-scoped and process-wide alike). */
  samples: StatSample[];
}

const KNOWN_METRIC_ORDER = ["buffer_overflow_count", "buffer_underrun_count", "output_overrun_count", "centerfreq_retune_failure_count"];

function orderMetrics(metrics: string[]): string[] {
  return [...metrics].sort((a, b) => {
    const ai = KNOWN_METRIC_ORDER.indexOf(a);
    const bi = KNOWN_METRIC_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function formatValue(metric: string, value: number): string {
  return metric === "process_cpu_seconds_total" ? formatCpuSeconds(value) : value.toLocaleString();
}

function MetricHeader({ metric }: { metric: string }) {
  const tooltip = deviceMetricTooltip(metric);
  const label = friendlyMetricLabel(metric);
  return tooltip ? (
    <Tooltip content={tooltip} className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
      {label}
    </Tooltip>
  ) : (
    <>{label}</>
  );
}

/**
 * One row per device, one column per device-scoped counter -- replaces the
 * old per-device tile grid (BufferHealthTile + StatTile), which got too busy
 * once a device had more than a couple of counters. Columns are derived from
 * whatever metrics are actually present rather than a hardcoded list, so a
 * new device metric just becomes a new trailing column.
 */
export function DeviceCountersTable({ samples }: DeviceCountersTableProps) {
  const perDevice = samples.filter((s) => s.labels["device"] !== undefined);
  const processWide = samples.filter((s) => s.labels["device"] === undefined);
  if (perDevice.length === 0 && processWide.length === 0) return null;

  const devices = [...new Set(perDevice.map((s) => s.labels["device"]!))].sort((a, b) => Number(a) - Number(b));
  const metrics = orderMetrics([...new Set(perDevice.map((s) => s.metric))]);
  const valueByKey = new Map(perDevice.map((s) => [`${s.labels["device"]}:${s.metric}`, s.value]));

  return (
    <Collapsible title={<span className="text-sm font-medium text-slate-400">Device counters</span>} defaultOpen={false}>
      {devices.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-400">
                <th className="px-3 py-2 font-medium">Device</th>
                {metrics.map((metric) => (
                  <th key={metric} className="px-3 py-2 text-right font-medium">
                    <MetricHeader metric={metric} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device} className="border-b border-slate-800 last:border-b-0 text-slate-200">
                  <td className="px-3 py-2">Device {device}</td>
                  {metrics.map((metric) => {
                    const value = valueByKey.get(`${device}:${metric}`);
                    return (
                      <td
                        key={metric}
                        className={`px-3 py-2 text-right tabular-nums ${value !== undefined && value > 0 ? "font-semibold text-amber-300" : "text-slate-300"}`}
                      >
                        {value === undefined ? "—" : formatValue(metric, value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {processWide.length > 0 && (
        <p className="text-xs text-slate-400">
          <span className="text-slate-500">Process-wide — </span>
          {processWide.map((sample, i) => (
            <span key={sample.metric}>
              {i > 0 && ", "}
              <MetricHeader metric={sample.metric} />: <span className="tabular-nums text-slate-200">{formatValue(sample.metric, sample.value)}</span>
            </span>
          ))}
        </p>
      )}
    </Collapsible>
  );
}
