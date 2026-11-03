import { describe, expect, it } from "vitest";
import type { InstanceHardware, SdrHealth } from "../api/client.js";
import {
  appendHistory,
  compareSerials,
  correctionAdvice,
  formatSigned,
  formatSpan,
  gainAdvice,
  headroomLevel,
  mergeHistory,
  notLiveReason,
  autoPpmSummary,
  saveCorrectionHref,
  sdrEditorHref,
  flattenSdrs,
  markTransients,
  sdrIssues,
  sdrTitle,
  severityKey,
  sortByInstance,
  sortSdrsBySerial,
  sortSdrsBySeverity,
  TRANSIENT_HOLD_MS,
  unsavedAutoCorrection,
} from "./hardware-format.js";

function sdr(overrides: Partial<SdrHealth> = {}): SdrHealth {
  return {
    index: 0,
    configIndex: 0,
    driver: "rtlsdr",
    serial: null,
    deviceString: null,
    mode: "multichannel",
    state: "running",
    centerFreqHz: 120e6,
    sampleRateHz: 2.56e6,
    tunerBandwidthHz: null,
    gainDb: 33.8,
    gainText: null,
    correction: 0,
    configCorrection: 0,
    correctionUnit: "ppm",
    autoPpmConfigured: null,
    autoPpm: null,
    peakDbfs: -6,
    headroomDb: 6,
    clippedSamples: 0,
    clippedPerSec: null,
    noiseFloorDbfs: -40,
    freqErrorPpm: 1.2,
    freqErrorSamples: 3,
    suggestedCorrection: -1,
    bufferOverflows: 0,
    overflowsPerSec: null,
    outputOverruns: 0,
    retuneFailures: 0,
    channels: [],
    ...overrides,
  };
}

describe("headroomLevel", () => {
  it("grades headroom below clipping", () => {
    expect(headroomLevel(null)).toBeNull();
    expect(headroomLevel(0)).toBe("critical");
    expect(headroomLevel(0.9)).toBe("critical");
    expect(headroomLevel(2.5)).toBe("warning");
    expect(headroomLevel(3)).toBe("good");
  });
});

describe("formatting", () => {
  it("formats spans and signed values", () => {
    expect(formatSpan(2_560_000)).toBe("2.56 MHz");
    expect(formatSpan(240_000)).toBe("240 kHz");
    expect(formatSigned(1.23, "ppm")).toBe("+1.2 ppm");
    expect(formatSigned(-0.04, "ppm")).toBe("-0.0 ppm");
    expect(formatSigned(0.04, "ppm")).toBe("0.0 ppm");
    expect(formatSigned(null, "ppm")).toBe("—");
  });

  it("names an SDR by serial, device string, or index", () => {
    expect(sdrTitle(sdr({ serial: "00000002" }))).toBe("rtlsdr · SN 00000002");
    expect(sdrTitle(sdr({ driver: "soapysdr", deviceString: "driver=airspy" }))).toBe("soapysdr · driver=airspy");
    expect(sdrTitle(sdr({ index: 2 }))).toBe("rtlsdr · device 2");
  });

  it("explains why readings aren't live", () => {
    expect(notLiveReason("unsupported", null)).toMatch(/v6\.4\.0/);
    expect(notLiveReason("unreachable", "ENOENT")).toBe("The control socket didn't answer (ENOENT).");
  });
});

