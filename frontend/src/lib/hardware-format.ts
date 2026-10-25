import type { InstanceHardware, SdrHealth } from "../api/client.js";

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

/**
 * Orders serial numbers: all-digit serials first, by numeric value (leading
 * zeros ignored, so "00000002" < "10"), then the rest alphabetically
 * (case-insensitive, digit runs compared as numbers), then no serial.
 */
export function compareSerials(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null || a === "") return 1;
  if (b === null || b === "") return -1;
  const numA = /^\d+$/.test(a);
  const numB = /^\d+$/.test(b);
  if (numA !== numB) return numA ? -1 : 1;
  if (numA) {
    const ta = a.replace(/^0+(?=\d)/, "");
    const tb = b.replace(/^0+(?=\d)/, "");
    if (ta.length !== tb.length) return ta.length - tb.length;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || (a < b ? -1 : 1);
}

function compareSdrs(a: SdrHealth, b: SdrHealth): number {
  return compareSerials(a.serial, b.serial) || a.index - b.index;
}

/**
 * Instances ordered by the serial of their first SDR, each instance's SDRs
 * sorted by serial too. Instances without devices go last, by name.
 */
export function sortBySerial(instances: readonly InstanceHardware[]): InstanceHardware[] {
  const sorted = instances.map((i) => ({ ...i, devices: [...i.devices].sort(compareSdrs) }));
  return sorted.sort((a, b) => {
    const da = a.devices[0];
    const db = b.devices[0];
    if (!da || !db) return da ? -1 : db ? 1 : a.name.localeCompare(b.name);
    return compareSdrs(da, db) || a.name.localeCompare(b.name);
  });
}

export function gainText(sdr: SdrHealth): string {
  if (sdr.gainDb !== null) return `${sdr.gainDb.toFixed(1)} dB`;
  if (sdr.gainText) return sdr.gainText;
  return "—";
}

/** A next step shown under a reading: something to change, or a confirmation that nothing needs to. */
export interface Advice {
  tone: "ok" | "action";
  text: string;
}

/**
 * The frequency-error advice. The suggestion is the absolute value to set
 * (the backend's suggestedCorrection), not an amount to add, so it's shown
 * next to the current value; it clears once the remaining error is small.
 */
export function correctionAdvice(sdr: SdrHealth): Advice | null {
  if (sdr.correctionUnit !== "ppm" || sdr.freqErrorPpm === null) return null;
  const current = sdr.correction ?? 0;
  if (sdr.suggestedCorrection === null || sdr.suggestedCorrection === current) {
    return { tone: "ok", text: "Correction OK" };
  }
  return { tone: "action", text: `Set correction to ${sdr.suggestedCorrection} ppm (now ${current})` };
}

/** Gain steps (dB) of the R820T/R828D tuners on most rtl-sdr dongles; librtlsdr rounds to these. */
export const R820T_GAINS_DB = [
  0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4, 28, 29.7, 32.8, 33.8, 36.4, 37.2,
  38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48, 49.6,
] as const;

/** Headroom the gain advice aims for, and the band it leaves alone (dB below full scale). */
export const GAIN_TARGET_HEADROOM_DB = 6;
export const GAIN_IDEAL_HEADROOM_DB = { min: 3, max: 12 } as const;
/** How much history a "raise gain" suggestion needs: quiet minutes can hide a strong transmitter. */
export const GAIN_RAISE_MIN_HISTORY_MS = 2 * 60_000;

function snapGain(sdr: SdrHealth, current: number, target: number): number {
  const onTable = sdr.driver === "rtlsdr" && R820T_GAINS_DB.some((g) => Math.abs(g - current) < 0.05);
  if (!onTable) return Math.max(0, Math.floor(target));
  // The highest step at or below the target, so the result never undershoots the headroom goal.
  return [...R820T_GAINS_DB].reverse().find((g) => g <= target + 1e-9) ?? R820T_GAINS_DB[0];
}

function formatGain(db: number): string {
  return `${+db.toFixed(1)} dB`;
}

/**
 * Gain advice from the worst (smallest) headroom in the SDR's recent
 * history, so a transmission a minute ago still counts: lower the gain when
 * peaks reach within GAIN_IDEAL_HEADROOM_DB.min of full scale (or samples
 * are clipping), raise it when even the strongest peak stayed more than
 * GAIN_IDEAL_HEADROOM_DB.max below for a couple of minutes. Either way the
 * suggestion moves the worst peak to GAIN_TARGET_HEADROOM_DB.
 */
export function gainAdvice(sdr: SdrHealth, allHistory: readonly HistoryPoint[]): Advice | null {
  // Only readings taken at the current gain (a live set_gain keeps the history).
  let from = allHistory.length;
  while (from > 0 && allHistory[from - 1]!.gainDb === sdr.gainDb) from--;
  const history = allHistory.slice(from);
  const headrooms = history.map((p) => p.headroomDb).filter((h): h is number => h !== null);
  if (sdr.headroomDb !== null) headrooms.push(sdr.headroomDb);
  if (headrooms.length === 0) return null;
  const worst = Math.min(...headrooms);
  const clipping = (sdr.clippedPerSec ?? 0) > 0 || worst < GAIN_IDEAL_HEADROOM_DB.min;
  const current = sdr.gainDb;
  if (current === null) {
    return clipping ? { tone: "action", text: "Clipping under automatic gain: set a manual gain" } : null;
  }
  if (clipping) {
    let next = snapGain(sdr, current, current - (GAIN_TARGET_HEADROOM_DB - worst));
    if (next >= current) next = snapGain(sdr, current, current - 1);
    if (next >= current) return { tone: "action", text: "Clipping at minimum gain: add attenuation or a filter" };
    return { tone: "action", text: `Lower gain to ${formatGain(next)} (now ${formatGain(current)})` };
  }
  const span = history.length > 1 ? history[history.length - 1]!.ts - history[0]!.ts : 0;
  if (worst > GAIN_IDEAL_HEADROOM_DB.max && span >= GAIN_RAISE_MIN_HISTORY_MS) {
    const next = snapGain(sdr, current, current + (worst - GAIN_TARGET_HEADROOM_DB));
    if (next > current) {
      return { tone: "action", text: `Room to raise gain to ${formatGain(next)} (now ${formatGain(current)})` };
    }
  }
  return { tone: "ok", text: worst > GAIN_IDEAL_HEADROOM_DB.max ? "Gain OK so far" : "Gain OK" };
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
  gainDb: number | null;
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
    kept.push({ ts, headroomDb: sdr.headroomDb, noiseFloorDbfs: sdr.noiseFloorDbfs, freqErrorPpm: sdr.freqErrorPpm, gainDb: sdr.gainDb });
    next.set(key, kept);
  }
  return next;
}
