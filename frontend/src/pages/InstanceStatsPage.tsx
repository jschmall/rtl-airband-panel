import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type StatSample } from "../api/client.js";
import { SeriesChart, type Series } from "../components/stats/SeriesChart.js";
import { TimeRangePicker } from "../components/stats/TimeRangePicker.js";
import { CATEGORICAL } from "../lib/stats-palette.js";
import { inputClass } from "../components/styles.js";

const AUTO_REFRESH_MS = 20_000;

interface ChannelOption {
  key: string;
  freq: string;
  label: string | undefined;
  labels: Record<string, string>;
}

function canonicalizeLabels(labels: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(labels).sort()) sorted[key] = labels[key]!;
  return JSON.stringify(sorted);
}

function discoverChannels(latest: StatSample[]): ChannelOption[] {
  const byKey = new Map<string, ChannelOption>();
  for (const sample of latest) {
    if (!sample.metric.startsWith("channel_")) continue;
    const freq = sample.labels["freq"];
    if (!freq) continue;
    const key = canonicalizeLabels(sample.labels);
    if (!byKey.has(key)) {
      byKey.set(key, { key, freq, label: sample.labels["label"], labels: sample.labels });
    }
  }
  return [...byKey.values()].sort((a, b) => Number(a.freq) - Number(b.freq));
}

function formatMetricLabel(metric: string, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return labelStr ? `${metric} (${labelStr})` : metric;
}

export function InstanceStatsPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const [latest, setLatest] = useState<StatSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null);
  const [rangeMs, setRangeMs] = useState<number>(60 * 60 * 1000);
  const [signalNoiseSeries, setSignalNoiseSeries] = useState<Series[]>([]);
  const [squelchSeries, setSquelchSeries] = useState<Series[]>([]);

  const channels = useMemo(() => (latest ? discoverChannels(latest) : []), [latest]);
  const deviceSamples = useMemo(() => (latest ? latest.filter((s) => !s.metric.startsWith("channel_")) : []), [latest]);
  const selectedChannel = channels.find((c) => c.key === selectedChannelKey) ?? channels[0];

  const loadLatest = useCallback(async () => {
    if (!name) return;
    try {
      const samples = await api.getLatestStats(name);
      setLatest(samples);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load stats");
    }
  }, [name]);

  useEffect(() => {
    void loadLatest();
    const interval = setInterval(() => void loadLatest(), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadLatest]);

  useEffect(() => {
    if (!name || !selectedChannel) {
      setSignalNoiseSeries([]);
      setSquelchSeries([]);
      return;
    }
    const sinceMs = Date.now() - rangeMs;
    const { labels } = selectedChannel;

    void Promise.all([
      api.getStatsHistory(name, { metric: "channel_dbfs_signal_level", labels, sinceMs }),
      api.getStatsHistory(name, { metric: "channel_dbfs_noise_level", labels, sinceMs }),
    ]).then(([signal, noise]) => {
      setSignalNoiseSeries([
        { key: "signal", label: "Signal (dBFS)", color: CATEGORICAL[0], points: signal },
        { key: "noise", label: "Noise (dBFS)", color: CATEGORICAL[1], points: noise },
      ]);
    });

    void api.getStatsHistory(name, { metric: "channel_squelch_counter", labels, sinceMs }).then((points) => {
      setSquelchSeries([{ key: "squelch", label: "Squelch opens", color: CATEGORICAL[0], points }]);
    });
  }, [name, selectedChannel, rangeMs]);

  if (error) return <div className="text-red-300">{error}</div>;
  if (!latest) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Stats — {name}</h1>
        <button type="button" onClick={() => navigate(`/instances/${name}`)} className="text-sm text-slate-400 hover:text-slate-200">
          ← Back to config
        </button>
      </div>

      {latest.length === 0 ? (
        <p className="text-slate-400">
          No stats recorded yet for this instance. Make sure it's running and its config has <code>stats_filepath</code> set —
          RTLSDR-Airband writes that file roughly every 15 seconds.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              Channel
              <select
                className={inputClass}
                value={selectedChannel?.key ?? ""}
                onChange={(e) => setSelectedChannelKey(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.freq} MHz{c.label ? ` — ${c.label}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <TimeRangePicker value={rangeMs} onChange={setRangeMs} />
          </div>

          <SeriesChart title="Signal vs noise (dBFS)" series={signalNoiseSeries} />
          <SeriesChart title="Squelch opens" series={squelchSeries} />

          {deviceSamples.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-slate-400">Device / mixer counters (latest)</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {deviceSamples.map((sample, i) => (
                  <div key={i} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                    <p className="text-xs text-slate-400">{formatMetricLabel(sample.metric, sample.labels)}</p>
                    <p className="text-lg font-semibold tabular-nums text-slate-100">{sample.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
