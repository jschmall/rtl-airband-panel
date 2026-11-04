import type { HardwareHistory, HardwareHistoryPoint, InstanceHardware, SdrHealth } from "../api/client.js";

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

export function gainText(sdr: SdrHealth): string {
  if (sdr.gainDb !== null) return `${sdr.gainDb.toFixed(1)} dB`;
  if (sdr.gainText) return sdr.gainText;
  return "—";
}

/**
 * A next step shown under a reading. `warn`: something should change
 * (clipping, lower the gain, fix the correction). `info`: an optional
 * improvement (room to raise the gain). `ok`: nothing needs to change.
 * `pending`: not enough readings for a verdict yet.
 */
export interface Advice {
  tone: "ok" | "warn" | "info" | "pending";
  text: string;
}

/**
 * The frequency-error advice. The suggestion is the absolute value to set
 * (the backend's suggestedCorrection), not an amount to add, so it's shown
 * next to the current value; it clears once the remaining error is small.
 */
export function correctionAdvice(sdr: SdrHealth): Advice | null {
  if (sdr.autoPpm?.active) {
    // No residual also covers a hold that can last ("1 voter, need 2"), which the reason names.
    return sdr.autoPpm.residualPpm === null
      ? { tone: "pending", text: sdr.autoPpm.reason ? `auto_ppm active, ${sdr.autoPpm.reason}` : "auto_ppm active, measuring…" }
      : { tone: "ok", text: `auto_ppm active (residual ${formatSigned(sdr.autoPpm.residualPpm, "ppm", 2)})` };
  }
  if (sdr.correctionUnit !== "ppm" || sdr.freqErrorPpm === null) return null;
  const current = sdr.correction ?? 0;
  if (sdr.suggestedCorrection === null || sdr.suggestedCorrection === current) {
    return { tone: "ok", text: "Correction OK" };
  }
  return { tone: "warn", text: `Set correction to ${sdr.suggestedCorrection} ppm (now ${current})` };
}

/** Gain steps (dB) of the R820T/R828D tuners on most rtl-sdr dongles; librtlsdr rounds to these. */
export const R820T_GAINS_DB = [
  0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4, 28, 29.7, 32.8, 33.8, 36.4, 37.2,
  38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48, 49.6,
] as const;

/** Headroom the gain advice aims for, and the band it leaves alone (dB below full scale). */
export const GAIN_TARGET_HEADROOM_DB = 6;
export const GAIN_IDEAL_HEADROOM_DB = { min: 3, max: 12 } as const;
/**
 * How much history at the current gain any gain verdict needs, short of
 * live clipping: quiet minutes can hide a strong transmitter, and one loud
 * second shouldn't call for a lower gain.
 */
export const GAIN_ADVICE_MIN_HISTORY_MS = 2 * 60_000;

const COLLECTING: Advice = { tone: "pending", text: "Collecting readings…" };

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
 * peaks reach within GAIN_IDEAL_HEADROOM_DB.min of full scale, raise it when
 * even the strongest peak stayed more than GAIN_IDEAL_HEADROOM_DB.max below.
 * Either way the suggestion moves the worst peak to GAIN_TARGET_HEADROOM_DB.
 * Samples clipping right now call for a lower gain at once; anything else
 * waits for GAIN_ADVICE_MIN_HISTORY_MS of readings at the current gain.
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
  const clippingNow = (sdr.clippedPerSec ?? 0) > 0;
  const span = history.length > 1 ? history[history.length - 1]!.ts - history[0]!.ts : 0;
  const warmedUp = span >= GAIN_ADVICE_MIN_HISTORY_MS;
  const tooHot = clippingNow || (warmedUp && worst < GAIN_IDEAL_HEADROOM_DB.min);
  const current = sdr.gainDb;
  if (current === null) {
    return tooHot ? { tone: "warn", text: "Clipping under automatic gain: set a manual gain" } : null;
  }
  if (tooHot) {
    let next = snapGain(sdr, current, current - (GAIN_TARGET_HEADROOM_DB - worst));
    if (next >= current) next = snapGain(sdr, current, current - 1);
    if (next >= current) return { tone: "warn", text: "Clipping at minimum gain: add attenuation or a filter" };
    return { tone: "warn", text: `Lower gain to ${formatGain(next)} (now ${formatGain(current)})` };
  }
  if (!warmedUp) return COLLECTING;
  if (worst > GAIN_IDEAL_HEADROOM_DB.max) {
    const next = snapGain(sdr, current, current + (worst - GAIN_TARGET_HEADROOM_DB));
    if (next > current) {
      return { tone: "info", text: `Room to raise gain to ${formatGain(next)} (now ${formatGain(current)})` };
    }
  }
  return { tone: "ok", text: "Gain OK" };
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

/** One SDR's readings at one snapshot; the same shape GET /api/hardware/history returns. */
export type HistoryPoint = HardwareHistoryPoint;

