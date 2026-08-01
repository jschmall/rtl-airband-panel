import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError, type InstanceSummary, type StatSample } from "../api/client.js";
import { BufferHealthTile } from "../components/stats/BufferHealthTile.js";
import { isOutputCounterSample, OutputStats } from "../components/stats/OutputStats.js";
import { SeriesChart, type Series } from "../components/stats/SeriesChart.js";
import { StatTile } from "../components/stats/StatTile.js";
import { TimeRangePicker } from "../components/stats/TimeRangePicker.js";
import { deriveSquelchThresholdSeries } from "../lib/stats-derive.js";
import { BUFFER_HEALTH_TOOLTIP, CTCSS_TOOLTIP, SNR_CHART_TOOLTIP, SQUELCH_FLAPS_TOOLTIP, SQUELCH_OPENS_TOOLTIP, deviceMetricTooltip } from "../lib/stats-descriptions.js";
import { formatCpuSeconds, humanizeLabels, titleCaseMetric } from "../lib/stats-format.js";
import { buildMixerLookups, resolveMixerSampleLabel, type MixerLookups } from "../lib/stats-mixer-labels.js";
import { CATEGORICAL } from "../lib/stats-palette.js";
import { inputClass } from "../components/styles.js";
import { AUTO_REFRESH_MS } from "../lib/polling.js";

const EMPTY_MIXER_LOOKUPS: MixerLookups = { mixerNames: new Map(), inputChannels: new Map() };

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
  // Preserve first-seen order rather than sorting by frequency: RTLSDR-Airband
  // writes stats samples in the same order channels are defined in the config
  // (output.cpp iterates the channels array), which is the same order the
  // instance view's channel list/reorder UI uses. Sorting here would make this
  // dropdown disagree with that order after a channel reorder + restart.
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
  return [...byKey.values()];
}

interface BufferHealth {
  device: string;
  overflow: number | undefined;
  underrun: number | undefined;
}

/**
 * buffer_overflow_count and buffer_underrun_count are always device-labeled
 * (see input-common.h / rtl_airband.cpp in RTLSDR-Airband) and read together
 * -- see BUFFER_HEALTH_TOOLTIP -- so they're grouped into one tile per
 * device instead of rendering through the generic per-sample tile loop.
 */
