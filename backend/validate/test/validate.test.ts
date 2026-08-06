import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigFile } from "@rtl-airband-panel/parser";
import type { Channel, Device, Mixer, RtlAirbandConfig, ScanChannel } from "@rtl-airband-panel/parser";
import {
  checkAmpfactor,
  checkBinCollisions,
  checkControlSocketPath,
  checkCtcssTones,
  checkDeviceRequirements,
  checkDisableCascade,
  checkEnabledDisableRedundant,
  checkFftSize,
  checkFileOutputFlags,
  checkFilterCutoffs,
  checkFrequencyWindow,
  checkMixerNestedOutputs,
  checkMixerOutputBalance,
  checkMixerReferences,
  checkMixerReserveInputs,
  checkMixerUnused,
  checkModulation,
  checkNotchQ,
  checkPostWriteScript,
  checkRdioScanner,
  checkScanMode,
  checkShoutMetadataDelay,
  checkSquelchMutualExclusion,
  checkSquelchSnrThreshold,
  checkSquelchThreshold,
  checkStatsHttp,
  checkUdpStreamSampleRate,
  computeBin,
  validateConfig,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "../../../fixtures/151719.conf");
const fixtureSource = readFileSync(fixturePath, "utf8");
const forkFeaturesFixturePath = path.join(here, "../../../fixtures/fork-features.conf");
const forkFeaturesFixtureSource = readFileSync(forkFeaturesFixturePath, "utf8");

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
  it("produces no errors for a known-good config", () => {
    const config = parseConfigFile(fixtureSource);
    const result = validateConfig(config);
    expect(result.errors).toEqual([]);
  });

  it("warns about post_write_script on every file output that sets one, and nothing else", () => {
    const config = parseConfigFile(fixtureSource);
    const result = validateConfig(config);
    const postWriteScriptCount = (fixtureSource.match(/post_write_script\s*=/g) ?? []).length;
    expect(result.warnings.every((w) => w.code === "post-write-script-runs-arbitrary-command")).toBe(true);
    expect(result.warnings).toHaveLength(postWriteScriptCount);
  });
});

describe("validateConfig against the fork-features fixture", () => {
  it("produces no errors for a known-good config exercising rdio_scanner, bit_depth, sample_rate, mixers, and the stats_http_*/rdio_scanner_queue_depth globals", () => {
    const config = parseConfigFile(forkFeaturesFixtureSource);
    const result = validateConfig(config);
    expect(result.errors).toEqual([]);
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
    // The device's default sample_rate (512,000, used for this test's bin-collision/
    // out-of-window math below) also happens to sit in librtlsdr's dead zone -- a
    // second, genuinely independent error, not a false positive from this change.
    expect(result.errors.map((e) => e.code).sort()).toEqual(["device-sample-rate-unsupported", "fft-bin-collision"]);
    expect(result.warnings.map((w) => w.code).sort()).toEqual(["ctcss-near-standard-tone", "frequency-out-of-window"]);
  });
});

function makeScanChannel(freqs: number[], overrides: Partial<ScanChannel> = {}): ScanChannel {
  return {
    freqs,
    outputs: [{ type: "pulse" }],
    ...overrides,
  };
}

describe("checkCtcssTones with scan-mode list values", () => {
  it("does not flag a documented 0.0 per-frequency disable sentinel inside a list", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000], { ctcss: [103.5, 0.0] })], {
      mode: "scan",
      centerfreq: undefined,
    });
    expect(checkCtcssTones(makeConfig([device]))).toEqual([]);
  });

  it("still flags a negative value inside a list (not a documented sentinel)", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000], { ctcss: [103.5, -5] })], {
      mode: "scan",
      centerfreq: undefined,
    });
    const issues = checkCtcssTones(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "ctcss-non-positive", path: expect.stringContaining("ctcss[1]") });
  });

  it("flags a near-miss standard tone inside a list", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000], { ctcss: [103.4, 0.0] })], {
      mode: "scan",
      centerfreq: undefined,
    });
    const issues = checkCtcssTones(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "ctcss-near-standard-tone" });
  });
});

describe("checkScanMode", () => {
  it("does not flag a well-formed scan-mode device", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000])], { mode: "scan", centerfreq: undefined });
    expect(checkScanMode(makeConfig([device]))).toEqual([]);
  });

  it("errors when a scan-mode device has more than one channel", () => {
    const device = makeDevice(
      [makeScanChannel([100_000_000]), makeScanChannel([101_000_000])],
      { mode: "scan", centerfreq: undefined }
    );
    const issues = checkScanMode(makeConfig([device]));
    expect(issues.some((i) => i.code === "scan-mode-single-channel")).toBe(true);
  });

  it("errors when a scan-mode device's channel uses freq instead of freqs", () => {
    const device = makeDevice([makeChannel(100_000_000)], { mode: "scan", centerfreq: undefined });
    const issues = checkScanMode(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "scan-mode-channel-shape-mismatch" });
  });

  it("errors when a non-scan device has a freqs-shaped channel", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000])]);
    const issues = checkScanMode(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "scan-mode-channel-shape-mismatch" });
  });

  it("errors when a per-frequency list is shorter than freqs", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000, 102_000_000], { squelch_threshold: [-30, -25] })], {
      mode: "scan",
      centerfreq: undefined,
    });
    const issues = checkScanMode(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "scan-list-too-short", path: expect.stringContaining("squelch_threshold") });
  });

  it("warns (not errors) when a per-frequency list is longer than freqs", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000], { squelch_threshold: [-30, -25, -20] })], {
      mode: "scan",
      centerfreq: undefined,
    });
    const issues = checkScanMode(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "scan-list-too-long" });
  });

  it("errors when freqs is an empty list", () => {
    const device = makeDevice([makeScanChannel([])], { mode: "scan", centerfreq: undefined });
    const issues = checkScanMode(makeConfig([device]));
    expect(issues.some((i) => i.code === "scan-freqs-empty")).toBe(true);
  });
});