describe("appendHistory", () => {
  it("keeps a rolling window per SDR and drops SDRs that disappear", () => {
    let h = appendHistory(new Map(), 1000, [
      { key: "a/0", sdr: sdr({ headroomDb: 6 }) },
      { key: "b/0", sdr: sdr() },
    ]);
    h = appendHistory(h, 2000, [{ key: "a/0", sdr: sdr({ headroomDb: 5 }) }], 1500);
    expect([...h.keys()]).toEqual(["a/0"]);
    expect(h.get("a/0")!.map((p) => [p.ts, p.headroomDb])).toEqual([
      [1000, 6],
      [2000, 5],
    ]);
    h = appendHistory(h, 3000, [{ key: "a/0", sdr: sdr({ headroomDb: 4 }) }], 1500);
    expect(h.get("a/0")!.map((p) => p.ts)).toEqual([2000, 3000]);
  });

  it("ignores a snapshot that isn't newer than the last point", () => {
    const h = appendHistory(new Map(), 1000, [{ key: "a/0", sdr: sdr() }]);
    const again = appendHistory(h, 1000, [{ key: "a/0", sdr: sdr({ headroomDb: 1 }) }]);
    expect(again.get("a/0")).toHaveLength(1);
  });
});

describe("serial ordering", () => {
  it("puts numeric serials first in numeric order, then the rest alphabetically, then none", () => {
    const serials = ["b2", null, "10", "A10", "00000002", "a9", "9", "", "00000001"];
    expect([...serials].sort(compareSerials)).toEqual(["00000001", "00000002", "9", "10", "a9", "A10", "b2", null, ""]);
  });

  const inst = (name: string, serials: (string | null)[]): InstanceHardware => ({
    name,
    live: true,
    reason: null,
    detail: null,
    version: null,
    devices: serials.map((serial, index) => sdr({ index, serial })),
  });

  it("sorts instances by name, numbers in order, with each instance's SDRs by serial", () => {
    const sorted = sortByInstance([inst("tower", ["blog-v4"]), inst("rtl_10", ["30", "4"]), inst("rtl_9", ["12"]), inst("App", [])]);
    expect(sorted.map((i) => i.name)).toEqual(["App", "rtl_9", "rtl_10", "tower"]);
    expect(sorted[2]!.devices.map((d) => d.serial)).toEqual(["4", "30"]);
  });

  it("lists every SDR by serial across instances", () => {
    const flat = sortSdrsBySerial(flattenSdrs([inst("b", ["30", "blog"]), inst("a", ["4", null]), inst("c", [])]));
    expect(flat.map((p) => `${p.instance.name}:${p.sdr.serial}`)).toEqual(["a:4", "b:30", "b:blog", "a:null"]);
  });
});

