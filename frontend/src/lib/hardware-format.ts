import type { SdrHealth } from "../api/client.js";

export type HealthLevel = "good" | "warning" | "critical";

/** Headroom below ADC clipping: under 1 dB is clipping, under 3 dB is one strong signal away from it. */
export function headroomLevel(headroomDb: number | null): HealthLevel | null {
  if (headroomDb === null) return null;
  if (headroomDb < 1) return "critical";
  if (headroomDb < 3) return "warning";
  return "good";
}

export const HEADROOM_LABEL: Record<HealthLevel, string> = {
  good: "OK",
  warning: "Low headroom",
  critical: "Clipping",
};

export function formatMHz(hz: number | null, digits = 4): string {
  return hz === null ? "—" : `${(hz / 1e6).toFixed(digits)} MHz`;
}

/** Sample-rate span, e.g. "2.56 MHz" or "240 kHz". */
export function formatSpan(hz: number | null): string {
  if (hz === null) return "—";
  return hz >= 1e6 ? `${+(hz / 1e6).toFixed(3)} MHz` : `${+(hz / 1e3).toFixed(1)} kHz`;
}

export function formatDb(value: number | null, unit = "dB", digits = 1): string {
  return value === null ? "—" : `${value.toFixed(digits)} ${unit}`;
}

export function formatSigned(value: number | null, unit: string, digits = 1): string {
  if (value === null) return "—";
  const fixed = value.toFixed(digits);
  return `${value > 0 && Number(fixed) !== 0 ? "+" : ""}${fixed} ${unit}`;
}

export function formatCount(value: number | null): string {
  return value === null ? "—" : Math.round(value).toLocaleString();
}

export function formatRate(perSec: number | null): string {
  if (perSec === null) return "";
  if (perSec === 0) return "0/s";
  return perSec >= 10 ? `${Math.round(perSec).toLocaleString()}/s` : `${perSec.toFixed(1)}/s`;
}

export function sdrTitle(sdr: SdrHealth): string {
  const id = sdr.serial ? `SN ${sdr.serial}` : sdr.deviceString ? sdr.deviceString : `device ${sdr.index}`;
  return `${sdr.driver} · ${id}`;
}

export function gainText(sdr: SdrHealth): string {
  if (sdr.gainDb !== null) return `${sdr.gainDb.toFixed(1)} dB`;
  if (sdr.gainText) return sdr.gainText;
  return "—";
}

/** Why an instance's readings aren't live, in words. */
export function notLiveReason(reason: string | null, detail: string | null): string {
  switch (reason) {
    case "no-control-socket":
      return "Live readings need control_socket_path set on this instance.";
    case "not-running":
      return "The instance isn't running.";
    case "unsupported":
      return "This instance's rtl_airband is older than fork v6.4.0 and has no status command.";
    case "unreachable":
      return `The control socket didn't answer${detail ? ` (${detail})` : ""}.`;
    case "protocol-error":
      return `The control socket sent an unexpected reply${detail ? `: ${detail}` : ""}.`;
    case "config-error":
      return `The config couldn't be read${detail ? `: ${detail}` : ""}.`;
    default:
      return reason ?? "";
  }
}

export interface HistoryPoint {
  ts: number;
  headroomDb: number | null;
  noiseFloorDbfs: number | null;
  freqErrorPpm: number | null;
}

export const HISTORY_WINDOW_MS = 5 * 60_000;

/** Key for an SDR's history across snapshots: instance plus device index. */
export function sdrKey(instance: string, sdr: SdrHealth): string {
  return `${instance}/${sdr.index}`;
}

/**
 * Appends one snapshot's readings to each SDR's rolling history, dropping
 * points older than the window and SDRs no longer present. Returns a new map.
 */
export function appendHistory(
  history: ReadonlyMap<string, HistoryPoint[]>,
  ts: number,
  sdrs: { key: string; sdr: SdrHealth }[],
  windowMs = HISTORY_WINDOW_MS
): Map<string, HistoryPoint[]> {
  const next = new Map<string, HistoryPoint[]>();
  for (const { key, sdr } of sdrs) {
    const prev = history.get(key) ?? [];
    if (prev.length && prev[prev.length - 1]!.ts >= ts) {
      next.set(key, prev);
      continue;
    }
    const kept = prev.filter((p) => p.ts > ts - windowMs);
    kept.push({ ts, headroomDb: sdr.headroomDb, noiseFloorDbfs: sdr.noiseFloorDbfs, freqErrorPpm: sdr.freqErrorPpm });
    next.set(key, kept);
  }
  return next;
}