describe("checkDeviceRequirements", () => {
  it("errors when a non-soapysdr device omits gain", () => {
    // sample_rate outside the dead zone -- this test is about gain, not sample_rate.
    const device = makeDevice([makeChannel(100_000_000)], { sample_rate: 1_400_000 });
    delete (device as Partial<Device>).gain;
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "device-gain-required" });
  });

  it("does not require gain on a soapysdr device (AGC when omitted)", () => {
    const device = makeDevice([makeChannel(100_000_000)], { type: "soapysdr", device_string: "driver=rtlsdr" });
    delete (device as Partial<Device>).gain;
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues).toEqual([]);
  });

  it("errors when a soapysdr device omits device_string", () => {
    const device = makeDevice([makeChannel(100_000_000)], { type: "soapysdr" });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-string-required")).toBe(true);
  });

  it("errors when a multichannel-mode device omits centerfreq", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    delete (device as Partial<Device>).centerfreq;
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-centerfreq-required")).toBe(true);
  });

  it("does not require centerfreq on a scan-mode device", () => {
    // sample_rate outside the dead zone -- this test is about centerfreq, not sample_rate.
    const device = makeDevice([makeScanChannel([100_000_000])], { mode: "scan", centerfreq: undefined, sample_rate: 1_400_000 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues).toEqual([]);
  });

  it("errors on an unsupported device type", () => {
    const device = makeDevice([makeChannel(100_000_000)], { type: "hackrf" });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-type-unsupported")).toBe(true);
  });

  it("does not flag any of the three known device types", () => {
    for (const type of ["rtlsdr", "mirisdr", "soapysdr"]) {
      const device = makeDevice([makeChannel(100_000_000)], type === "soapysdr" ? { type, device_string: "driver=rtlsdr" } : { type });
      const issues = checkDeviceRequirements(makeConfig([device]));
      expect(issues.some((i) => i.code === "device-type-unsupported")).toBe(false);
    }
  });

  it("errors when sample_rate is at or below RTLSDR-Airband's floor", () => {
    const device = makeDevice([makeChannel(100_000_000)], { sample_rate: 16_000 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-sample-rate-too-low")).toBe(true);
  });

  it("does not flag a sample_rate comfortably above the floor", () => {
    const device = makeDevice([makeChannel(100_000_000)], { sample_rate: 1_400_000 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-sample-rate-too-low")).toBe(false);
  });

  it("does not flag a device that omits sample_rate (falls back to the documented default)", () => {
    const { sample_rate: _omitted, ...deviceWithoutSampleRate } = makeDevice([makeChannel(100_000_000)]);
    const issues = checkDeviceRequirements(makeConfig([deviceWithoutSampleRate]));
    expect(issues.some((i) => i.code === "device-sample-rate-too-low")).toBe(false);
  });

  it("errors when an rtlsdr sample_rate falls inside librtlsdr's dead zone", () => {
    const device = makeDevice([makeChannel(100_000_000)], { sample_rate: 500_000 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-sample-rate-unsupported")).toBe(true);
  });

  it("does not flag the same dead-zone sample_rate on mirisdr or soapysdr (no documented range for those)", () => {
    for (const overrides of [{ type: "mirisdr" as const, sample_rate: 500_000 }, { type: "soapysdr" as const, sample_rate: 500_000, device_string: "driver=rtlsdr" }]) {
      const device = makeDevice([makeChannel(100_000_000)], overrides);
      const issues = checkDeviceRequirements(makeConfig([device]));
      expect(issues.some((i) => i.code === "device-sample-rate-unsupported")).toBe(false);
    }
  });

  it("does not flag a curated common rtlsdr sample_rate", () => {
    const device = makeDevice([makeChannel(100_000_000)], { sample_rate: 2_048_000 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-sample-rate-unsupported")).toBe(false);
  });

  it("errors when an rtlsdr device has neither serial nor index", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    delete (device as Partial<Device>).serial;
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-serial-or-index-required")).toBe(true);
  });

  it("does not require serial when index is given instead", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    delete (device as Partial<Device>).serial;
    device.index = 0;
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-serial-or-index-required")).toBe(false);
  });

  it("does not require serial/index on a soapysdr device", () => {
    const device = makeDevice([makeChannel(100_000_000)], { type: "soapysdr", device_string: "driver=rtlsdr" });
    delete (device as Partial<Device>).serial;
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-serial-or-index-required")).toBe(false);
  });

  it("errors when rtlsdr buffers is not greater than 0", () => {
    const device = makeDevice([makeChannel(100_000_000)], { buffers: 0 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-buffers-invalid")).toBe(true);
  });

  it("errors when mirisdr num_buffers is not greater than 0", () => {
    const device = makeDevice([makeChannel(100_000_000)], { type: "mirisdr", num_buffers: -1 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-num-buffers-invalid")).toBe(true);
  });

  it("errors when reserve_channels is negative", () => {
    const device = makeDevice([makeChannel(100_000_000)], { reserve_channels: -1 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-reserve-channels-negative")).toBe(true);
  });

  it("does not flag a non-negative reserve_channels on a multichannel device", () => {
    const device = makeDevice([makeChannel(100_000_000)], { reserve_channels: 4 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-reserve-channels-negative" || i.code === "device-reserve-channels-scan-unsupported")).toBe(false);
  });

  it("errors when a scan-mode device has a non-zero reserve_channels", () => {
    const device = makeDevice([makeScanChannel([100_000_000])], { mode: "scan", centerfreq: undefined, sample_rate: 1_400_000, reserve_channels: 2 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-reserve-channels-scan-unsupported")).toBe(true);
  });

  it("does not flag a scan-mode device with reserve_channels explicitly 0", () => {
    const device = makeDevice([makeScanChannel([100_000_000])], { mode: "scan", centerfreq: undefined, sample_rate: 1_400_000, reserve_channels: 0 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-reserve-channels-scan-unsupported")).toBe(false);
  });

  it("errors when an rtlsdr device's bandwidth is negative", () => {
    const device = makeDevice([makeChannel(100_000_000)], { type: "rtlsdr", bandwidth: -1 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-bandwidth-negative")).toBe(true);
  });

  it("does not flag a non-negative bandwidth (0 = automatic) on an rtlsdr device", () => {
    const device = makeDevice([makeChannel(100_000_000)], { type: "rtlsdr", bandwidth: 0 });
    const issues = checkDeviceRequirements(makeConfig([device]));
    expect(issues.some((i) => i.code === "device-bandwidth-negative")).toBe(false);
  });
});

describe("checkMixerReferences", () => {
  const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }] };

  it("does not flag an output that references a defined mixer", () => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "mixer", name: "mix1" }] })]);
    const config = makeConfig([device], { mixers: [mixer] });
    expect(checkMixerReferences(config)).toEqual([]);
  });

  it("errors when an output references an undefined mixer", () => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "mixer", name: "no-such-mixer" }] })]);
    const issues = checkMixerReferences(makeConfig([device], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "mixer-reference-not-found" });
  });

  it("errors when there are no mixers defined at all", () => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "mixer", name: "mix1" }] })]);
    const issues = checkMixerReferences(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("mixer-reference-not-found");
  });
});

