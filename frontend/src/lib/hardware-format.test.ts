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
  notLiveReason,
  sdrTitle,
  sortBySerial,
} from "./hardware-format.js";

function sdr(overrides: Partial<SdrHealth> = {}): SdrHealth {
  return {
    index: 0,
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
    correctionUnit: "ppm",
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

  it("orders instances by their first SDR's serial and sorts SDRs within each", () => {
    const inst = (name: string, serials: (string | null)[]): InstanceHardware => ({
      name,
      live: true,
      reason: null,
      detail: null,
      version: null,
      devices: serials.map((serial, index) => sdr({ index, serial })),
    });
    const sorted = sortBySerial([inst("empty", []), inst("tower", ["blog-v4"]), inst("ops", ["30", "4"]), inst("app", ["12"])]);
    expect(sorted.map((i) => i.name)).toEqual(["ops", "app", "tower", "empty"]);
    expect(sorted[0]!.devices.map((d) => d.serial)).toEqual(["4", "30"]);
  });
});

describe("correctionAdvice", () => {
  it("names the absolute value to set alongside the current one", () => {
    expect(correctionAdvice(sdr({ correction: 2, freqErrorPpm: -3.4, suggestedCorrection: 5 }))).toEqual({
      tone: "action",
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
  const hist = (headrooms: (number | null)[], gainDb: number | null = null, stepMs = 30_000) =>
    headrooms.map((headroomDb, i) => ({ ts: i * stepMs, headroomDb, noiseFloorDbfs: null, freqErrorPpm: null, gainDb }));

  it("lowers to the tuner step that puts the worst recent peak about 6 dB down", () => {
    // worst headroom 0.4 dB at 49.6 dB gain -> target 49.6 - 5.6 = 44.0 -> step 43.9
    expect(gainAdvice(sdr({ gainDb: 49.6, headroomDb: 8 }), hist([9, 0.4, 8], 49.6))).toEqual({
      tone: "action",
      text: "Lower gain to 43.9 dB (now 49.6 dB)",
    });
  });

  it("lowers at least one step whenever samples are clipping", () => {
    expect(gainAdvice(sdr({ gainDb: 33.8, headroomDb: 7, clippedPerSec: 3 }), hist([7], 33.8))?.text).toBe(
      "Lower gain to 32.8 dB (now 33.8 dB)"
    );
    expect(gainAdvice(sdr({ gainDb: 0, headroomDb: 0.1 }), hist([0.1], 0))?.text).toMatch(/minimum gain/);
  });

  it("rounds down to whole dB off the R820T table", () => {
    expect(gainAdvice(sdr({ driver: "soapysdr", gainDb: 30, headroomDb: 1.5 }), hist([1.5], 30))?.text).toBe(
      "Lower gain to 25 dB (now 30 dB)"
    );
  });

  it("suggests raising only after two quiet minutes", () => {
    const quiet = sdr({ gainDb: 12.5, headroomDb: 31 });
    expect(gainAdvice(quiet, hist([31, 31, 31], 12.5))).toEqual({ tone: "ok", text: "Gain OK so far" });
    // 12.5 + (25 - 6) = 31.5 -> 29.7
    expect(gainAdvice(quiet, hist([31, 25, 31, 31, 31], 12.5))).toEqual({
      tone: "action",
      text: "Room to raise gain to 29.7 dB (now 12.5 dB)",
    });
  });

  it("ignores readings from before a live gain change", () => {
    const before = hist([0.2, 0.3], 49.6);
    const after = hist([9, 8], 43.9).map((p) => ({ ...p, ts: p.ts + 60_000 }));
    expect(gainAdvice(sdr({ gainDb: 43.9, headroomDb: 8 }), [...before, ...after])).toEqual({ tone: "ok", text: "Gain OK" });
  });

  it("leaves a gain in the ideal band alone", () => {
    expect(gainAdvice(sdr({ gainDb: 33.8, headroomDb: 9.5 }), hist([9.5, 6, 11, 9, 9], 33.8))).toEqual({ tone: "ok", text: "Gain OK" });
  });

  it("asks for manual gain only when automatic gain clips", () => {
    expect(gainAdvice(sdr({ gainDb: null, headroomDb: 0.5 }), hist([0.5], null))?.text).toMatch(/manual gain/);
    expect(gainAdvice(sdr({ gainDb: null, headroomDb: 9 }), hist([9], null))).toBeNull();
    expect(gainAdvice(sdr({ headroomDb: null }), [])).toBeNull();
  });
});
