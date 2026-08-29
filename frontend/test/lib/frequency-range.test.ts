import { describe, expect, it } from "vitest";
import type { Device } from "@rtl-airband-panel/parser";
import { DEFAULT_SAMPLE_RATE_HZ, SOFT_BW_THRESHOLD } from "@rtl-airband-panel/validate";
import { channelFrequencyRangeHz, deviceUsableWindowHz } from "../../src/lib/frequency-range.js";

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    type: "rtlsdr",
    serial: "1",
    gain: 29,
    centerfreq: 151_780_000,
    sample_rate: 1_400_000,
    correction: 0,
    channels: [],
    ...overrides,
  };
}

describe("channelFrequencyRangeHz", () => {
  it("returns the lowest and highest channel frequency for a multichannel device", () => {
    const device = makeDevice({
      channels: [
        { freq: 151_190_000, afc: 0, modulation: "nfm", outputs: [] },
        { freq: 151_000_000, afc: 0, modulation: "nfm", outputs: [] },
        { freq: 151_500_000, afc: 0, modulation: "nfm", outputs: [] },
      ],
    });
    expect(channelFrequencyRangeHz(device)).toEqual({ min: 151_000_000, max: 151_500_000 });
  });

  it("returns the same value for min and max when there's exactly one channel", () => {
    const device = makeDevice({ channels: [{ freq: 151_190_000, afc: 0, modulation: "nfm", outputs: [] }] });
    expect(channelFrequencyRangeHz(device)).toEqual({ min: 151_190_000, max: 151_190_000 });
  });

  it("returns undefined for a device with no channels", () => {
    expect(channelFrequencyRangeHz(makeDevice({ channels: [] }))).toBeUndefined();
  });

  it("covers every frequency in a scan device's scan list", () => {
    const device = makeDevice({ mode: "scan", channels: [{ freqs: [151_000_000, 151_500_000, 151_250_000], afc: 0, outputs: [] }] });
    expect(channelFrequencyRangeHz(device)).toEqual({ min: 151_000_000, max: 151_500_000 });
  });
});

describe("deviceUsableWindowHz", () => {
  it("mirrors backend/validate's checkFrequencyWindow formula", () => {
    const device = makeDevice({ centerfreq: 151_780_000, sample_rate: 1_400_000 });
    const bwLimit = (1_400_000 / 2) * SOFT_BW_THRESHOLD;
    expect(deviceUsableWindowHz(device)).toEqual({ min: 151_780_000 - bwLimit, max: 151_780_000 + bwLimit });
  });

  it("falls back to DEFAULT_SAMPLE_RATE_HZ when sample_rate isn't set, matching checkFrequencyWindow's own fallback", () => {
    const device = makeDevice({ centerfreq: 151_780_000, sample_rate: undefined });
    const bwLimit = (DEFAULT_SAMPLE_RATE_HZ / 2) * SOFT_BW_THRESHOLD;
    expect(deviceUsableWindowHz(device)).toEqual({ min: 151_780_000 - bwLimit, max: 151_780_000 + bwLimit });
  });

  it("returns undefined for a scan-mode device -- there's no fixed capture window to report", () => {
    const device = makeDevice({ mode: "scan", channels: [{ freqs: [151_000_000], afc: 0, outputs: [] }] });
    expect(deviceUsableWindowHz(device)).toBeUndefined();
  });

  it("returns undefined when centerfreq isn't set yet", () => {
    expect(deviceUsableWindowHz(makeDevice({ centerfreq: undefined }))).toBeUndefined();
  });
});