describe("checkMixerUnused", () => {
  it("does not flag a mixer with an inbound channel output", () => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "mixer", name: "mix1" }] })]);
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }] };
    expect(checkMixerUnused(makeConfig([device], { mixers: [mixer] }))).toEqual([]);
  });

  it("errors when a mixer has zero inbound channel outputs", () => {
    const device = makeDevice([makeChannel(100_000_000)]); // plain, non-mixer output
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }] };
    const issues = checkMixerUnused(makeConfig([device], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "mixer-unused", path: "$.mixers[0]" });
  });

  it("does not flag anything when mixers is undefined", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    expect(checkMixerUnused(makeConfig([device]))).toEqual([]);
  });

  it("does not flag anything when mixers is an empty array", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    expect(checkMixerUnused(makeConfig([device], { mixers: [] }))).toEqual([]);
  });

  it("does not flag a disabled, unreferenced mixer", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }], disable: true };
    expect(checkMixerUnused(makeConfig([device], { mixers: [mixer] }))).toEqual([]);
  });

  it("does not double-report a mixer that is both unreferenced and has all-disabled outputs (checkDisableCascade already covers it)", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse", disable: true }] };
    const config = makeConfig([device], { mixers: [mixer] });
    expect(checkMixerUnused(config)).toEqual([]);
    const cascadeIssues = checkDisableCascade(config);
    expect(cascadeIssues).toHaveLength(1);
    expect(cascadeIssues[0]).toMatchObject({ code: "no-active-mixer-outputs", path: "$.mixers[0]" });
  });

  it("scopes the reference lookup across all devices, not just the first", () => {
    const referenced = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "mixer", name: "mix2" }] })]);
    const unreferenced = makeDevice([makeChannel(101_000_000)]);
    const mixers: Mixer[] = [
      { name: "mix1", outputs: [{ type: "pulse" }] },
      { name: "mix2", outputs: [{ type: "pulse" }] },
    ];
    const issues = checkMixerUnused(makeConfig([unreferenced, referenced], { mixers }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "mixer-unused", path: "$.mixers[0]" });
  });

  it("still counts a reference coming from a disabled channel/device", () => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "mixer", name: "mix1" }] })], { disable: true });
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }] };
    expect(checkMixerUnused(makeConfig([device], { mixers: [mixer] }))).toEqual([]);
  });
});