export const HISTORY_WINDOW_MS = 5 * 60_000;

/** The instance editor, opened at this SDR's device section (see InstanceEditPage's `device` parameter). */
export function sdrEditorHref(instance: string, sdr: SdrHealth): string {
  return `${instanceEditorHref(instance)}?device=${sdr.configIndex}`;
}

/**
 * The live correction to offer saving, when auto_ppm has moved it away from
 * the config's value (whole ppm, as rtlsdr takes it); null otherwise.
 */
export function unsavedAutoCorrection(sdr: SdrHealth): number | null {
  if (!sdr.autoPpm || sdr.correction === null || sdr.correctionUnit !== "ppm") return null;
  const live = Math.round(sdr.correction);
  return live === (sdr.configCorrection ?? 0) ? null : live;
}

/** The editor, with `correction` put into that device's (unsaved) draft. */
export function saveCorrectionHref(instance: string, sdr: SdrHealth, correction: number): string {
  return `${sdrEditorHref(instance, sdr)}&correction=${correction}`;
}

/** auto_ppm's state in a few words, with a tone for the badge. */
export function autoPpmSummary(sdr: SdrHealth): Advice | null {
  const a = sdr.autoPpm;
  if (!a) return null;
  if (!a.enabled) return { tone: "pending", text: "auto_ppm off" };
  if (!a.active) return { tone: "warn", text: `auto_ppm stopped: ${a.disabledReason ?? "tripped"}. Fix the cause, then restart the instance to re-arm it.` };
  return { tone: "ok", text: a.reason ? `auto_ppm on · ${a.reason}` : "auto_ppm on" };
}

export function instanceEditorHref(instance: string): string {
  return `/instances/${encodeURIComponent(instance)}`;
}

/** Key for an SDR's history across snapshots: instance plus device index. */
export function sdrKey(instance: string, sdr: SdrHealth): string {
  return `${instance}/${sdr.index}`;
}

/**
 * Merges recorded history (GET /api/hardware/history) into the page's
 * history: points are unioned by timestamp, so a snapshot both recorded and
 * already appended isn't counted twice. SDRs with no recorded points keep
 * their own. Returns a new map.
 */
