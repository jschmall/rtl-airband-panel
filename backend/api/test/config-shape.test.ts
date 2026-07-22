import { describe, expect, it } from "vitest";
import { parseRtlAirbandConfigBody, ShapeValidationError } from "../src/config-shape.js";

function minimalBody(deviceOverrides: Record<string, unknown> = {}, channelOverrides: Record<string, unknown> = {}) {
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
        sample_rate: 1_400_000,
        correction: 0,
        channels: [
          {
            freq: 100_000_000,
            afc: 0,
            modulation: "nfm",
            outputs: [{ type: "pulse", server: "10.0.0.1", sink: "s", stream_name: "s", continuous: false }],
            ...channelOverrides,
          },
        ],
        ...deviceOverrides,
      },
    ],
  };
}

describe("parseRtlAirbandConfigBody", () => {
  it("accepts a fully-populated body", () => {
    expect(() => parseRtlAirbandConfigBody(minimalBody())).not.toThrow();
  });

  it("does not require afc or modulation on a channel", () => {
    const body = minimalBody();
    const channel = (body.devices[0] as { channels: Record<string, unknown>[] }).channels[0]!;
    delete channel["afc"];
    delete channel["modulation"];
    const config = parseRtlAirbandConfigBody(body);
    expect(config.devices[0]!.channels[0]!.afc).toBeUndefined();
    expect(config.devices[0]!.channels[0]!.modulation).toBeUndefined();
  });

  it("does not require serial, sample_rate, or correction on a device (index may substitute for serial)", () => {
    const body = minimalBody();
    const device = body.devices[0] as Record<string, unknown>;
    delete device["serial"];
    delete device["sample_rate"];
    delete device["correction"];
    device["index"] = 0;
    const config = parseRtlAirbandConfigBody(body);
    expect(config.devices[0]!.serial).toBeUndefined();
    expect(config.devices[0]!.index).toBe(0);
    expect(config.devices[0]!.sample_rate).toBeUndefined();
    expect(config.devices[0]!.correction).toBeUndefined();
  });

  it("still rejects a body missing a genuinely required field", () => {
    const body = minimalBody();
    delete (body as Record<string, unknown>)["stats_filepath"];
    expect(() => parseRtlAirbandConfigBody(body)).toThrow(ShapeValidationError);
  });
});

describe("parseRtlAirbandConfigBody output types", () => {
  function bodyWithOutput(output: Record<string, unknown>) {
    return minimalBody({}, { outputs: [output] });
  }

  it("accepts a minimal pulse output with no fields set", () => {
    const config = parseRtlAirbandConfigBody(bodyWithOutput({ type: "pulse" }));
    expect(config.devices[0]!.channels[0]!.outputs[0]).toEqual({ type: "pulse" });
  });

  it("accepts a minimal file output (only directory/filename_template required)", () => {
    const config = parseRtlAirbandConfigBody(bodyWithOutput({ type: "file", directory: "/tmp", filename_template: "x" }));
    expect(config.devices[0]!.channels[0]!.outputs[0]).toEqual({ type: "file", directory: "/tmp", filename_template: "x" });
  });

  it("accepts a rawfile output and does not carry over min_rx_seconds/post_write_script", () => {
    const config = parseRtlAirbandConfigBody(bodyWithOutput({ type: "rawfile", directory: "/tmp", filename_template: "x" }));
    const output = config.devices[0]!.channels[0]!.outputs[0]!;
    expect(output).not.toHaveProperty("min_rx_seconds");
    expect(output).not.toHaveProperty("post_write_script");
  });

  it("accepts an icecast output with all required fields", () => {
    const config = parseRtlAirbandConfigBody(
      bodyWithOutput({ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "u", password: "p" })
    );
    expect(config.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ type: "icecast", port: 8000 });
  });

  it("rejects an icecast output missing a required field", () => {
    expect(() =>
      parseRtlAirbandConfigBody(bodyWithOutput({ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "u" }))
    ).toThrow(ShapeValidationError);
  });

  it("rejects an icecast output with an invalid tls value", () => {
    expect(() =>
      parseRtlAirbandConfigBody(
        bodyWithOutput({ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "u", password: "p", tls: "bogus" })
      )
    ).toThrow(ShapeValidationError);
  });

  it("normalizes a numeric udp_stream dest_port to a string", () => {
    const config = parseRtlAirbandConfigBody(bodyWithOutput({ type: "udp_stream", dest_address: "10.0.0.1", dest_port: 5005 }));
    expect(config.devices[0]!.channels[0]!.outputs[0]).toEqual({ type: "udp_stream", dest_address: "10.0.0.1", dest_port: "5005" });
  });

  it("accepts a mixer output", () => {
    const config = parseRtlAirbandConfigBody(bodyWithOutput({ type: "mixer", name: "mix1", ampfactor: 1.5 }));
    expect(config.devices[0]!.channels[0]!.outputs[0]).toEqual({ type: "mixer", name: "mix1", ampfactor: 1.5 });
  });

  it("rejects an unrecognized output type", () => {
    expect(() => parseRtlAirbandConfigBody(bodyWithOutput({ type: "carrier_pigeon" }))).toThrow(ShapeValidationError);
  });

  it("accepts an output with disable set", () => {
    const config = parseRtlAirbandConfigBody(bodyWithOutput({ type: "pulse", disable: true }));
    expect(config.devices[0]!.channels[0]!.outputs[0]).toEqual({ type: "pulse", disable: true });
  });
});