describe("checkRdioScanner", () => {
  const rdioScanner = { server: "rdio.example.com", port: 443, api_key: "secret", talkgroup_id: 1 };

  it("does not flag a file output with rdio_scanner and split_on_transmission set", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [{ type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true, rdio_scanner: rdioScanner }],
      }),
    ]);
    expect(checkRdioScanner(makeConfig([device]))).toEqual([]);
  });

  it("does not flag a file output with no rdio_scanner configured at all", () => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "file", directory: "/tmp", filename_template: "x" }] })]);
    expect(checkRdioScanner(makeConfig([device]))).toEqual([]);
  });

  it("errors when rdio_scanner is set without split_on_transmission", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [{ type: "file", directory: "/tmp", filename_template: "x", rdio_scanner: rdioScanner }],
      }),
    ]);
    const issues = checkRdioScanner(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "rdio-scanner-requires-split-on-transmission" });
  });

  it("does not flag a disabled rdio_scanner block even without split_on_transmission", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [{ type: "file", directory: "/tmp", filename_template: "x", rdio_scanner: { ...rdioScanner, disable: true } }],
      }),
    ]);
    expect(checkRdioScanner(makeConfig([device]))).toEqual([]);
  });

  it("also checks outputs on top-level mixers", () => {
    const mixer: Mixer = {
      name: "mix1",
      outputs: [{ type: "file", directory: "/tmp", filename_template: "x", rdio_scanner: rdioScanner }],
    };
    const issues = checkRdioScanner(makeConfig([], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "rdio-scanner-requires-split-on-transmission", path: "$.mixers[0].outputs[0]" });
  });

  it("errors when timeout_ms is 0", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [
          { type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true, rdio_scanner: { ...rdioScanner, timeout_ms: 0 } },
        ],
      }),
    ]);
    const issues = checkRdioScanner(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "rdio-scanner-invalid-timeout" });
  });

  it("errors when timeout_ms is negative", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [
          { type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true, rdio_scanner: { ...rdioScanner, timeout_ms: -1 } },
        ],
      }),
    ]);
    expect(checkRdioScanner(makeConfig([device]))[0]).toMatchObject({ code: "rdio-scanner-invalid-timeout" });
  });

  it("does not flag a positive timeout_ms", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [
          { type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true, rdio_scanner: { ...rdioScanner, timeout_ms: 5000 } },
        ],
      }),
    ]);
    expect(checkRdioScanner(makeConfig([device]))).toEqual([]);
  });

  it("errors when max_retries is negative", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [
          { type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true, rdio_scanner: { ...rdioScanner, max_retries: -1 } },
        ],
      }),
    ]);
    const issues = checkRdioScanner(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "rdio-scanner-invalid-max-retries" });
  });

  it("does not flag max_retries of 0", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [
          { type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true, rdio_scanner: { ...rdioScanner, max_retries: 0 } },
        ],
      }),
    ]);
    expect(checkRdioScanner(makeConfig([device]))).toEqual([]);
  });

  it("errors when rdio_scanner is set on a scan-mode device's channel", () => {
    const scanChannel: ScanChannel = {
      freqs: [100_000_000],
      outputs: [{ type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true, rdio_scanner: rdioScanner }],
    };
    const device = makeDevice([scanChannel], { mode: "scan" });
    const issues = checkRdioScanner(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "rdio-scanner-not-supported-on-scan-mode" });
  });

  it("does not flag rdio_scanner on a multichannel-mode device's channel", () => {
    const device = makeDevice(
      [
        makeChannel(100_000_000, {
          outputs: [{ type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true, rdio_scanner: rdioScanner }],
        }),
      ],
      { mode: "multichannel" }
    );
    expect(checkRdioScanner(makeConfig([device]))).toEqual([]);
  });

  it("does not flag rdio_scanner on a mixer output even though mixers have no scan-mode concept", () => {
    const mixer: Mixer = {
      name: "mix1",
      outputs: [{ type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true, rdio_scanner: rdioScanner }],
    };
    expect(checkRdioScanner(makeConfig([], { mixers: [mixer] }))).toEqual([]);
  });

  it("errors when rdio_scanner_queue_depth is 0 or negative", () => {
    expect(checkRdioScanner(makeConfig([], { rdio_scanner_queue_depth: 0 }))[0]).toMatchObject({
      severity: "error",
      code: "rdio-scanner-invalid-queue-depth",
    });
    expect(checkRdioScanner(makeConfig([], { rdio_scanner_queue_depth: -1 }))[0]).toMatchObject({
      code: "rdio-scanner-invalid-queue-depth",
    });
  });

  it("does not flag a positive rdio_scanner_queue_depth", () => {
    expect(checkRdioScanner(makeConfig([], { rdio_scanner_queue_depth: 128 }))).toEqual([]);
  });
});

