import { describe, expect, it } from "vitest";
import type { SdrHealth } from "../api/client.js";
import { appendHistory, formatSigned, formatSpan, headroomLevel, notLiveReason, sdrTitle } from "./hardware-format.js";

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
