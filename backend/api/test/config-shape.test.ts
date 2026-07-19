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
});