describe("checkDisableCascade", () => {
  it("does not flag a normal, fully-active config", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    expect(checkDisableCascade(makeConfig([device]))).toEqual([]);
  });

  it("errors when every device is disabled", () => {
    const device = makeDevice([makeChannel(100_000_000)], { disable: true });
    const issues = checkDisableCascade(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "no-active-devices" });
  });

  it("does not flag when at least one device is active", () => {
    const disabled = makeDevice([makeChannel(100_000_000)], { disable: true });
    const active = makeDevice([makeChannel(101_000_000)]);
    expect(checkDisableCascade(makeConfig([disabled, active]))).toEqual([]);
  });

  it("errors when every channel on an active device is disabled", () => {
    const device = makeDevice([makeChannel(100_000_000, { disable: true })]);
    const issues = checkDisableCascade(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "no-active-channels" });
  });

  it("errors when every output on an active channel is disabled", () => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "pulse", disable: true }] })]);
    const issues = checkDisableCascade(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "no-active-outputs" });
  });

  it("errors when every output on an active mixer is disabled", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse", disable: true }] };
    const issues = checkDisableCascade(makeConfig([device], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "no-active-mixer-outputs", path: "$.mixers[0]" });
  });

  it("does not flag a disabled mixer even with zero non-disabled outputs", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse", disable: true }], disable: true };
    expect(checkDisableCascade(makeConfig([device], { mixers: [mixer] }))).toEqual([]);
  });

  it("does not treat enabled: false as disabled -- a live-off channel is still allocated and must still count as active", () => {
    const device = makeDevice([makeChannel(100_000_000, { enabled: false })]);
    expect(checkDisableCascade(makeConfig([device]))).toEqual([]);
  });

  it("does not treat enabled: false as disabled on a mixer either", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }], enabled: false };
    expect(checkDisableCascade(makeConfig([device], { mixers: [mixer] }))).toEqual([]);
  });
});

describe("checkFftSize", () => {
  it("does not flag a config with no fft_size set", () => {
    expect(checkFftSize(makeConfig([]))).toEqual([]);
  });

  it.each([256, 512, 1024, 2048, 4096, 8192])("does not flag the valid power-of-two %d", (fft_size) => {
    expect(checkFftSize(makeConfig([], { fft_size }))).toEqual([]);
  });

  it.each([255, 8193, 300, 0, -512])("errors on the invalid value %d", (fft_size) => {
    const issues = checkFftSize(makeConfig([], { fft_size }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "fft-size-invalid", path: "$.fft_size" });
  });
});

describe("checkShoutMetadataDelay", () => {
  it("does not flag a config with no shout_metadata_delay set", () => {
    expect(checkShoutMetadataDelay(makeConfig([]))).toEqual([]);
  });

  it.each([0, 16, 32])("does not flag the in-range value %d", (shout_metadata_delay) => {
    expect(checkShoutMetadataDelay(makeConfig([], { shout_metadata_delay }))).toEqual([]);
  });

  it.each([-1, 33])("errors on the out-of-range value %d", (shout_metadata_delay) => {
    const issues = checkShoutMetadataDelay(makeConfig([], { shout_metadata_delay }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "shout-metadata-delay-out-of-range" });
  });
});

describe("checkFilterCutoffs", () => {
  it("does not flag a channel with lowpass >= highpass", () => {
    const device = makeDevice([makeChannel(100_000_000, { highpass: 100, lowpass: 2500 })]);
    expect(checkFilterCutoffs(makeConfig([device]))).toEqual([]);
  });

  it("errors when a channel's lowpass is below its highpass", () => {
    const device = makeDevice([makeChannel(100_000_000, { highpass: 3000, lowpass: 1000 })]);
    const issues = checkFilterCutoffs(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "lowpass-below-highpass", path: "$.devices[0].channels[0]" });
  });

  it("does not flag a channel with only one of the two fields set", () => {
    const device = makeDevice([makeChannel(100_000_000, { highpass: 3000 })]);
    expect(checkFilterCutoffs(makeConfig([device]))).toEqual([]);
  });

  it("errors when a mixer's lowpass is below its highpass", () => {
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }], highpass: 3000, lowpass: 1000 };
    const issues = checkFilterCutoffs(makeConfig([], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "lowpass-below-highpass", path: "$.mixers[0]" });
  });
});

describe("checkModulation", () => {
  it("does not flag exact 'am'/'nfm' values", () => {
    const device = makeDevice([makeChannel(100_000_000, { modulation: "am" }), makeChannel(100_100_000, { modulation: "nfm" })]);
    expect(checkModulation(makeConfig([device]))).toEqual([]);
  });

  it("does not flag a channel with no modulation set", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    delete (device.channels[0] as { modulation?: string }).modulation;
    expect(checkModulation(makeConfig([device]))).toEqual([]);
  });

  it("mirrors upstream's permissive prefix match (e.g. 'nfmwide' is accepted)", () => {
    const device = makeDevice([makeChannel(100_000_000, { modulation: "nfmwide" })]);
    expect(checkModulation(makeConfig([device]))).toEqual([]);
  });

  it("errors on an unrecognized modulation value", () => {
    const device = makeDevice([makeChannel(100_000_000, { modulation: "usb" })]);
    const issues = checkModulation(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "modulation-unrecognized", path: "$.devices[0].channels[0].modulation" });
  });

  it("errors on an unrecognized value inside a scan-mode modulations list", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000], { modulations: ["am", "usb"] })], {
      mode: "scan",
      centerfreq: undefined,
    });
    const issues = checkModulation(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "modulation-unrecognized", path: expect.stringContaining("modulations[1]") });
  });
});