describe("severity", () => {
  const live: InstanceHardware = { name: "tower", live: true, reason: null, detail: null, version: null, devices: [] };
  const healthy = (o: Partial<SdrHealth> = {}) => sdr({ suggestedCorrection: 0, freqErrorPpm: 0.2, ...o });
  const ctx = { history: [], now: 1_000_000 };
  const levels = (s: SdrHealth, i = live, c: Parameters<typeof sdrIssues>[2] = ctx) => sdrIssues(i, s, c).map((x) => x.level);

  it("has nothing to say about a healthy SDR", () => {
    expect(sdrIssues(live, healthy(), ctx)).toEqual([]);
  });

  it("calls clipping, dropped samples and a failed input critical", () => {
    expect(levels(healthy({ clippedPerSec: 3 }))).toContain("critical");
    expect(levels(healthy({ overflowsPerSec: 1 }))).toEqual(["critical"]);
    expect(levels(healthy({ state: "failed" }))).toEqual(["critical"]);
  });

  it("keeps clipping and drops flagged for a minute after the last one", () => {
    const s = healthy({ clippedPerSec: 2 });
    const marks = markTransients(new Map(), 1000, [{ key: "k", sdr: s }]);
    const quiet = healthy({ clippedPerSec: 0 });
    const later = markTransients(marks, 20_000, [{ key: "k", sdr: quiet }]);
    expect(sdrIssues(live, quiet, { history: [], now: 20_000, marks: later.get("k") })[0]).toEqual({ level: "critical", text: "Clipped in the last minute" });
    expect(sdrIssues(live, quiet, { history: [], now: 1000 + TRANSIENT_HOLD_MS, marks: later.get("k") })).toEqual([]);
    // SDRs that are gone, or never clipped, aren't tracked.
    expect(markTransients(later, 30_000, []).size).toBe(0);
    expect(markTransients(new Map(), 0, [{ key: "q", sdr: quiet }]).size).toBe(0);
  });

  it("flags a PPM correction to change, a tripped auto_ppm and recent errors as warnings", () => {
    expect(sdrIssues(live, sdr({ correction: 0, suggestedCorrection: 7 }), ctx)).toEqual([{ level: "warn", text: "Set correction to 7 ppm (now 0)" }]);
    const tripped = healthy({ autoPpm: { ...AUTO_PPM, active: false, disabledReason: "error grew" } });
    expect(levels(tripped)).toEqual(["warn"]);
    expect(sdrIssues(live, healthy(), { ...ctx, recentProblems: 3 })).toEqual([
      { level: "warn", text: "3 errors/warnings logged for tower in the last 15 min" },
    ]);
  });

  it("calls a stopped instance critical, but missing live readings only info", () => {
    expect(levels(healthy(), { ...live, live: false, reason: "not-running" })).toEqual(["critical"]);
    expect(levels(healthy(), { ...live, live: false, reason: "no-control-socket" })).toEqual(["info"]);
  });

  it("orders worst first: critical, then warnings, then how far off the PPM is, then serial", () => {
    const placed = (name: string, serial: string, s: SdrHealth) => {
      const p = { instance: { ...live, name }, sdr: { ...s, serial } };
      return { ...p, key: severityKey(sdrIssues(p.instance, p.sdr, ctx), p.sdr) };
    };
    const order = sortSdrsBySeverity([
      placed("ok-b", "2", healthy()),
      placed("ppm3", "5", sdr({ correction: 0, suggestedCorrection: 3 })),
      placed("ok-a", "1", healthy()),
      placed("clip", "9", healthy({ clippedPerSec: 4 })),
      placed("ppm10", "6", sdr({ correction: 0, suggestedCorrection: -10 })),
    ]).map((p) => p.instance.name);
    expect(order).toEqual(["clip", "ppm10", "ppm3", "ok-a", "ok-b"]);
  });

  it("keeps the same key while readings wiggle inside the same band", () => {
    const a = healthy({ headroomDb: 7.2, noiseFloorDbfs: -41 });
    const b = healthy({ headroomDb: 8.9, noiseFloorDbfs: -38 });
    expect(severityKey(sdrIssues(live, a, ctx), a)).toEqual(severityKey(sdrIssues(live, b, ctx), b));
  });
});

describe("correctionAdvice", () => {
  it("names the absolute value to set alongside the current one", () => {
    expect(correctionAdvice(sdr({ correction: 2, freqErrorPpm: -3.4, suggestedCorrection: 5 }))).toEqual({
      tone: "warn",
      text: "Set correction to 5 ppm (now 2)",
    });
  });

  it("confirms once the backend stops suggesting a change", () => {
    expect(correctionAdvice(sdr({ correction: 5, freqErrorPpm: 0.3, suggestedCorrection: null }))?.tone).toBe("ok");
    expect(correctionAdvice(sdr({ correction: null, freqErrorPpm: 0.9, suggestedCorrection: 0 }))?.tone).toBe("ok");
  });

  it("stays quiet without a measurement or for Hz-correction drivers", () => {
    expect(correctionAdvice(sdr({ freqErrorPpm: null }))).toBeNull();
    expect(correctionAdvice(sdr({ correctionUnit: "Hz", suggestedCorrection: null }))).toBeNull();
  });
});

