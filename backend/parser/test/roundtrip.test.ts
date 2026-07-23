import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/parser.js";
import { serializeConfig } from "../src/serializer.js";
import { toDomain, fromDomain } from "../src/mapper.js";
import { parseConfigFile, serializeConfigFile } from "../src/index.js";
import type { Channel, Device, Mixer, Output, RtlAirbandConfig, ScanChannel } from "../src/domain.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "../../../fixtures/151719.conf");
const fixtureSource = readFileSync(fixturePath, "utf8");

describe("generic libconfig layer", () => {
  it("parses the fixture without error", () => {
    const ast = parseConfig(fixtureSource);
    expect(ast.members.length).toBeGreaterThan(0);
  });

  it("round-trips parse -> serialize -> parse to an identical AST", () => {
    const ast1 = parseConfig(fixtureSource);
    const text2 = serializeConfig(ast1);
    const ast2 = parseConfig(text2);
    expect(ast2).toEqual(ast1);
  });

  it("is stable under a second round trip (idempotent serialization)", () => {
    const ast1 = parseConfig(fixtureSource);
    const text2 = serializeConfig(ast1);
    const text3 = serializeConfig(parseConfig(text2));
    expect(text3).toBe(text2);
  });
});

describe("domain mapping layer", () => {
  it("maps the fixture to the expected shape", () => {
    const domain = toDomain(parseConfig(fixtureSource));
    expect(domain.multiple_demod_threads).toBe(true);
    expect(domain.stats_filepath).toBe("/var/lib/rtl-airband/stats/151719.txt");
    expect(domain.devices).toHaveLength(1);

    const device = domain.devices[0]!;
    expect(device.type).toBe("rtlsdr");
    expect(device.serial).toBe("11");
    expect(device.gain).toBe(29);
    expect(device.centerfreq).toBe(151_780_000);
    expect(device.sample_rate).toBe(1_400_000);
    expect(device.channels).toHaveLength(22);

    const firstChannel = device.channels[0]!;
    expect(firstChannel.freq).toBe(151_160_000);
    expect(firstChannel.bandwidth).toBe(5000);
    expect(firstChannel.ampfactor).toBe(5);
    expect(firstChannel.ctcss).toBeUndefined();
    expect(firstChannel.notch).toBeCloseTo(136.5);
    expect(firstChannel.outputs).toHaveLength(2);
    expect(firstChannel.outputs[0]).toMatchObject({ type: "pulse", sink: "channel_01" });
    expect(firstChannel.outputs[1]).toMatchObject({ type: "file", directory: expect.stringContaining("channel_01") });

    const ctcssChannel = device.channels[1]!;
    expect(ctcssChannel.ctcss).toBeCloseTo(103.5);

    const squelchChannel = device.channels.find((c) => c.squelch_snr_threshold !== undefined);
    expect(squelchChannel?.squelch_snr_threshold).toBe(12);

    const fileOutput = firstChannel.outputs[1];
    if (fileOutput.type !== "file") throw new Error("expected file output");
    expect(fileOutput.post_write_script).toBe("/usr/local/bin/post_write_script.sh");
  });

  it("leaves fft_size undefined when absent, and round-trips it when present", () => {
    const domain1 = toDomain(parseConfig(fixtureSource));
    expect(domain1.fft_size).toBeUndefined();

    const withFftSize = { ...domain1, fft_size: 1024 };
    const domain2 = toDomain(fromDomain(withFftSize));
    expect(domain2.fft_size).toBe(1024);
  });

  it("canonicalizes an int-Hz-authored centerfreq the same as an equivalent float-MHz one", () => {
    const intHzSource = fixtureSource.replace("centerfreq = 151.780;", "centerfreq = 151780000;");
    const domain = toDomain(parseConfig(intHzSource));
    expect(domain.devices[0]!.centerfreq).toBe(151_780_000);
  });

  it("treats afc, modulation, serial, sample_rate, and correction as optional, matching RTLSDR-Airband's own defaults", () => {
    // A channel with no afc/modulation set at all, and a device selected by
    // index rather than serial with no sample_rate/correction override --
    // all valid, real-world RTLSDR-Airband configs that must not throw.
    const source = `
      multiple_demod_threads = true;
      multiple_output_threads = true;
      stats_filepath = "/tmp/stats.txt";
      localtime = true;
      devices: (
        {
          type = "rtlsdr";
          index = 0;
          gain = 29;
          centerfreq = 151.780;
          channels: (
            {
              freq = 151.16;
              outputs: (
                { type = "pulse"; server = "10.0.0.1"; sink = "s"; stream_name = "s"; continuous = false; }
              );
            }
          );
        }
      );
    `;
    const domain = toDomain(parseConfig(source));
    const device = domain.devices[0]!;
    expect(device.serial).toBeUndefined();
    expect(device.index).toBe(0);
    expect(device.sample_rate).toBeUndefined();
    expect(device.correction).toBeUndefined();
    const channel = device.channels[0]!;
    expect(channel.afc).toBeUndefined();
    expect(channel.modulation).toBeUndefined();

    // and it round-trips without inventing values for fields that were never set
    const text = serializeConfigFile(domain);
    expect(text).not.toContain("afc");
    expect(text).not.toContain("modulation");
    expect(text).not.toContain("sample_rate");
    expect(text).not.toContain("correction");
    expect(toDomain(parseConfig(text))).toEqual(domain);
  });

  it("round-trips fixture -> domain -> AST -> domain to an identical domain object", () => {
    const domain1 = toDomain(parseConfig(fixtureSource));
    const ast2 = fromDomain(domain1);
    const domain2 = toDomain(ast2);
    expect(domain2).toEqual(domain1);
  });

  it("round-trips fixture -> domain -> text -> domain via the public API", () => {
    const domain1 = parseConfigFile(fixtureSource);
    const text = serializeConfigFile(domain1);
    const domain2 = parseConfigFile(text);
    expect(domain2).toEqual(domain1);
  });

  it("produces text that is itself stable under a further domain round trip", () => {
    const domain1 = parseConfigFile(fixtureSource);
    const text1 = serializeConfigFile(domain1);
    const text2 = serializeConfigFile(parseConfigFile(text1));
    expect(text2).toBe(text1);
  });
});