describe("checkAmpfactor", () => {
  it("does not flag a positive scalar ampfactor", () => {
    const device = makeDevice([makeChannel(100_000_000, { ampfactor: 1.5 })]);
    expect(checkAmpfactor(makeConfig([device]))).toEqual([]);
  });

  it("errors on a negative scalar ampfactor", () => {
    const device = makeDevice([makeChannel(100_000_000, { ampfactor: -0.5 })]);
    const issues = checkAmpfactor(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "ampfactor-negative", path: "$.devices[0].channels[0].ampfactor" });
  });

  it("errors on a negative entry inside a per-frequency ampfactor list", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000], { ampfactor: [1.0, -1.0] })], {
      mode: "scan",
      centerfreq: undefined,
    });
    const issues = checkAmpfactor(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "ampfactor-negative", path: expect.stringContaining("ampfactor[1]") });
  });
});

describe("checkSquelchThreshold", () => {
  it("does not flag zero or negative values", () => {
    const device = makeDevice([makeChannel(100_000_000, { squelch_threshold: 0 }), makeChannel(100_100_000, { squelch_threshold: -35 })]);
    expect(checkSquelchThreshold(makeConfig([device]))).toEqual([]);
  });

  it("errors on a positive value", () => {
    const device = makeDevice([makeChannel(100_000_000, { squelch_threshold: 5 })]);
    const issues = checkSquelchThreshold(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "squelch-threshold-positive" });
  });

  it("errors on a positive entry inside a per-frequency list", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000], { squelch_threshold: [-30, 5] })], {
      mode: "scan",
      centerfreq: undefined,
    });
    const issues = checkSquelchThreshold(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "squelch-threshold-positive", path: expect.stringContaining("squelch_threshold[1]") });
  });
});

describe("checkSquelchSnrThreshold", () => {
  it("does not flag zero or positive values", () => {
    const device = makeDevice([makeChannel(100_000_000, { squelch_snr_threshold: 0 }), makeChannel(100_100_000, { squelch_snr_threshold: 20 })]);
    expect(checkSquelchSnrThreshold(makeConfig([device]))).toEqual([]);
  });

  it("does not flag the documented -1 sentinel (use default)", () => {
    const device = makeDevice([makeChannel(100_000_000, { squelch_snr_threshold: -1 })]);
    expect(checkSquelchSnrThreshold(makeConfig([device]))).toEqual([]);
  });

  it("errors on any other negative value", () => {
    const device = makeDevice([makeChannel(100_000_000, { squelch_snr_threshold: -0.5 })]);
    const issues = checkSquelchSnrThreshold(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "squelch-snr-threshold-invalid" });
  });

  it("honors the -1 sentinel inside a per-frequency list but still flags other negatives", () => {
    const device = makeDevice([makeScanChannel([100_000_000, 101_000_000, 102_000_000], { squelch_snr_threshold: [-1, 10, -2] })], {
      mode: "scan",
      centerfreq: undefined,
    });
    const issues = checkSquelchSnrThreshold(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "squelch-snr-threshold-invalid", path: expect.stringContaining("squelch_snr_threshold[2]") });
  });
});

describe("checkSquelchMutualExclusion", () => {
  it("does not flag a channel with only squelch_threshold set", () => {
    const device = makeDevice([makeChannel(100_000_000, { squelch_threshold: -30 })]);
    expect(checkSquelchMutualExclusion(makeConfig([device]))).toEqual([]);
  });

  it("does not flag a channel with only squelch_snr_threshold set", () => {
    const device = makeDevice([makeChannel(100_000_000, { squelch_snr_threshold: 10 })]);
    expect(checkSquelchMutualExclusion(makeConfig([device]))).toEqual([]);
  });

  it("errors when both are set on the same channel", () => {
    const device = makeDevice([makeChannel(100_000_000, { squelch_threshold: -30, squelch_snr_threshold: 10 })]);
    const issues = checkSquelchMutualExclusion(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "squelch-threshold-and-snr-threshold-both-set" });
  });

  it("errors when both are set on a scan-mode channel, even as per-frequency lists", () => {
    const device = makeDevice(
      [makeScanChannel([100_000_000, 101_000_000], { squelch_threshold: [-30, -25], squelch_snr_threshold: [10, 12] })],
      { mode: "scan", centerfreq: undefined }
    );
    const issues = checkSquelchMutualExclusion(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "squelch-threshold-and-snr-threshold-both-set" });
  });
});

describe("checkNotchQ", () => {
  it("does not flag a positive notch_q", () => {
    const device = makeDevice([makeChannel(100_000_000, { notch_q: 10 })]);
    expect(checkNotchQ(makeConfig([device]))).toEqual([]);
  });

  it.each([0, -1])("errors on a non-positive notch_q value %d", (notch_q) => {
    const device = makeDevice([makeChannel(100_000_000, { notch_q })]);
    const issues = checkNotchQ(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "notch-q-non-positive" });
  });
});