function groupBufferHealth(samples: StatSample[]): BufferHealth[] {
  const byDevice = new Map<string, BufferHealth>();
  for (const sample of samples) {
    if (sample.metric !== "buffer_overflow_count" && sample.metric !== "buffer_underrun_count") continue;
    const device = sample.labels["device"];
    if (device === undefined) continue;
    let entry = byDevice.get(device);
    if (!entry) {
      entry = { device, overflow: undefined, underrun: undefined };
      byDevice.set(device, entry);
    }
    if (sample.metric === "buffer_overflow_count") entry.overflow = sample.value;
    else entry.underrun = sample.value;
  }
  return [...byDevice.values()];
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
  // Blocking: nothing on this page can render without the instance list.
  const [error, setError] = useState<string | null>(null);
  // Non-blocking: a stats/history poll failing (e.g. a transient network blip)
  // shouldn't tear down the whole page -- it self-heals on the next poll tick,
  // so this just shows a small inline warning above the still-working UI.
  const [statsError, setStatsError] = useState<string | null>(null);
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null);
  const [rangeMs, setRangeMs] = useState<number>(60 * 60 * 1000);
  const [snrSeries, setSnrSeries] = useState<Series[]>([]);
  // Only used to resolve mixer/input indices in stats labels to names -- not
  // re-fetched on every poll tick, since it only needs to be fresh enough to
  // match the mixer topology, which doesn't change without a restart.
  const [mixerLookups, setMixerLookups] = useState<MixerLookups>(EMPTY_MIXER_LOOKUPS);

  const loadInstances = useCallback(async () => {
    setError(null);
    try {
      const list = await api.listInstances();
      setInstances(list);
      setSelectedInstanceName((current) => (current && list.some((i) => i.name === current) ? current : (list[0]?.name ?? null)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    void loadInstances();
  }, [loadInstances]);

  const channels = useMemo(() => (latest ? discoverChannels(latest) : []), [latest]);
  const deviceSamples = useMemo(() => (latest ? latest.filter((s) => !s.metric.startsWith("channel_")) : []), [latest]);
  // Mixer-labeled samples (output_overrun_count{mixer=...}, input_overrun_count) get their own
  // section below the chart instead of the device tile grid -- a mixer with a dozen inputs would
  // otherwise dwarf the rest of the page with one tile per input.
  const deviceOnlySamples = useMemo(() => deviceSamples.filter((s) => s.labels["mixer"] === undefined), [deviceSamples]);
  const bufferHealthByDevice = useMemo(() => groupBufferHealth(deviceOnlySamples), [deviceOnlySamples]);
  // Everything buffer health and OutputStats already cover is pulled out of the generic tile loop below.
  const otherDeviceSamples = useMemo(
    () =>
      deviceOnlySamples.filter(
        (s) =>
          !((s.metric === "buffer_overflow_count" || s.metric === "buffer_underrun_count") && s.labels["device"] !== undefined) &&
          !isOutputCounterSample(s)
      ),
    [deviceOnlySamples]
  );
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
      setStatsError(null);
    } catch (err) {
      setStatsError(err instanceof ApiError ? err.message : "Couldn't reach the server. Check your connection and try again.");
    }
  }, [selectedInstanceName]);

  const loadHistory = useCallback(async () => {
    if (!selectedInstanceName || !selectedChannel) {
      setSnrSeries([]);
      return;
    }
    const sinceMs = Date.now() - rangeMs;
    const { labels } = selectedChannel;

    try {
      const [dbfsSignal, rawSignal, rawSquelch] = await Promise.all([
        api.getStatsHistory(selectedInstanceName, { metric: "channel_dbfs_signal_level", labels, sinceMs }),
        api.getStatsHistory(selectedInstanceName, { metric: "channel_signal_level", labels, sinceMs }),
        api.getStatsHistory(selectedInstanceName, { metric: "channel_squelch_level", labels, sinceMs }),
      ]);
      setSnrSeries([
        { key: "signal", label: "Signal (dBFS)", color: CATEGORICAL[0], points: dbfsSignal },
        {
          key: "squelchThreshold",
          label: "Squelch threshold (dBFS)",
          color: CATEGORICAL[1],
          points: deriveSquelchThresholdSeries(dbfsSignal, rawSignal, rawSquelch),
        },
      ]);
      setStatsError(null);
    } catch (err) {
      setStatsError(err instanceof ApiError ? err.message : "Couldn't reach the server. Check your connection and try again.");
    }
  }, [selectedInstanceName, selectedChannel, rangeMs]);

  // `loadHistory`'s identity changes on every poll tick (it closes over
  // `selectedChannel`, which is a fresh object from a fresh `channels` array
  // every time `latest` updates) -- keeping it out of the interval-effect's own
  // deps via a ref means the interval's lifecycle stays tied to the instance
  // selection only, not to every tick's side effects. Putting `loadHistory`
  // directly in that effect's deps previously caused it to tear down and
  // recreate the interval (and re-fire loadLatest) on every single tick.
  const loadHistoryRef = useRef(loadHistory);
  useEffect(() => {
    loadHistoryRef.current = loadHistory;
  }, [loadHistory]);

  useEffect(() => {
    setLatest(null);
    setSelectedChannelKey(null);
    setMixerLookups(EMPTY_MIXER_LOOKUPS);
    if (!selectedInstanceName) return;
    api
      .getConfig(selectedInstanceName)
      .then(({ config }) => setMixerLookups(buildMixerLookups(config)))
      .catch(() => undefined); // mixer/input tiles just fall back to raw indices below
    void loadLatest();
    // Same interval drives both the stat tiles and the history chart below them, so
    // they never drift out of sync the way they used to (tiles moving on every poll,
    // chart only reloading when the user changed instance/channel/range).
    const interval = setInterval(() => {
      void loadLatest();
      void loadHistoryRef.current();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadLatest, selectedInstanceName]);

  // Fires on an actual selection change (instance/channel/range), not on every poll
  // tick. Depends on `selectedChannel?.key` (a plain string) rather than the
  // `selectedChannel` object itself or the `selectedChannelKey` state -- the object
  // is a fresh reference every time `latest` updates even when it's still "the same"
  // channel (which is what caused the tight loop above), while `selectedChannelKey`
  // stays null until the user makes an explicit choice and so never reacts to the
  // initial auto-selected-first-channel transition. The key string changes exactly
  // when the actually-selected channel changes, no more and no less. Calls through
  // the ref so it always runs the version of loadHistory closing over the current
  // selectedChannel object.
  useEffect(() => {
    void loadHistoryRef.current();
  }, [selectedInstanceName, selectedChannel?.key, rangeMs]);

  if (error) {
    return (
      <div className="space-y-3 rounded border border-red-500/40 bg-red-500/10 p-4">
        <p className="text-red-300">{error}</p>
        <button type="button" onClick={() => void loadInstances()} className="text-sm text-sky-400 hover:text-sky-300">
          Retry
        </button>
      </div>
    );
  }
  if (instances === null) return <p className="text-slate-400">Loading…</p>;
  if (instances.length === 0) return <p className="text-slate-400">No instances yet. Create one first.</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Stats</h1>

      {statsError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {statsError} (retrying automatically every {AUTO_REFRESH_MS / 1000}s)
        </div>
      )}

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
          {deviceOnlySamples.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-slate-400">Device counters (latest)</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {bufferHealthByDevice.map((bh) => (
                  <BufferHealthTile key={`buffer-health-${bh.device}`} device={bh.device} overflow={bh.overflow} underrun={bh.underrun} tooltip={BUFFER_HEALTH_TOOLTIP} />
                ))}
                {otherDeviceSamples.map((sample, i) => (
                  <StatTile
                    key={i}
                    label={titleCaseMetric(sample.metric)}
                    value={sample.metric === "process_cpu_seconds_total" ? formatCpuSeconds(sample.value) : sample.value}
                    sublabel={resolveMixerSampleLabel(sample.metric, sample.labels, mixerLookups) ?? humanizeLabels(sample.labels)}
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

            <OutputStats samples={deviceSamples} mixerLookups={mixerLookups} />

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
