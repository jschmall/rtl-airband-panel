import type { HistoryPoint } from "../api/client.js";

/**
 * channel_squelch_level shares whatever linear-to-dBFS constant
 * RTLSDR-Airband applies to channel_signal_level (same squelch subsystem,
 * same units), so that constant cancels out of the ratio and this needs no
 * calibration: squelch_dbfs = dbfs_signal + 20*log10(squelch/signal).
 */
export function deriveSquelchThresholdSeries(
  dbfsSignal: HistoryPoint[],
  rawSignal: HistoryPoint[],
  rawSquelch: HistoryPoint[]
): HistoryPoint[] {
  const signalByTs = new Map(rawSignal.map((p) => [p.ts, p.value]));
  const squelchByTs = new Map(rawSquelch.map((p) => [p.ts, p.value]));

  const points: HistoryPoint[] = [];
  for (const { ts, value: dbfs } of dbfsSignal) {
    const signal = signalByTs.get(ts);
    const squelch = squelchByTs.get(ts);
    if (signal === undefined || squelch === undefined || signal <= 0) continue;
    points.push({ ts, value: dbfs + 20 * Math.log10(squelch / signal) });
  }
  return points;
}