describe("checkFileOutputFlags", () => {
  it("does not flag a file output with only continuous set", () => {
    const device = makeDevice([
      makeChannel(100_000_000, { outputs: [{ type: "file", directory: "/tmp", filename_template: "x", continuous: true }] }),
    ]);
    expect(checkFileOutputFlags(makeConfig([device]))).toEqual([]);
  });

  it("does not flag a file output with only split_on_transmission set", () => {
    const device = makeDevice([
      makeChannel(100_000_000, { outputs: [{ type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true }] }),
    ]);
    expect(checkFileOutputFlags(makeConfig([device]))).toEqual([]);
  });

  it("errors when both continuous and split_on_transmission are set", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [{ type: "file", directory: "/tmp", filename_template: "x", continuous: true, split_on_transmission: true }],
      }),
    ]);
    const issues = checkFileOutputFlags(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "file-output-continuous-and-split-on-transmission" });
  });
});

describe("checkUdpStreamSampleRate", () => {
  it("does not flag a udp_stream output with no sample_rate set", () => {
    const device = makeDevice([
      makeChannel(100_000_000, { outputs: [{ type: "udp_stream", dest_address: "10.0.0.1", dest_port: "5005" }] }),
    ]);
    expect(checkUdpStreamSampleRate(makeConfig([device]))).toEqual([]);
  });

  it("does not flag a positive sample_rate", () => {
    const device = makeDevice([
      makeChannel(100_000_000, { outputs: [{ type: "udp_stream", dest_address: "10.0.0.1", dest_port: "5005", sample_rate: 8000 }] }),
    ]);
    expect(checkUdpStreamSampleRate(makeConfig([device]))).toEqual([]);
  });

  it.each([0, -1])("errors on a non-positive sample_rate value %d", (sample_rate) => {
    const device = makeDevice([
      makeChannel(100_000_000, { outputs: [{ type: "udp_stream", dest_address: "10.0.0.1", dest_port: "5005", sample_rate }] }),
    ]);
    const issues = checkUdpStreamSampleRate(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "udp-stream-sample-rate-non-positive" });
  });

  it("also checks outputs on top-level mixers", () => {
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "udp_stream", dest_address: "10.0.0.1", dest_port: "5005", sample_rate: -1 }] };
    const issues = checkUdpStreamSampleRate(makeConfig([], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "udp-stream-sample-rate-non-positive", path: "$.mixers[0].outputs[0].sample_rate" });
  });
});

describe("checkStatsHttp", () => {
  it("does not flag a config with neither stats_http_address nor stats_http_port set", () => {
    expect(checkStatsHttp(makeConfig([]))).toEqual([]);
  });

  it("does not flag both set together with a valid port", () => {
    expect(checkStatsHttp(makeConfig([], { stats_http_address: "127.0.0.1", stats_http_port: 9091 }))).toEqual([]);
  });

  it("errors when only stats_http_address is set", () => {
    const issues = checkStatsHttp(makeConfig([], { stats_http_address: "127.0.0.1" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "stats-http-address-and-port-must-be-set-together" });
  });

  it("errors when only stats_http_port is set", () => {
    const issues = checkStatsHttp(makeConfig([], { stats_http_port: 9091 }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "stats-http-address-and-port-must-be-set-together" });
  });

  it.each([0, -1, 65536])("errors when stats_http_port %d is out of range", (stats_http_port) => {
    const issues = checkStatsHttp(makeConfig([], { stats_http_address: "127.0.0.1", stats_http_port }));
    expect(issues.some((i) => i.code === "stats-http-port-out-of-range")).toBe(true);
  });
});

describe("checkControlSocketPath", () => {
  it("does not flag a config with no control_socket_path set", () => {
    expect(checkControlSocketPath(makeConfig([]))).toEqual([]);
  });

  it("does not flag a non-empty path", () => {
    expect(checkControlSocketPath(makeConfig([], { control_socket_path: "/run/rtl-airband/inst.sock" }))).toEqual([]);
  });

  it.each(["", "   "])("errors when control_socket_path is %j", (control_socket_path) => {
    const issues = checkControlSocketPath(makeConfig([], { control_socket_path }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "control-socket-path-empty" });
  });
});

describe("checkEnabledDisableRedundant", () => {
  it("does not flag a channel with only disable set", () => {
    const device = makeDevice([makeChannel(100_000_000, { disable: true })]);
    expect(checkEnabledDisableRedundant(makeConfig([device]))).toEqual([]);
  });

  it("does not flag a channel with only enabled: false set", () => {
    const device = makeDevice([makeChannel(100_000_000, { enabled: false })]);
    expect(checkEnabledDisableRedundant(makeConfig([device]))).toEqual([]);
  });

  it("warns when a channel has both disable: true and enabled: false", () => {
    const device = makeDevice([makeChannel(100_000_000, { disable: true, enabled: false })]);
    const issues = checkEnabledDisableRedundant(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "enabled-false-with-disable", path: "$.devices[0].channels[0]" });
  });

  it("warns when a mixer has both disable: true and enabled: false", () => {
    const device = makeDevice([makeChannel(100_000_000)]);
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }], disable: true, enabled: false };
    const issues = checkEnabledDisableRedundant(makeConfig([device], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "enabled-false-with-disable", path: "$.mixers[0]" });
  });
});

