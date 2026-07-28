import { describe, expect, it } from "vitest";
import type { Device, Mixer } from "@rtl-airband-panel/parser";
import { buildMixerLookups, resolveMixerSampleLabel } from "../../src/lib/stats-mixer-labels.js";

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

describe("buildMixerLookups", () => {
  it("numbers mixers by position among enabled mixers", () => {
    const mixers: Mixer[] = [
      { name: "muted", disable: true, outputs: [{ type: "icecast", server: "s", port: 80, mountpoint: "m", username: "u", password: "p" }] },
      { name: "bcfy_1", outputs: [{ type: "icecast", server: "s", port: 80, mountpoint: "m", username: "u", password: "p" }] },
    ];
    const { mixerNames } = buildMixerLookups({
      multiple_demod_threads: true,
      multiple_output_threads: true,
      stats_filepath: "/tmp/stats.txt",
      localtime: true,
      devices: [],
      mixers,
    });
    // "muted" is disabled and consumes no index, so "bcfy_1" is index 0.
    expect(mixerNames).toEqual(new Map([["0", "bcfy_1"]]));
  });

  it("numbers mixer inputs by the order feeding channels appear, across devices", () => {
    const devices: Device[] = [
      makeDevice({
        channels: [
          { freq: 151_190_000, label: "Tac 4", afc: 0, modulation: "nfm", outputs: [{ type: "mixer", name: "bcfy_1" }] },
          { freq: 151_257_500, label: "Tac 1", afc: 0, modulation: "nfm", outputs: [{ type: "mixer", name: "bcfy_1" }] },
        ],
      }),
    ];
    const mixers: Mixer[] = [{ name: "bcfy_1", outputs: [{ type: "icecast", server: "s", port: 80, mountpoint: "m", username: "u", password: "p" }] }];

    const { inputChannels } = buildMixerLookups({
      multiple_demod_threads: true,
      multiple_output_threads: true,
      stats_filepath: "/tmp/stats.txt",
      localtime: true,
      devices,
      mixers,
    });

    expect(inputChannels).toEqual(
      new Map([
        ["0:0", "151.1900 MHz — Tac 4"],
        ["0:1", "151.2575 MHz — Tac 1"],
      ])
    );
  });

  it("skips disabled devices, channels, and outputs without consuming an input index", () => {
    const devices: Device[] = [
      makeDevice({
        disable: true,
        channels: [{ freq: 151_000_000, afc: 0, modulation: "nfm", outputs: [{ type: "mixer", name: "bcfy_1" }] }],
      }),
      makeDevice({
        serial: "2",
        channels: [
          { freq: 151_100_000, disable: true, afc: 0, modulation: "nfm", outputs: [{ type: "mixer", name: "bcfy_1" }] },
          { freq: 151_200_000, afc: 0, modulation: "nfm", outputs: [{ type: "mixer", name: "bcfy_1", disable: true }] },
          { freq: 151_300_000, label: "Kept", afc: 0, modulation: "nfm", outputs: [{ type: "mixer", name: "bcfy_1" }] },
        ],
      }),
    ];
    const mixers: Mixer[] = [{ name: "bcfy_1", outputs: [{ type: "icecast", server: "s", port: 80, mountpoint: "m", username: "u", password: "p" }] }];

    const { inputChannels } = buildMixerLookups({
      multiple_demod_threads: true,
      multiple_output_threads: true,
      stats_filepath: "/tmp/stats.txt",
      localtime: true,
      devices,
      mixers,
    });

    expect(inputChannels).toEqual(new Map([["0:0", "151.3000 MHz — Kept"]]));
  });

  it("labels a scan-mode channel's mixer input by device index and type", () => {
    const devices: Device[] = [
      makeDevice({
        mode: "scan",
        channels: [{ freqs: [151_000_000, 151_100_000], afc: 0, outputs: [{ type: "mixer", name: "bcfy_1" }] }],
      }),
    ];
    const mixers: Mixer[] = [{ name: "bcfy_1", outputs: [{ type: "icecast", server: "s", port: 80, mountpoint: "m", username: "u", password: "p" }] }];

    const { inputChannels } = buildMixerLookups({
      multiple_demod_threads: true,
      multiple_output_threads: true,
      stats_filepath: "/tmp/stats.txt",
      localtime: true,
      devices,
      mixers,
    });

    expect(inputChannels).toEqual(new Map([["0:0", "Scan channel (Device 0 — rtlsdr)"]]));
  });

  it("returns empty maps when there are no mixers", () => {
    const { mixerNames, inputChannels } = buildMixerLookups({
      multiple_demod_threads: true,
      multiple_output_threads: true,
      stats_filepath: "/tmp/stats.txt",
      localtime: true,
      devices: [],
    });
    expect(mixerNames.size).toBe(0);
    expect(inputChannels.size).toBe(0);
  });
});

describe("resolveMixerSampleLabel", () => {
  const lookups = {
    mixerNames: new Map([["0", "bcfy_1"]]),
    inputChannels: new Map([["0:1", "151.1900 MHz — Tac 4"]]),
  };

  it("resolves an input_overrun_count sample to the mixer name and feeding channel", () => {
    expect(resolveMixerSampleLabel("input_overrun_count", { mixer: "0", input: "1" }, lookups)).toBe("bcfy_1 — 151.1900 MHz — Tac 4");
  });

  it("falls back to raw indices when the input isn't in the lookup (e.g. config out of sync with the running stats)", () => {
    expect(resolveMixerSampleLabel("input_overrun_count", { mixer: "0", input: "9" }, lookups)).toBe("Mixer bcfy_1, Input 9");
  });

  it("resolves an output_overrun_count mixer sample to just the mixer name", () => {
    expect(resolveMixerSampleLabel("output_overrun_count", { mixer: "0" }, lookups)).toBe("Mixer bcfy_1");
  });

  it("returns undefined for metrics/labels it doesn't own, so callers can fall back to default formatting", () => {
    expect(resolveMixerSampleLabel("buffer_overflow_count", { device: "0" }, lookups)).toBeUndefined();
    expect(resolveMixerSampleLabel("output_overrun_count", { device: "0" }, lookups)).toBeUndefined();
  });
});