export function mergeHistory(
  history: ReadonlyMap<string, HistoryPoint[]>,
  recorded: HardwareHistory,
  now: number,
  windowMs = HISTORY_WINDOW_MS
): Map<string, HistoryPoint[]> {
  const next = new Map(history);
  for (const { instance, index, points } of recorded.sdrs) {
    const key = `${instance}/${index}`;
    const byTs = new Map<number, HistoryPoint>();
    for (const p of [...points, ...(history.get(key) ?? [])]) {
      if (p.ts > now - windowMs) byTs.set(p.ts, p);
    }
    next.set(key, [...byTs.values()].sort((a, b) => a.ts - b.ts));
  }
  return next;
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

// ---- Sorting and severity ----

export type HardwareSort = "instance" | "serial" | "severity";

export const HARDWARE_SORT_LABEL: Record<HardwareSort, string> = {
  instance: "Instance",
  serial: "SDR serial",
  severity: "Severity",
};

/** Instances by name (case-insensitive, numbers in order), each instance's SDRs by serial. */
export function sortByInstance(instances: readonly InstanceHardware[]): InstanceHardware[] {
  return instances
    .map((i) => ({ ...i, devices: [...i.devices].sort(compareSdrs) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || (a.name < b.name ? -1 : 1));
}

/** One SDR with the instance it belongs to: the unit of the flat (serial/severity) layouts. */
export interface PlacedSdr {
  instance: InstanceHardware;
  sdr: SdrHealth;
}

export function flattenSdrs(instances: readonly InstanceHardware[]): PlacedSdr[] {
  return instances.flatMap((instance) => instance.devices.map((sdr) => ({ instance, sdr })));
}

/** By serial; the instance name breaks ties, then the device index. */
function comparePlaced(a: PlacedSdr, b: PlacedSdr): number {
  return compareSerials(a.sdr.serial, b.sdr.serial) || a.instance.name.localeCompare(b.instance.name) || a.sdr.index - b.sdr.index;
}

export function sortSdrsBySerial<T extends PlacedSdr>(sdrs: readonly T[]): T[] {
  return [...sdrs].sort(comparePlaced);
}

/**
 * When an SDR last clipped or dropped samples, by sdrKey. Both come and go
 * from one 2 s reading to the next, so the severity counts them for
 * TRANSIENT_HOLD_MS after the last one rather than flickering the order.
 */
export type TransientMarks = ReadonlyMap<string, { clipAt?: number; dropAt?: number }>;

export const TRANSIENT_HOLD_MS = 60_000;

export function markTransients(prev: TransientMarks, now: number, sdrs: readonly { key: string; sdr: SdrHealth }[]): TransientMarks {
  const next = new Map<string, { clipAt?: number; dropAt?: number }>();
  for (const { key, sdr } of sdrs) {
    const p = prev.get(key) ?? {};
    const m = {
      clipAt: (sdr.clippedPerSec ?? 0) > 0 ? now : p.clipAt,
      dropAt: (sdr.overflowsPerSec ?? 0) > 0 ? now : p.dropAt,
    };
    if (m.clipAt !== undefined || m.dropAt !== undefined) next.set(key, m);
  }
  return next;
}

/**
 * How serious a finding is. `critical`: the SDR isn't receiving properly
 * right now. `warn`: something should change. `info`: optional, or no
 * live readings to judge by.
 */
export type IssueLevel = "critical" | "warn" | "info";

export interface SdrIssue {
  level: IssueLevel;
  text: string;
}

export interface IssueContext {
  /** The SDR's history at this page (for the gain advice). */
  history: readonly HistoryPoint[];
  /** Its clip/drop marks (markTransients) and the snapshot time. */
  marks?: { clipAt?: number; dropAt?: number };
  now: number;
  /** Errors and warnings logged for its instance recently. */
  recentProblems?: number;
}

/** Not-live reasons that mean something is wrong, rather than that there's no way to read the SDR. */
const DOWN_REASONS = new Set(["not-running", "unreachable", "protocol-error", "config-error"]);

/**
 * Everything worth flagging about one SDR, worst first. Built from the same
 * advice the card shows, so the severity order never disagrees with it.
 */
export function sdrIssues(instance: InstanceHardware, sdr: SdrHealth, ctx: IssueContext): SdrIssue[] {
  const issues: SdrIssue[] = [];
  if (!instance.live) {
    const reason = notLiveReason(instance.reason, instance.detail);
    issues.push(DOWN_REASONS.has(instance.reason ?? "") ? { level: "critical", text: reason } : { level: "info", text: `No live readings. ${reason}` });
  } else {
    const within = (t: number | undefined) => t !== undefined && ctx.now - t < TRANSIENT_HOLD_MS;
    if (sdr.state !== null && sdr.state !== "running") issues.push({ level: "critical", text: `Input ${sdr.state}` });
    if ((sdr.clippedPerSec ?? 0) > 0) issues.push({ level: "critical", text: "Clipping now" });
    else if (within(ctx.marks?.clipAt)) issues.push({ level: "critical", text: "Clipped in the last minute" });
    if ((sdr.overflowsPerSec ?? 0) > 0) issues.push({ level: "critical", text: "Dropping samples now" });
    else if (within(ctx.marks?.dropAt)) issues.push({ level: "critical", text: "Dropped samples in the last minute" });

    const gain = gainAdvice(sdr, ctx.history);
    if (gain?.tone === "warn") issues.push({ level: "warn", text: gain.text });
    const correction = correctionAdvice(sdr);
    if (correction?.tone === "warn") issues.push({ level: "warn", text: correction.text });
    const auto = autoPpmSummary(sdr);
    if (auto?.tone === "warn") issues.push({ level: "warn", text: auto.text });
    if (gain?.tone === "info") issues.push({ level: "info", text: gain.text });
    const unsaved = unsavedAutoCorrection(sdr);
    if (unsaved !== null) issues.push({ level: "info", text: `auto_ppm correction ${unsaved} ppm isn't saved to the config` });
  }
  const n = ctx.recentProblems ?? 0;
  if (n > 0) issues.push({ level: "warn", text: `${n} error${n === 1 ? "" : "s"}/warning${n === 1 ? "" : "s"} logged for ${instance.name} in the last 15 min` });
  const order: Record<IssueLevel, number> = { critical: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

/** How far the correction is from the suggested one, in whole ppm: orders SDRs within a severity tier. */
export function ppmOff(sdr: SdrHealth): number {
  if (sdr.autoPpm?.active || sdr.correctionUnit !== "ppm" || sdr.suggestedCorrection === null) return 0;
  return Math.round(Math.abs(sdr.suggestedCorrection - (sdr.correction ?? 0)));
}

/**
 * The severity of a list of issues as a tuple compared element by element:
 * critical count, warn count, ppm off, info count. Counts rather than a
 * weighted score, so the order only changes when an SDR gains or loses a
 * finding, not as readings wiggle.
 */
export function severityKey(issues: readonly SdrIssue[], sdr: SdrHealth): [number, number, number, number] {
  const count = (l: IssueLevel) => issues.filter((i) => i.level === l).length;
  return [count("critical"), count("warn"), ppmOff(sdr), count("info")];
}

/** Worst first; equal severity falls back to serial order. */
export function sortSdrsBySeverity<T extends PlacedSdr & { key: readonly number[] }>(sdrs: readonly T[]): T[] {
  return [...sdrs].sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      const d = (b.key[i] ?? 0) - (a.key[i] ?? 0);
      if (d) return d;
    }
    return comparePlaced(a, b);
  });
}
