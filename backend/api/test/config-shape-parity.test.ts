import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConfigFile, type RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { parseRtlAirbandConfigBody } from "../src/config-shape.js";
import { FIXTURE_PATH } from "./helpers.js";

function roundTripThroughShapeParser(config: RtlAirbandConfig): RtlAirbandConfig {
  const asJsonBody: unknown = JSON.parse(JSON.stringify(config));
  return parseRtlAirbandConfigBody(asJsonBody);
}

/**
 * config-shape.ts (validates an HTTP JSON body) and backend/parser's
 * mapper.ts (parses/serializes the .conf file) are two independently
 * hand-written structural walks over the same domain model — nothing
 * mechanically keeps them in sync, so a field added to the domain type and
 * wired into mapper.ts but forgotten in config-shape.ts would round-trip
 * fine through file I/O while silently getting rejected or dropped the
 * moment it arrives over the API. That drift wouldn't show up in any
 * existing test, since parser's own round-trip tests never go through
 * config-shape.ts, and config-shape's own tests use hand-written fixtures
 * that only exercise what its author remembered to write.
 *
 * This closes that gap the cheap way: take the real fixture — which
 * exercises every field mapper.ts actually knows how to parse — through
 * config-shape.ts as if it arrived as a PUT body, and confirm nothing was
 * dropped or altered. If a future field lands in mapper.ts/domain.ts and the
 * fixture is extended to cover it, but config-shape.ts isn't updated, this
 * test fails immediately instead of the gap surviving to production.
 */
describe("config-shape.ts / mapper.ts parity", () => {
  it("round-trips the real fixture through parseRtlAirbandConfigBody with no field dropped or altered", () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const parsed = parseConfigFile(source);
    expect(roundTripThroughShapeParser(parsed)).toEqual(parsed);
  });

  // The real fixture only covers rtlsdr devices with pulse/file outputs (see
  // project memory on narrow fixture coverage) — this hand-built config covers
  // the fields it doesn't: icecast (incl. TLS), rdio_scanner, mixers, and
  // scan-mode devices with per-frequency list values.
  it("round-trips a config covering icecast/rdio_scanner/mixers/scan-mode with no field dropped or altered", () => {
    const config: RtlAirbandConfig = {
      multiple_demod_threads: true,
      multiple_output_threads: false,
      stats_filepath: "/tmp/stats.txt",
      localtime: false,
      fft_size: 1024,
      pidfile: "/run/rtl_airband.pid",
      log_scan_activity: true,
      shout_metadata_delay: 5,
      tau: 75,
      devices: [
        {
          type: "rtlsdr",
          serial: "12345",
          gain: 29.6,
          centerfreq: 151_000_000,
          sample_rate: 2_560_000,
          correction: 5,
          tau: 50,
          buffers: 12,
          channels: [
            {
              freq: 151_100_000,
              label: "Ch 1",
              modulation: "am",
              afc: 1,
              bandwidth: 8000,
              ampfactor: 1.5,
              ctcss: 103.5,
              notch: 1200,
              notch_q: 8,
              squelch_snr_threshold: 10,
              tau: 25,
              outputs: [
                { type: "icecast", server: "icecast.example", port: 8000, mountpoint: "/ch1", username: "source", password: "hunter2", tls: "transport" },
                {
                  type: "file",
                  directory: "/tmp/rec",
                  filename_template: "ch1",
                  split_on_transmission: true,
                  rdio_scanner: {
                    server: "rdio.example",
                    port: 3000,
                    use_tls: false,
                    api_key: "secret-key",
                    talkgroup_id: 1,
                    system_id: 2,
                    system_label: "Sys",
                    talkgroup_label: "TG",
                    talkgroup_tag: "Tag",
                    talkgroup_group: "Group",
                    source_id: 3,
                    delete_after_upload: true,
                    timeout_ms: 4000,
                    max_retries: 3,
                  },
                },
                { type: "mixer", name: "mix1", ampfactor: 0.8, balance: -0.5 },
              ],
            },
          ],
        },
        {
          type: "soapysdr",
          device_string: "driver=rtlsdr,serial=00000001",
          channel: 0,
          antenna: "RX",
          gain: "LNA=32,VGA=20",
          sample_rate: 2_560_000,
          correction: 0,
          mode: "scan",
          channels: [
            {
              freqs: [151_200_000, 151_300_000],
              labels: ["a", "b"],
              modulations: ["am", "nfm"],
              bandwidth: [8000, 9000],
              ampfactor: 1,
              ctcss: [0, 103.5],
              notch: [0, 1500],
              notch_q: 10,
              squelch_threshold: [-30, -25],
              highpass: 200,
              lowpass: 3000,
              outputs: [{ type: "udp_stream", dest_address: "10.0.0.5", dest_port: "5005", bit_depth: 16, continuous: true }],
            },
          ],
        },
        {
          type: "mirisdr",
          serial: "9",
          gain: 20,
          centerfreq: 150_000_000,
          sample_rate: 1_600_000,
          correction: -3,
          num_buffers: 8,
          channels: [{ freq: 150_050_000, modulation: "nfm", afc: 0, outputs: [{ type: "rawfile", directory: "/tmp/raw", filename_template: "raw1", append: false }] }],
        },
      ],
      mixers: [
        {
          name: "mix1",
          highpass: 100,
          lowpass: 2800,
          outputs: [{ type: "icecast", server: "mix.example", port: 8001, mountpoint: "/mix", username: "source", password: "mixpw" }],
        },
      ],
    };

    expect(roundTripThroughShapeParser(config)).toEqual(config);
  });
});
