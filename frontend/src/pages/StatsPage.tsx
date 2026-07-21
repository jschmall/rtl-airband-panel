import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError, type InstanceSummary, type StatSample } from "../api/client.js";
import { SeriesChart, type Series } from "../components/stats/SeriesChart.js";
import { StatTile } from "../components/stats/StatTile.js";
import { TimeRangePicker } from "../components/stats/TimeRangePicker.js";
import { deriveSquelchThresholdSeries } from "../lib/stats-derive.js";
import { CTCSS_TOOLTIP, SNR_CHART_TOOLTIP, SQUELCH_FLAPS_TOOLTIP, SQUELCH_OPENS_TOOLTIP, deviceMetricTooltip } from "../lib/stats-descriptions.js";
import { humanizeLabels, titleCaseMetric } from "../lib/stats-format.js";
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

function findValue(samples: StatSample[], metric: string): number | undefined {
  return samples.find((s) => s.metric === metric)?.value;
}

export function StatsPage() {
  const location = useLocation();
  const initialInstanceName = (location.state as { instanceName?: string } | null)?.instanceName;

  const [instances, setInstances] = useState<InstanceSummary[] | null>(null);
  const [selectedInstanceName, setSelectedInstanceName] = useState<string | null>(initialInstanceName ?? null);
  const [latest, setLatest] = useState<StatSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null);
  const [rangeMs, setRangeMs] = useState<number>(60 * 60 * 1000);
  const [snrSeries, setSnrSeries] = useState<Series[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.listInstances();
        setInstances(list);
        setSelectedInstanceName((current) => (current && list.some((i) => i.name === current) ? current : (list[0]?.name ?? null)));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load instances");
      }
    })();
  }, []);

  const channels = useMemo(() => (latest ? discoverChannels(latest) : []), [latest]);
  const deviceSamples = useMemo(() => (latest ? latest.filter((s) => !s.metric.startsWith("channel_")) : []), [latest]);
  const selectedChannel = channels.find((c) => c.key === selectedChannelKey) ?? channels[0];
  const channelSamples = useMemo(
    () => (latest && selectedChannel ? latest.filter((s) => canonicalizeLabels(s.labels) === selectedChannel.key) : []),
    [latest, selectedChannel]
  );

  const squelchOpens = findValue(channelSamples, "channel_squelch_counter");
  const flappyCount = findValue(channelSamples, "channel_flappy_counter");
  const ctcssDetected = findValue(channelSamples, "channel_ctcss_counter");
  const ctcssNotDetected = findValue(channelSamples, "channel_no_ctcss_counter");
  const ctcssTotal = ctcssDetected !== undefined && ctcssNotDetected !== undefined ? ctcssDetected + ctcssNotDetected : undefined;

  const loadLatest = useCallback(async () => {
    if (!selectedInstanceName) return;
    try {
      const samples = await api.getLatestStats(selectedInstanceName);
      setLatest(samples);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load stats");
    }
  }, [selectedInstanceName]);

  useEffect(() => {
    setLatest(null);
    setSelectedChannelKey(null);
    if (!selectedInstanceName) return;
    void loadLatest();
    const interval = setInterval(() => void loadLatest(), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadLatest, selectedInstanceName]);

  useEffect(() => {
    if (!selectedInstanceName || !selectedChannel) {
      setSnrSeries([]);
      return;
    }
    const sinceMs = Date.now() - rangeMs;
    const { labels } = selectedChannel;

    void Promise.all([
      api.getStatsHistory(selectedInstanceName, { metric: "channel_dbfs_signal_level", labels, sinceMs }),
      api.getStatsHistory(selectedInstanceName, { metric: "channel_signal_level", labels, sinceMs }),
      api.getStatsHistory(selectedInstanceName, { metric: "channel_squelch_level", labels, sinceMs }),
    ]).then(([dbfsSignal, rawSignal, rawSquelch]) => {
      setSnrSeries([
        { key: "signal", label: "Signal (dBFS)", color: CATEGORICAL[0], points: dbfsSignal },
        {
          key: "squelchThreshold",
          label: "Squelch threshold (dBFS)",
          color: CATEGORICAL[1],
          points: deriveSquelchThresholdSeries(dbfsSignal, rawSignal, rawSquelch),
        },
      ]);
    });
  }, [selectedInstanceName, selectedChannel, rangeMs]);

  if (error) return <div className="text-red-300">{error}</div>;
  if (instances === null) return <p className="text-slate-400">Loading…</p>;
  if (instances.length === 0) return <p className="text-slate-400">No instances yet. Create one first.</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Stats</h1>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        Device
        <select className={inputClass} value={selectedInstanceName ?? ""} onChange={(e) => setSelectedInstanceName(e.target.value)}>
          {instances.map((instance) => (
            <option key={instance.name} value={instance.name}>
              {instance.name}
            </option>
          ))}
        </select>
      </label>

      {latest === null ? (
        <p className="text-slate-400">Loading…</p>
      ) : latest.length === 0 ? (
        <p className="text-slate-400">
          No stats recorded yet for this instance. Make sure it's running and its config has <code>stats_filepath</code> set —
          RTLSDR-Airband writes that file roughly every 15 seconds.
        </p>
      ) : (
        <>
          {deviceSamples.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-slate-400">Device / mixer counters (latest)</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {deviceSamples.map((sample, i) => (
                  <StatTile
                    key={i}
                    label={titleCaseMetric(sample.metric)}
                    value={sample.value}
                    sublabel={humanizeLabels(sample.labels)}
                    tooltip={deviceMetricTooltip(sample.metric)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4 border-t border-slate-800 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {channels.length > 0 && (
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
              )}
              <TimeRangePicker value={rangeMs} onChange={setRangeMs} />
            </div>

            <SeriesChart title="Signal vs squelch threshold (dBFS)" series={snrSeries} tooltip={SNR_CHART_TOOLTIP} />

            {(squelchOpens !== undefined || flappyCount !== undefined || ctcssTotal !== undefined) && (
              <div className="space-y-2">
                <h2 className="text-sm font-medium text-slate-400">Channel counters (latest)</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {squelchOpens !== undefined && (
                    <StatTile label="Squelch Opens" value={squelchOpens.toLocaleString()} tooltip={SQUELCH_OPENS_TOOLTIP} />
                  )}
                  {flappyCount !== undefined && (
                    <StatTile label="Squelch Flaps" value={flappyCount.toLocaleString()} tooltip={SQUELCH_FLAPS_TOOLTIP} />
                  )}
                  {ctcssTotal !== undefined && ctcssDetected !== undefined && (
                    <StatTile
                      label={`CTCSS Detected${ctcssTotal > 0 ? ` (${((ctcssDetected / ctcssTotal) * 100).toFixed(1)}%)` : ""}`}
                      value={`${ctcssDetected.toLocaleString()} / ${ctcssTotal.toLocaleString()}`}
                      tooltip={CTCSS_TOOLTIP}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