describe("gainAdvice", () => {
  // Three points a minute apart span the two-minute warm-up.
  const hist = (headrooms: (number | null)[], gainDb: number | null = null, stepMs = 60_000) =>
    headrooms.map((headroomDb, i) => ({ ts: i * stepMs, headroomDb, noiseFloorDbfs: null, freqErrorPpm: null, gainDb }));

  it("lowers to the tuner step that puts the worst recent peak about 6 dB down", () => {
    // worst headroom 0.4 dB at 49.6 dB gain -> target 49.6 - 5.6 = 44.0 -> step 43.9
    expect(gainAdvice(sdr({ gainDb: 49.6, headroomDb: 8 }), hist([9, 0.4, 8], 49.6))).toEqual({
      tone: "warn",
      text: "Lower gain to 43.9 dB (now 49.6 dB)",
    });
  });

  it("lowers at least one step at once whenever samples are clipping", () => {
    expect(gainAdvice(sdr({ gainDb: 33.8, headroomDb: 7, clippedPerSec: 3 }), hist([7], 33.8))?.text).toBe(
      "Lower gain to 32.8 dB (now 33.8 dB)"
    );
    expect(gainAdvice(sdr({ gainDb: 0, headroomDb: 0.1, clippedPerSec: 1 }), hist([0.1], 0))?.text).toMatch(/minimum gain/);
  });

  it("waits for two minutes of readings before calling low headroom without clipping", () => {
    expect(gainAdvice(sdr({ gainDb: 49.6, headroomDb: 0.4 }), hist([0.4], 49.6))).toEqual({ tone: "pending", text: "Collecting readings…" });
    expect(gainAdvice(sdr({ gainDb: 49.6, headroomDb: 8 }), hist([9, 0.4, 8], 49.6, 30_000))?.tone).toBe("pending");
  });

  it("rounds down to whole dB off the R820T table", () => {
    expect(gainAdvice(sdr({ driver: "soapysdr", gainDb: 30, headroomDb: 1.5 }), hist([1.5, 1.5, 1.5], 30))?.text).toBe(
      "Lower gain to 25 dB (now 30 dB)"
    );
  });

  it("suggests raising only after two quiet minutes, as an optional step", () => {
    const quiet = sdr({ gainDb: 12.5, headroomDb: 31 });
    expect(gainAdvice(quiet, hist([31, 31, 31], 12.5, 30_000))).toEqual({ tone: "pending", text: "Collecting readings…" });
    // 12.5 + (25 - 6) = 31.5 -> 29.7
    expect(gainAdvice(quiet, hist([31, 25, 31], 12.5))).toEqual({
      tone: "info",
      text: "Room to raise gain to 29.7 dB (now 12.5 dB)",
    });
  });

  it("ignores readings from before a live gain change", () => {
    const before = hist([0.2, 0.3], 49.6);
    const after = hist([9, 8, 8], 43.9).map((p) => ({ ...p, ts: p.ts + 120_000 }));
    expect(gainAdvice(sdr({ gainDb: 43.9, headroomDb: 8 }), [...before, ...after])).toEqual({ tone: "ok", text: "Gain OK" });
    expect(gainAdvice(sdr({ gainDb: 43.9, headroomDb: 8 }), [...before, ...after.slice(1)])?.tone).toBe("pending");
  });

  it("leaves a gain in the ideal band alone", () => {
    expect(gainAdvice(sdr({ gainDb: 33.8, headroomDb: 9.5 }), hist([9.5, 6, 11, 9, 9], 33.8))).toEqual({ tone: "ok", text: "Gain OK" });
  });

  it("asks for manual gain only when automatic gain clips", () => {
    expect(gainAdvice(sdr({ gainDb: null, headroomDb: 0.5 }), hist([0.5, 0.5, 0.5], null))?.text).toMatch(/manual gain/);
    expect(gainAdvice(sdr({ gainDb: null, headroomDb: 0.5 }), hist([0.5], null))).toBeNull();
    expect(gainAdvice(sdr({ gainDb: null, headroomDb: 9 }), hist([9], null))).toBeNull();
    expect(gainAdvice(sdr({ headroomDb: null }), [])).toBeNull();
  });
});

