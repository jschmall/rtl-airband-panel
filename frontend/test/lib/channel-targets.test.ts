import { describe, expect, it } from "vitest";
import type { Device } from "@rtl-airband-panel/parser";
import { buildChannelTargets } from "../../src/lib/channel-targets.js";

function makeMultichannelDevice(overrides: Partial<Device> = {}): Device {
  return {
    type: "rtlsdr",
    serial: "1",
    gain: 29,
    centerfreq: 100_000_000,
    sample_rate: 2_560_000,
    correction: 0,
    channels: [
      { freq: 100_100_000, afc: 0, modulation: "nfm", outputs: [] },
      { freq: 100_200_000, afc: 0, modulation: "nfm", label: "Tower", outputs: [] },
    ],
    ...overrides,
  };
}

function makeScanDevice(overrides: Partial<Device> = {}): Device {
  return {
    type: "rtlsdr",
    serial: "2",
    gain: 29,
    sample_rate: 2_560_000,
    correction: 0,
    mode: "scan",
    channels: [{ freqs: [100_000_000, 101_000_000], outputs: [] }],
    ...overrides,
  };
}

describe("buildChannelTargets", () => {
  it("returns one target per multichannel channel, labeled by frequency and device index", () => {
    const targets = buildChannelTargets([makeMultichannelDevice()]);
    expect(targets).toEqual([
      { deviceIndex: 0, channelIndex: 0, label: "100.1000 MHz (Device 0)" },
      { deviceIndex: 0, channelIndex: 1, label: "100.2000 MHz — Tower (Device 0)" },
    ]);
  });

  it("returns exactly one target for a scan-mode device, at channelIndex 0", () => {
    const targets = buildChannelTargets([makeScanDevice()]);
    expect(targets).toEqual([{ deviceIndex: 0, channelIndex: 0, label: "Scan channel (Device 0 — rtlsdr)" }]);
  });

  it("scopes device indices correctly across a mix of multichannel and scan devices", () => {
    const targets = buildChannelTargets([makeScanDevice(), makeMultichannelDevice()]);
    expect(targets).toEqual([
      { deviceIndex: 0, channelIndex: 0, label: "Scan channel (Device 0 — rtlsdr)" },
      { deviceIndex: 1, channelIndex: 0, label: "100.1000 MHz (Device 1)" },
      { deviceIndex: 1, channelIndex: 1, label: "100.2000 MHz — Tower (Device 1)" },
    ]);
  });

  it("returns an empty list for no devices", () => {
    expect(buildChannelTargets([])).toEqual([]);
  });
});