describe("checkMixerNestedOutputs", () => {
  it("does not flag a pulse output with stream_name set", () => {
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse", stream_name: "mix1" }] };
    expect(checkMixerNestedOutputs(makeConfig([], { mixers: [mixer] }))).toEqual([]);
  });

  it("errors when a mixer's pulse output omits stream_name", () => {
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }] };
    const issues = checkMixerNestedOutputs(makeConfig([], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "mixer-output-pulse-stream-name-required" });
  });

  it("errors on a rawfile output nested under a mixer", () => {
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "rawfile", directory: "/tmp", filename_template: "x" }] };
    const issues = checkMixerNestedOutputs(makeConfig([], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "mixer-output-rawfile-not-allowed" });
  });

  it("errors on a file output with split_on_transmission set under a mixer", () => {
    const mixer: Mixer = {
      name: "mix1",
      outputs: [{ type: "file", directory: "/tmp", filename_template: "x", split_on_transmission: true }],
    };
    const issues = checkMixerNestedOutputs(makeConfig([], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "mixer-output-split-on-transmission-not-allowed" });
  });

  it("does not flag the same rules on a channel's own outputs (not mixer-nested)", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [
          { type: "pulse" }, // no stream_name -- fine on a channel
          { type: "rawfile", directory: "/tmp", filename_template: "x" }, // fine on a channel
        ],
      }),
    ]);
    expect(checkMixerNestedOutputs(makeConfig([device]))).toEqual([]);
  });
});

describe("checkMixerOutputBalance", () => {
  it("does not flag balance within [-1.0, 1.0]", () => {
    const device = makeDevice([
      makeChannel(100_000_000, { outputs: [{ type: "mixer", name: "mix1", balance: -1.0 }] }),
      makeChannel(100_100_000, { outputs: [{ type: "mixer", name: "mix1", balance: 1.0 }] }),
    ]);
    expect(checkMixerOutputBalance(makeConfig([device]))).toEqual([]);
  });

  it("does not flag a mixer output with no balance set", () => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "mixer", name: "mix1" }] })]);
    expect(checkMixerOutputBalance(makeConfig([device]))).toEqual([]);
  });

  it.each([1.5, -1.5])("errors when balance is out of range (%d)", (balance) => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "mixer", name: "mix1", balance }] })]);
    const issues = checkMixerOutputBalance(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "mixer-output-balance-out-of-range" });
  });
});

describe("checkMixerReserveInputs", () => {
  it("does not flag a mixer with no reserve_inputs set", () => {
    const mixer: Mixer = { name: "mix1", outputs: [{ type: "pulse" }] };
    expect(checkMixerReserveInputs(makeConfig([], { mixers: [mixer] }))).toEqual([]);
  });

  it("does not flag a non-negative reserve_inputs", () => {
    const mixer: Mixer = { name: "mix1", reserve_inputs: 2, outputs: [{ type: "pulse" }] };
    expect(checkMixerReserveInputs(makeConfig([], { mixers: [mixer] }))).toEqual([]);
  });

  it("errors when reserve_inputs is negative", () => {
    const mixer: Mixer = { name: "mix1", reserve_inputs: -1, outputs: [{ type: "pulse" }] };
    const issues = checkMixerReserveInputs(makeConfig([], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "mixer-reserve-inputs-negative", path: "$.mixers[0]" });
  });
});

describe("checkPostWriteScript", () => {
  it("does not flag a file output with no post_write_script", () => {
    const device = makeDevice([makeChannel(100_000_000, { outputs: [{ type: "file", directory: "/tmp", filename_template: "x" }] })]);
    expect(checkPostWriteScript(makeConfig([device]))).toEqual([]);
  });

  it("warns (not errors) when post_write_script is set on a channel output", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [{ type: "file", directory: "/tmp", filename_template: "x", post_write_script: "/usr/local/bin/upload.sh" }],
      }),
    ]);
    const issues = checkPostWriteScript(makeConfig([device]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "post-write-script-runs-arbitrary-command", path: "$.devices[0].channels[0].outputs[0].post_write_script" });
  });

  it("also checks post_write_script on top-level mixer outputs", () => {
    const mixer = { name: "mix1", outputs: [{ type: "file" as const, directory: "/tmp", filename_template: "x", post_write_script: "/usr/local/bin/upload.sh" }] };
    const issues = checkPostWriteScript(makeConfig([], { mixers: [mixer] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", code: "post-write-script-runs-arbitrary-command", path: "$.mixers[0].outputs[0].post_write_script" });
  });

  it("does not flag a file output whose post_write_script is an empty string", () => {
    const device = makeDevice([
      makeChannel(100_000_000, {
        outputs: [{ type: "file", directory: "/tmp", filename_template: "x", post_write_script: "" }],
      }),
    ]);
    expect(checkPostWriteScript(makeConfig([device]))).toEqual([]);
  });
});