describe("parseRtlAirbandConfigBody new channel fields", () => {
  it("accepts squelch_threshold alongside squelch_snr_threshold, plus label/notch_q/highpass/lowpass/tau/disable", () => {
    const config = parseRtlAirbandConfigBody(
      minimalBody(
        {},
        {
          squelch_threshold: -30,
          squelch_snr_threshold: 12,
          label: "Tower",
          notch_q: 15.5,
          highpass: 200,
          lowpass: 3200,
          tau: 0,
          disable: true,
        }
      )
    );
    expect(config.devices[0]!.channels[0]!).toMatchObject({
      squelch_threshold: -30,
      squelch_snr_threshold: 12,
      label: "Tower",
      notch_q: 15.5,
      highpass: 200,
      lowpass: 3200,
      tau: 0,
      disable: true,
    });
  });
});

describe("parseRtlAirbandConfigBody scan mode channels", () => {
  function scanBody(channel: Record<string, unknown>, deviceOverrides: Record<string, unknown> = {}) {
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
          channels: [{ outputs: [{ type: "pulse" }], ...channel }],
          ...deviceOverrides,
        },
      ],
    };
  }

  it("accepts a scan channel with a scalar squelch_threshold", () => {
    const config = parseRtlAirbandConfigBody(
      scanBody({ freqs: [126_300_000, 121_500_000], squelch_threshold: -30 })
    );
    expect(config.devices[0]!.channels[0]).toMatchObject({ squelch_threshold: -30 });
  });

  it("accepts a scan channel with a per-frequency squelch_threshold list, including the 0 sentinel", () => {
    const config = parseRtlAirbandConfigBody(
      scanBody({ freqs: [126_300_000, 121_500_000, 128_225_000, 131_375_000], squelch_threshold: [-30, -25, 0, -35] })
    );
    expect(config.devices[0]!.channels[0]!.squelch_threshold).toEqual([-30, -25, 0, -35]);
  });

  it("accepts a scan channel with a per-frequency squelch_snr_threshold list, including the -1.0 sentinel", () => {
    const config = parseRtlAirbandConfigBody(
      scanBody({ freqs: [126_300_000, 121_500_000, 128_225_000, 131_375_000], squelch_snr_threshold: [30, 5, 0, -1.0] })
    );
    expect(config.devices[0]!.channels[0]!.squelch_snr_threshold).toEqual([30, 5, 0, -1.0]);
  });

  it("accepts modulations, labels, and list-valued ampfactor/ctcss/notch/notch_q/bandwidth", () => {
    const config = parseRtlAirbandConfigBody(
      scanBody({
        freqs: [126_300_000, 121_500_000],
        labels: ["Radar", "Emergency"],
        modulations: ["am", "nfm"],
        ampfactor: [1.0, 2.5],
        ctcss: [103.5, 0.0],
        notch: [136.5, 0.0],
        notch_q: [12.0, 10.0],
        bandwidth: [8000, 10000],
      })
    );
    expect(config.devices[0]!.channels[0]!).toMatchObject({
      labels: ["Radar", "Emergency"],
      modulations: ["am", "nfm"],
      ampfactor: [1.0, 2.5],
      ctcss: [103.5, 0.0],
      notch: [136.5, 0.0],
      notch_q: [12.0, 10.0],
      bandwidth: [8000, 10000],
    });
  });

  it("rejects a channel with neither freq nor freqs", () => {
    expect(() => parseRtlAirbandConfigBody(scanBody({}))).toThrow(ShapeValidationError);
  });

  it("rejects a channel with both freq and freqs", () => {
    expect(() => parseRtlAirbandConfigBody(scanBody({ freq: 100_000_000, freqs: [100_000_000] }))).toThrow(ShapeValidationError);
  });

  it("rejects an invalid device mode", () => {
    expect(() =>
      parseRtlAirbandConfigBody(scanBody({ freqs: [100_000_000] }, { mode: "bogus" }))
    ).toThrow(ShapeValidationError);
  });
});