describe("mergeHistory", () => {
  const point = (ts: number, headroomDb: number) => ({ ts, headroomDb, noiseFloorDbfs: null, freqErrorPpm: null, gainDb: 30 });

  it("unions recorded and live points by timestamp, oldest first, inside the window", () => {
    const live = new Map([["a/0", [point(5000, 9)]]]);
    const merged = mergeHistory(live, { sdrs: [{ instance: "a", index: 0, points: [point(500, 1), point(2000, 2), point(5000, 9)] }] }, 6000, 5000);
    expect(merged.get("a/0")).toEqual([point(2000, 2), point(5000, 9)]);
  });

  it("adds recorded SDRs and keeps live-only ones", () => {
    const live = new Map([["b/1", [point(5000, 9)]]]);
    const merged = mergeHistory(live, { sdrs: [{ instance: "a", index: 0, points: [point(4000, 3)] }] }, 6000, 5000);
    expect(merged.get("a/0")).toEqual([point(4000, 3)]);
    expect(merged.get("b/1")).toEqual([point(5000, 9)]);
  });
});

describe("sdrEditorHref", () => {
  it("opens the editor at the device's position in the config, not its running index", () => {
    // A disabled device before it shifts rtl_airband's index but not the config's.
    expect(sdrEditorHref("tower 1", sdr({ index: 0, configIndex: 1 }))).toBe("/instances/tower%201?device=1");
  });
});

const AUTO_PPM = {
  enabled: true,
  active: true,
  disabledReason: null,
  residualPpm: 0.31,
  eligible: 3,
  contributing: 2,
  rejected: 0,
  clamped: false,
  reason: "within deadband",
  adjustments: 4,
  lastAdjustAgeS: 40,
  baseCorrection: 1,
  maxPpm: 100,
  maxStep: 5,
  intervalS: 30,
};

describe("auto_ppm on the Hardware page", () => {
  it("replaces the correction advice while active", () => {
    const a = sdr({ autoPpm: AUTO_PPM, suggestedCorrection: null });
    expect(correctionAdvice(a)).toEqual({ tone: "ok", text: "auto_ppm active (residual +0.31 ppm)" });
    expect(correctionAdvice(sdr({ autoPpm: { ...AUTO_PPM, residualPpm: null } }))?.tone).toBe("pending");
    // Tripped: the usual advice is back.
    const tripped = sdr({ autoPpm: { ...AUTO_PPM, active: false, disabledReason: "error grew" }, correction: 2, suggestedCorrection: 5 });
    expect(correctionAdvice(tripped)?.text).toBe("Set correction to 5 ppm (now 2)");
  });

  it("offers to save the live correction only when it differs from the config", () => {
    expect(unsavedAutoCorrection(sdr({ autoPpm: AUTO_PPM, correction: 4, configCorrection: 1 }))).toBe(4);
    expect(unsavedAutoCorrection(sdr({ autoPpm: AUTO_PPM, correction: 1, configCorrection: 1 }))).toBeNull();
    expect(unsavedAutoCorrection(sdr({ autoPpm: AUTO_PPM, correction: 0, configCorrection: null }))).toBeNull();
    expect(unsavedAutoCorrection(sdr({ autoPpm: null, correction: 4, configCorrection: 1 }))).toBeNull();
    const s = sdr({ configIndex: 2, autoPpm: AUTO_PPM, correction: -3 });
    expect(saveCorrectionHref("tower", s, -3)).toBe("/instances/tower?device=2&correction=-3");
  });

  it("summarises its state", () => {
    expect(autoPpmSummary(sdr())).toBeNull();
    expect(autoPpmSummary(sdr({ autoPpm: AUTO_PPM }))).toEqual({ tone: "ok", text: "auto_ppm on · within deadband" });
    expect(autoPpmSummary(sdr({ autoPpm: { ...AUTO_PPM, enabled: false, active: false } }))?.text).toBe("auto_ppm off");
    expect(autoPpmSummary(sdr({ autoPpm: { ...AUTO_PPM, active: false, disabledReason: "error grew after 2 consecutive adjustments" } }))).toMatchObject({
      tone: "warn",
    });
  });
});