function minimalConfigWithOutput(output: Output): RtlAirbandConfig {
  return {
    multiple_demod_threads: true,
    multiple_output_threads: true,
    stats_filepath: "/tmp/stats.txt",
    localtime: true,
    devices: [
      {
        type: "rtlsdr",
        serial: "1",
        gain: 29,
        centerfreq: 100_000_000,
        channels: [{ freq: 100_000_000, outputs: [output] }],
      },
    ],
  };
}

function roundTrip(output: Output): Output {
  const domain1 = minimalConfigWithOutput(output);
  const text = serializeConfigFile(domain1);
  const domain2 = parseConfigFile(text);
  return domain2.devices[0]!.channels[0]!.outputs[0]!;
}

describe("output types", () => {
  it("round-trips a minimal pulse output without inventing optional fields", () => {
    const output: Output = { type: "pulse" };
    expect(roundTrip(output)).toEqual(output);
  });

  it("round-trips a fully-populated pulse output", () => {
    const output: Output = { type: "pulse", server: "10.0.0.1", sink: "s", name: "custom", stream_name: "s1", continuous: true };
    expect(roundTrip(output)).toEqual(output);
  });

  it("round-trips a minimal file output (only directory/filename_template required)", () => {
    const output: Output = { type: "file", directory: "/tmp/audio", filename_template: "rec" };
    expect(roundTrip(output)).toEqual(output);
  });

  it("round-trips a rawfile output, which has no min_rx_seconds/post_write_script", () => {
    const output: Output = {
      type: "rawfile",
      directory: "/tmp/iq",
      filename_template: "raw",
      split_on_transmission: true,
      continuous: false,
    };
    const result = roundTrip(output);
    expect(result).toEqual(output);
    expect(result).not.toHaveProperty("min_rx_seconds");
    expect(result).not.toHaveProperty("post_write_script");
  });

  it("round-trips a file output with a minimal rdio_scanner block (only required fields)", () => {
    const output: Output = {
      type: "file",
      directory: "/tmp/audio",
      filename_template: "rec",
      split_on_transmission: true,
      rdio_scanner: { server: "rdio.example.com", port: 443, api_key: "secret", talkgroup_id: 1 },
    };
    expect(roundTrip(output)).toEqual(output);
  });

  it("round-trips a file output with a fully-populated rdio_scanner block", () => {
    const output: Output = {
      type: "file",
      directory: "/tmp/audio",
      filename_template: "rec",
      split_on_transmission: true,
      rdio_scanner: {
        server: "rdio.example.com",
        port: 443,
        use_tls: true,
        api_key: "secret",
        system_id: 1,
        system_label: "County",
        talkgroup_id: 100,
        talkgroup_label: "Dispatch",
        talkgroup_tag: "Law",
        talkgroup_group: "Public Safety",
        source_id: 42,
        delete_after_upload: true,
        timeout_ms: 8000,
        max_retries: 5,
      },
    };
    expect(roundTrip(output)).toEqual(output);
  });

  it("round-trips a rawfile output, which has no rdio_scanner field", () => {
    const output: Output = {
      type: "rawfile",
      directory: "/tmp/iq",
      filename_template: "raw",
      split_on_transmission: true,
    };
    const result = roundTrip(output);
    expect(result).not.toHaveProperty("rdio_scanner");
  });

  it("round-trips an icecast output with required fields plus tls", () => {
    const output: Output = {
      type: "icecast",
      server: "stream.example.com",
      port: 8000,
      mountpoint: "/tower.mp3",
      username: "source",
      password: "hunter2",
      name: "Tower",
      genre: "ATC",
      send_scan_freq_tags: true,
      tls: "auto",
    };
    expect(roundTrip(output)).toEqual(output);
  });

  it("rejects an icecast output with an invalid tls value", () => {
    const source = `
      multiple_demod_threads = true;
      multiple_output_threads = true;
      stats_filepath = "/tmp/stats.txt";
      localtime = true;
      devices: (
        { type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0;
          channels: ( { freq = 100.0; outputs: (
            { type = "icecast"; server = "s"; port = 8000; mountpoint = "/m"; username = "u"; password = "p"; tls = "bogus"; }
          ); } ); }
      );
    `;
    expect(() => parseConfigFile(source)).toThrow(/Invalid tls value/);
  });

  it("round-trips a udp_stream output, normalizing an int dest_port to a string", () => {
    const source = `
      multiple_demod_threads = true;
      multiple_output_threads = true;
      stats_filepath = "/tmp/stats.txt";
      localtime = true;
      devices: (
        { type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0;
          channels: ( { freq = 100.0; outputs: (
            { type = "udp_stream"; dest_address = "10.0.0.5"; dest_port = 5005; continuous = true; }
          ); } ); }
      );
    `;
    const domain = parseConfigFile(source);
    const output = domain.devices[0]!.channels[0]!.outputs[0]!;
    expect(output).toEqual({ type: "udp_stream", dest_address: "10.0.0.5", dest_port: "5005", continuous: true });
  });

  it("round-trips a mixer output", () => {
    const output: Output = { type: "mixer", name: "mix1", ampfactor: 1.5, balance: -0.5 };
    expect(roundTrip(output)).toEqual(output);
  });

  it("rejects an unrecognized output type", () => {
    const source = `
      multiple_demod_threads = true;
      multiple_output_threads = true;
      stats_filepath = "/tmp/stats.txt";
      localtime = true;
      devices: (
        { type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0;
          channels: ( { freq = 100.0; outputs: ( { type = "carrier_pigeon"; } ); } ); }
      );
    `;
    expect(() => parseConfigFile(source)).toThrow(/Unrecognized output type/);
  });

  it("round-trips disable at every output level", () => {
    const output: Output = { type: "pulse", disable: true };
    expect(roundTrip(output)).toEqual(output);
  });
});

