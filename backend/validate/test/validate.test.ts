import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigFile } from "@rtl-airband-panel/parser";
import type { Channel, Device, RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { checkBinCollisions, checkCtcssTones, checkFrequencyWindow, computeBin, validateConfig } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "../../../fixtures/151719.conf");
const fixtureSource = readFileSync(fixturePath, "utf8");

function makeChannel(freq: number, overrides: Partial<Channel> = {}): Channel {
  return {
    freq,
    afc: 0,
    modulation: "nfm",
    outputs: [
      {
        type: "pulse",
        server: "10.0.0.1",
        sink: "sink",
        stream_name: "sink",
        continuous: false,
      },
    ],
    ...overrides,
  };
}

function makeDevice(channels: Channel[], overrides: Partial<Device> = {}): Device {
  return {
    type: "rtlsdr",
    serial: "1",
    gain: 29,
    centerfreq: 100_000_000,
    sample_rate: 512_000,
    correction: 0,
    channels,
    ...overrides,
  };
}

function makeConfig(devices: Device[], overrides: Partial<RtlAirbandConfig> = {}): RtlAirbandConfig {
  return {
    multiple_demod_threads: true,
    multiple_output_threads: true,
    stats_filepath: "/tmp/stats.txt",
    localtime: true,
    devices,
    ...overrides,
  };
}

describe("validateConfig against the real fixture", () => {
  it("produces no errors or warnings for a known-good config", () => {
    const config = parseConfigFile(fixtureSource);
    const result = validateConfig(config);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("checkFrequencyWindow", () => {
  it("does not flag a channel comfortably inside the device's bandwidth", () => {
    const device = makeDevice([makeChannel(100_000_000)]); // dead center
    const issues = checkFrequencyWindow(makeConfig([device]));
    expect(issues).toEqual([]);
  });

  it("falls back to RTLSDR-Airband's own default sample_rate when a device omits it", () => {
    const { sample_rate: _omitted, ...deviceWithoutSampleRate } = makeDevice([makeChannel(100_000_000)]);
    // default sample_rate is 2,560,000 Hz -> bw_limit = 1,152,000 Hz; well within window
    const issues = checkFrequencyWindow(makeConfig([deviceWithoutSampleRate]));
    expect(issues).toEqual([]);
  });

  it("warns (not errors) when a channel sits outside the 0.9 * sample_rate/2 soft window", () => {
    // sample_rate 512kHz -> bw_limit = 512000/2*0.9 = 230400 Hz
    const device = makeDevice([makeChannel(100_000_000 + 300_000)]);
    const issues = checkFrequencyWindow(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "frequency-out-of-window" });
  });
});

describe("checkBinCollisions", () => {
  // sample_rate 512000, default fft_size 512 -> bin width = 1000 Hz exactly.
  const centerfreq = 100_000_000;

  it("does not flag two channels sharing an identical frequency (multi-CTCSS pattern)", () => {
    const device = makeDevice([
      makeChannel(centerfreq + 500, { ctcss: 103.5 }),
      makeChannel(centerfreq + 500, { ctcss: 192.8 }),
    ]);
    const issues = checkBinCollisions(makeConfig([device]));
    expect(issues).toEqual([]);
  });

  it("errors when two distinct frequencies quantize to the same bin", () => {
    const device = makeDevice([makeChannel(centerfreq + 500), makeChannel(centerfreq + 600)]);
    const issues = checkBinCollisions(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "fft-bin-collision", path: "$.devices[0].channels[1]" });
  });

  it("does not flag distinct frequencies that land in different bins", () => {
    const device = makeDevice([makeChannel(centerfreq + 500), makeChannel(centerfreq + 1600)]);
    const issues = checkBinCollisions(makeConfig([device]));
    expect(issues).toEqual([]);
  });

  it("honors a configured fft_size when computing bin width", () => {
    // With fft_size=512 (bin width 1000Hz) these land in different bins;
    // with fft_size=128 (bin width 4000Hz) they land in the same bin.
    const device = makeDevice([makeChannel(centerfreq + 2000), makeChannel(centerfreq + 2500)]);
    const config = makeConfig([device], { fft_size: 128 });
    expect(checkBinCollisions(config)).toHaveLength(1);
    expect(checkBinCollisions(makeConfig([device]))).toEqual([]);
  });

  it("computeBin advances by exactly one bin per bin-width step", () => {
    const bin = computeBin(centerfreq + 500, centerfreq, 512_000, 512);
    const nextBin = computeBin(centerfreq + 500 + 1000, centerfreq, 512_000, 512);
    expect(nextBin).toBe((bin + 1) % 512);
  });
});

describe("checkCtcssTones", () => {
  it("does not flag an exact standard tone", () => {
    const device = makeDevice([makeChannel(100_000_000, { ctcss: 103.5 })]);
    expect(checkCtcssTones(makeConfig([device]))).toEqual([]);
  });

  it("does not flag a deliberately non-standard tone far from any standard value", () => {
    const device = makeDevice([makeChannel(100_000_000, { ctcss: 1000 })]);
    expect(checkCtcssTones(makeConfig([device]))).toEqual([]);
  });

  it("warns on a near-miss of a standard tone (likely typo)", () => {
    const device = makeDevice([makeChannel(100_000_000, { ctcss: 103.4 })]);
    const issues = checkCtcssTones(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "ctcss-near-standard-tone" });
  });

  it("warns on a non-positive ctcss value", () => {
    const device = makeDevice([makeChannel(100_000_000, { ctcss: -5 })]);
    const issues = checkCtcssTones(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "ctcss-non-positive" });
  });

  it("does not flag a channel with no ctcss configured", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    expect(checkCtcssTones(makeConfig([device]))).toEqual([]);
  });
});

describe("validateConfig", () => {
  it("aggregates errors and warnings from all checks", () => {
    const device = makeDevice([
      makeChannel(100_000_000 + 500),
      makeChannel(100_000_000 + 600), // bin collision with the above -> error
      makeChannel(100_000_000 + 300_000, { ctcss: 103.4 }), // out of window warning + ctcss near-miss warning
    ]);
    const result = validateConfig(makeConfig([device]));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("fft-bin-collision");
    expect(result.warnings.map((w) => w.code).sort()).toEqual(["ctcss-near-standard-tone", "frequency-out-of-window"]);
  });
});