describe("parseRtlAirbandConfigBody device fields", () => {
  it("does not require centerfreq or gain to be present at the shape layer (semantic validation handles that)", () => {
    const body = minimalBody();
    const device = body.devices[0] as Record<string, unknown>;
    delete device["centerfreq"];
    delete device["gain"];
    device["mode"] = "scan";
    (device["channels"] as Record<string, unknown>[])[0] = { freqs: [100_000_000], outputs: [{ type: "pulse" }] };
    const config = parseRtlAirbandConfigBody(body);
    expect(config.devices[0]!.centerfreq).toBeUndefined();
    expect(config.devices[0]!.gain).toBeUndefined();
  });

  it("accepts SoapySDR-specific fields: device_string, channel, antenna, and a string gain", () => {
    const body = minimalBody({
      type: "soapysdr",
      device_string: "driver=rtlsdr,serial=00000001",
      channel: 0,
      antenna: "RX",
      gain: "LNA=32,VGA=20",
    });
    delete (body.devices[0] as Record<string, unknown>)["serial"];
    const config = parseRtlAirbandConfigBody(body);
    expect(config.devices[0]!).toMatchObject({
      type: "soapysdr",
      device_string: "driver=rtlsdr,serial=00000001",
      channel: 0,
      antenna: "RX",
      gain: "LNA=32,VGA=20",
    });
  });

  it("accepts mode, disable, tau, buffers, and num_buffers", () => {
    const body = minimalBody({ mode: "multichannel", disable: true, tau: 100, buffers: 12, num_buffers: 8 });
    const config = parseRtlAirbandConfigBody(body);
    expect(config.devices[0]!).toMatchObject({ mode: "multichannel", disable: true, tau: 100, buffers: 12, num_buffers: 8 });
  });
});

describe("parseRtlAirbandConfigBody global fields and mixers", () => {
  it("accepts pidfile, log_scan_activity, shout_metadata_delay, and tau", () => {
    const body = minimalBody() as Record<string, unknown>;
    body["pidfile"] = "/var/tmp/rtl_airband.pid";
    body["log_scan_activity"] = true;
    body["shout_metadata_delay"] = 5;
    body["tau"] = 100;
    const config = parseRtlAirbandConfigBody(body);
    expect(config).toMatchObject({
      pidfile: "/var/tmp/rtl_airband.pid",
      log_scan_activity: true,
      shout_metadata_delay: 5,
      tau: 100,
    });
  });

  it("accepts a top-level mixers block and a mixer output referencing it", () => {
    const body = minimalBody({}, { outputs: [{ type: "mixer", name: "mix1" }] }) as Record<string, unknown>;
    body["mixers"] = [
      {
        name: "mix1",
        highpass: 200,
        lowpass: 3000,
        outputs: [{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "u", password: "p" }],
      },
    ];
    const config = parseRtlAirbandConfigBody(body);
    expect(config.mixers).toEqual([
      {
        name: "mix1",
        highpass: 200,
        lowpass: 3000,
        outputs: [{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "u", password: "p" }],
      },
    ]);
  });

  it("rejects a mixer whose own outputs include a nested mixer output", () => {
    const body = minimalBody() as Record<string, unknown>;
    body["mixers"] = [{ name: "mix1", outputs: [{ type: "mixer", name: "mix2" }] }];
    expect(() => parseRtlAirbandConfigBody(body)).toThrow(ShapeValidationError);
  });
});