function minimalMultichannelConfig(channel: Partial<import("../src/domain.js").MultichannelChannel> & { freq: number }): RtlAirbandConfig {
  return {
    multiple_demod_threads: true,
    multiple_output_threads: true,
    stats_filepath: "/tmp/stats.txt",
    localtime: true,
    devices: [
      {
        type: "rtlsdr",
        serial: "1",
        gain: 29,
        centerfreq: 100_000_000,
        channels: [{ outputs: [{ type: "pulse" }], ...channel }],
      },
    ],
  };
}

function roundTripDomain(domain: RtlAirbandConfig): RtlAirbandConfig {
  return parseConfigFile(serializeConfigFile(domain));
}

describe("new multichannel channel fields", () => {
  it("round-trips squelch_threshold alongside squelch_snr_threshold", () => {
    const domain = minimalMultichannelConfig({ freq: 100_000_000, squelch_threshold: -30, squelch_snr_threshold: 12 });
    const result = roundTripDomain(domain);
    const channel = result.devices[0]!.channels[0]!;
    expect(channel).toMatchObject({ squelch_threshold: -30, squelch_snr_threshold: 12 });
  });

  it("round-trips label, notch_q, highpass, lowpass, tau, and disable", () => {
    const domain = minimalMultichannelConfig({
      freq: 100_000_000,
      label: "Tower",
      notch_q: 15.5,
      highpass: 200,
      lowpass: 3200,
      tau: 0,
      disable: true,
    });
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("omits new optional fields entirely when absent", () => {
    const domain = minimalMultichannelConfig({ freq: 100_000_000 });
    const text = serializeConfigFile(domain);
    expect(text).not.toMatch(/squelch_threshold|notch_q|highpass|lowpass|\btau\b|disable|label/);
  });
});

function minimalScanConfig(channel: ScanChannel): RtlAirbandConfig {
  return {
    multiple_demod_threads: true,
    multiple_output_threads: true,
    stats_filepath: "/tmp/stats.txt",
    localtime: true,
    devices: [
      {
        type: "rtlsdr",
        serial: "1",
        gain: 29,
        mode: "scan",
        channels: [channel],
      },
    ],
  };
}

describe("scan mode channels", () => {
  it("round-trips a scalar squelch_threshold applied to all scanned frequencies", () => {
    const domain = minimalScanConfig({
      freqs: [126_300_000, 121_500_000, 128_225_000, 131_375_000],
      squelch_threshold: -30,
      outputs: [{ type: "pulse" }],
    });
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("round-trips a per-frequency squelch_threshold list, including the 0 = auto-squelch sentinel", () => {
    const domain = minimalScanConfig({
      freqs: [126_300_000, 121_500_000, 128_225_000, 131_375_000],
      squelch_threshold: [-30, -25, 0, -35],
      outputs: [{ type: "pulse" }],
    });
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("round-trips a per-frequency squelch_snr_threshold list, including the 0 and -1.0 sentinels", () => {
    const domain = minimalScanConfig({
      freqs: [126_300_000, 121_500_000, 128_225_000, 131_375_000],
      squelch_snr_threshold: [30, 5, 0, -1.0],
      outputs: [{ type: "pulse" }],
    });
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("round-trips modulations, labels, and list-valued ampfactor/ctcss/notch/notch_q/bandwidth", () => {
    const domain = minimalScanConfig({
      freqs: [126_300_000, 121_500_000],
      labels: ["Radar", "Emergency"],
      modulations: ["am", "nfm"],
      ampfactor: [1.0, 2.5],
      ctcss: [103.5, 0.0],
      notch: [136.5, 0.0],
      notch_q: [12.0, 10.0],
      bandwidth: [8000, 10000],
      outputs: [{ type: "pulse" }],
    });
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("round-trips a scalar modulation/ampfactor/ctcss/notch/notch_q/bandwidth applied to all frequencies", () => {
    const domain = minimalScanConfig({
      freqs: [126_300_000, 121_500_000],
      modulation: "nfm",
      ampfactor: 2.0,
      ctcss: 103.5,
      notch: 136.5,
      notch_q: 12.0,
      bandwidth: 8000,
      outputs: [{ type: "pulse" }],
    });
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("rejects a channel with neither freq nor freqs", () => {
    const source = `
      multiple_demod_threads = true;
      multiple_output_threads = true;
      stats_filepath = "/tmp/stats.txt";
      localtime = true;
      devices: (
        { type = "rtlsdr"; serial = "1"; gain = 29; mode = "scan";
          channels: ( { outputs: ( { type = "pulse"; } ); } ); }
      );
    `;
    expect(() => parseConfigFile(source)).toThrow(/exactly one of 'freq'.*'freqs'/);
  });

  it("rejects a channel with both freq and freqs", () => {
    const source = `
      multiple_demod_threads = true;
      multiple_output_threads = true;
      stats_filepath = "/tmp/stats.txt";
      localtime = true;
      devices: (
        { type = "rtlsdr"; serial = "1"; gain = 29; mode = "scan";
          channels: ( { freq = 100.0; freqs = ( 100.0, 101.0 ); outputs: ( { type = "pulse"; } ); } ); }
      );
    `;
    expect(() => parseConfigFile(source)).toThrow(/exactly one of 'freq'.*'freqs'/);
  });
});

describe("device-level fields", () => {
  it("round-trips mode, disable, tau, buffers on an rtlsdr device", () => {
    const domain = minimalMultichannelConfig({ freq: 100_000_000 });
    domain.devices[0]!.mode = "multichannel";
    domain.devices[0]!.disable = true;
    domain.devices[0]!.tau = 100;
    domain.devices[0]!.buffers = 12;
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("round-trips a mirisdr device's num_buffers", () => {
    const domain = minimalMultichannelConfig({ freq: 100_000_000 });
    domain.devices[0] = { ...domain.devices[0]!, type: "mirisdr", num_buffers: 8 };
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("round-trips a soapysdr device with a string gain, device_string, channel, and antenna, and no centerfreq requirement", () => {
    const device: Device = {
      type: "soapysdr",
      device_string: "driver=rtlsdr,serial=00000001",
      channel: 0,
      antenna: "RX",
      gain: "LNA=32,VGA=20",
      mode: "scan",
      channels: [{ freqs: [100_000_000, 101_000_000], outputs: [{ type: "pulse" }] }],
    };
    const domain: RtlAirbandConfig = {
      multiple_demod_threads: true,
      multiple_output_threads: true,
      stats_filepath: "/tmp/stats.txt",
      localtime: true,
      devices: [device],
    };
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("rejects an invalid device mode", () => {
    const source = `
      multiple_demod_threads = true;
      multiple_output_threads = true;
      stats_filepath = "/tmp/stats.txt";
      localtime = true;
      devices: (
        { type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0; mode = "bogus";
          channels: ( { freq = 100.0; outputs: ( { type = "pulse"; } ); } ); }
      );
    `;
    expect(() => parseConfigFile(source)).toThrow(/Invalid mode value/);
  });
});

describe("global settings", () => {
  it("round-trips pidfile, log_scan_activity, shout_metadata_delay, and tau", () => {
    const domain = minimalMultichannelConfig({ freq: 100_000_000 });
    domain.pidfile = "/var/tmp/rtl_airband.pid";
    domain.log_scan_activity = true;
    domain.shout_metadata_delay = 5;
    domain.tau = 100;
    expect(roundTripDomain(domain)).toEqual(domain);
  });
});

describe("mixers", () => {
  it("round-trips a top-level mixer definition and a channel routing into it", () => {
    const mixer: Mixer = {
      name: "mix1",
      disable: false,
      highpass: 200,
      lowpass: 3000,
      outputs: [{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "u", password: "p" }],
    };
    const channel: Channel = {
      freq: 100_000_000,
      outputs: [{ type: "mixer", name: "mix1", ampfactor: 1.5, balance: 0.2 }],
    };
    const domain: RtlAirbandConfig = {
      multiple_demod_threads: true,
      multiple_output_threads: true,
      stats_filepath: "/tmp/stats.txt",
      localtime: true,
      devices: [{ type: "rtlsdr", serial: "1", gain: 29, centerfreq: 100_000_000, channels: [channel] }],
      mixers: [mixer],
    };
    expect(roundTripDomain(domain)).toEqual(domain);
  });

  it("rejects a mixer whose own outputs include a nested mixer output", () => {
    const source = `
      multiple_demod_threads = true;
      multiple_output_threads = true;
      stats_filepath = "/tmp/stats.txt";
      localtime = true;
      devices: (
        { type = "rtlsdr"; serial = "1"; gain = 29; centerfreq = 100.0;
          channels: ( { freq = 100.0; outputs: ( { type = "mixer"; name = "mix1"; } ); } ); }
      );
      mixers: (
        { name = "mix1"; outputs: ( { type = "mixer"; name = "mix2"; } ); }
      );
    `;
    expect(() => parseConfigFile(source)).toThrow(/cannot themselves be of type 'mixer'/);
  });
});
