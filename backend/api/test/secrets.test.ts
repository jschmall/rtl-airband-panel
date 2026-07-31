import { describe, expect, it } from "vitest";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { REDACTED_SECRET, redactSecrets, restoreSecrets } from "../src/secrets.js";

function configWithOutputs(outputs: RtlAirbandConfig["devices"][number]["channels"][number]["outputs"]): RtlAirbandConfig {
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
        channels: [{ freq: 100_000_000, afc: 0, modulation: "nfm", outputs }],
      },
    ],
  };
}

/** Simulates frontend/src/lib/keys.ts's `_matchIndex` stamp -- a plain field the production types don't declare, so it needs a cast like config-shape.ts's own read of it does. */
function withMatchIndex<T extends object>(output: T, matchIndex: number): T {
  return { ...output, _matchIndex: matchIndex } as T;
}

function configWithMixers(mixers: NonNullable<RtlAirbandConfig["mixers"]>): RtlAirbandConfig {
  return { ...configWithOutputs([]), mixers };
}

function configWithChannels(channels: RtlAirbandConfig["devices"][number]["channels"]): RtlAirbandConfig {
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
        channels,
      },
    ],
  };
}

describe("redactSecrets", () => {
  it("masks an icecast output's password", () => {
    const config = configWithOutputs([{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "hunter2" }]);
    const redacted = redactSecrets(config);
    expect(redacted.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ password: REDACTED_SECRET });
  });

  it("masks a file output's rdio_scanner api_key", () => {
    const config = configWithOutputs([
      {
        type: "file",
        directory: "/tmp",
        filename_template: "x",
        rdio_scanner: { server: "s", port: 443, api_key: "supersecretkey", talkgroup_id: 1 },
      },
    ]);
    const redacted = redactSecrets(config);
    const output = redacted.devices[0]!.channels[0]!.outputs[0];
    expect(output.type).toBe("file");
    expect(output.type === "file" ? output.rdio_scanner?.api_key : undefined).toBe(REDACTED_SECRET);
  });

  it("leaves non-secret fields and other output types untouched", () => {
    const config = configWithOutputs([{ type: "pulse", server: "10.0.0.1", sink: "s", stream_name: "s", continuous: false }]);
    expect(redactSecrets(config)).toEqual(config);
  });

  it("redacts secrets on top-level mixer outputs too", () => {
    const config: RtlAirbandConfig = {
      ...configWithOutputs([]),
      mixers: [{ name: "mix1", outputs: [{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "hunter2" }] }],
    };
    const redacted = redactSecrets(config);
    expect(redacted.mixers![0]!.outputs[0]).toMatchObject({ password: REDACTED_SECRET });
  });
});

describe("restoreSecrets", () => {
  it("restores the previous password when the incoming value is still the sentinel", () => {
    const existing = configWithOutputs([{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "hunter2" }]);
    const incoming = configWithOutputs([{ type: "icecast", server: "s2", port: 8000, mountpoint: "/m", username: "source", password: REDACTED_SECRET }]);

    const restored = restoreSecrets(incoming, existing);
    const output = restored.devices[0]!.channels[0]!.outputs[0];
    expect(output).toMatchObject({ server: "s2", password: "hunter2" });
  });

  it("keeps a genuinely new password the user typed, even if paired with an existing value", () => {
    const existing = configWithOutputs([{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "hunter2" }]);
    const incoming = configWithOutputs([{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "new-password" }]);

    const restored = restoreSecrets(incoming, existing);
    expect(restored.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ password: "new-password" });
  });

  it("restores rdio_scanner api_key by position, not by output type match alone", () => {
    const existing = configWithOutputs([
      { type: "file", directory: "/tmp", filename_template: "x", rdio_scanner: { server: "s", port: 443, api_key: "realkey", talkgroup_id: 1 } },
    ]);
    const incoming = configWithOutputs([
      { type: "file", directory: "/tmp", filename_template: "y", rdio_scanner: { server: "s", port: 443, api_key: REDACTED_SECRET, talkgroup_id: 1 } },
    ]);

    const restored = restoreSecrets(incoming, existing);
    const output = restored.devices[0]!.channels[0]!.outputs[0];
    expect(output.type === "file" ? output.rdio_scanner?.api_key : undefined).toBe("realkey");
  });

  it("drops the sentinel to an empty string when there's no existing config to restore from (new instance)", () => {
    const incoming = configWithOutputs([{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: REDACTED_SECRET }]);

    const restored = restoreSecrets(incoming, undefined);
    expect(restored.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ password: "" });
  });

  it("restores the correct password after channels are reordered (matched by frequency, not array index)", () => {
    const icecastOutput = (password: string): RtlAirbandConfig["devices"][number]["channels"][number]["outputs"][number] => ({
      type: "icecast",
      server: "s",
      port: 8000,
      mountpoint: "/m",
      username: "source",
      password,
    });
    const existing = configWithChannels([
      { freq: 100_000_000, afc: 0, modulation: "nfm", outputs: [icecastOutput("pwA")] },
      { freq: 200_000_000, afc: 0, modulation: "nfm", outputs: [icecastOutput("pwB")] },
    ]);
    // Client reordered the channels (B first, A second) and echoed back the redacted sentinel for both.
    const incoming = configWithChannels([
      { freq: 200_000_000, afc: 0, modulation: "nfm", outputs: [icecastOutput(REDACTED_SECRET)] },
      { freq: 100_000_000, afc: 0, modulation: "nfm", outputs: [icecastOutput(REDACTED_SECRET)] },
    ]);

    const restored = restoreSecrets(incoming, existing);
    expect(restored.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ password: "pwB" });
    expect(restored.devices[0]!.channels[1]!.outputs[0]).toMatchObject({ password: "pwA" });
  });

  it("falls back to positional pairing when two channels share a frequency", () => {
    const icecastOutput = (password: string): RtlAirbandConfig["devices"][number]["channels"][number]["outputs"][number] => ({
      type: "icecast",
      server: "s",
      port: 8000,
      mountpoint: "/m",
      username: "source",
      password,
    });
    const existing = configWithChannels([
      { freq: 100_000_000, ctcss: 100, afc: 0, modulation: "nfm", outputs: [icecastOutput("pwA")] },
      { freq: 100_000_000, ctcss: 200, afc: 0, modulation: "nfm", outputs: [icecastOutput("pwB")] },
    ]);
    const incoming = configWithChannels([
      { freq: 100_000_000, ctcss: 100, afc: 0, modulation: "nfm", outputs: [icecastOutput(REDACTED_SECRET)] },
      { freq: 100_000_000, ctcss: 200, afc: 0, modulation: "nfm", outputs: [icecastOutput(REDACTED_SECRET)] },
    ]);

    const restored = restoreSecrets(incoming, existing);
    expect(restored.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ password: "pwA" });
    expect(restored.devices[0]!.channels[1]!.outputs[0]).toMatchObject({ password: "pwB" });
  });

  it("restores secrets for scan-mode channels keyed by their freqs list", () => {
    const icecastOutput = (password: string): RtlAirbandConfig["devices"][number]["channels"][number]["outputs"][number] => ({
      type: "icecast",
      server: "s",
      port: 8000,
      mountpoint: "/m",
      username: "source",
      password,
    });
    const existing = configWithChannels([{ freqs: [100_000_000, 200_000_000, 300_000_000], outputs: [icecastOutput("scankey")] }]);
    const incoming = configWithChannels([{ freqs: [100_000_000, 200_000_000, 300_000_000], outputs: [icecastOutput(REDACTED_SECRET)] }]);

    const restored = restoreSecrets(incoming, existing);
    expect(restored.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ password: "scankey" });
  });

  it("keeps the original's and a later output's passwords intact -- and blanks the duplicate's -- when a duplicate is inserted between them", () => {
    const icecastOutput = (password: string) => ({ type: "icecast" as const, server: "s", port: 8000, mountpoint: "/m", username: "source", password });
    const existing = configWithOutputs([icecastOutput("pwA"), icecastOutput("pwB")]);
    // Client duplicated output A (inserted right after it), shifting B from index 1 to index 2.
    const incoming = configWithOutputs([
      withMatchIndex(icecastOutput(REDACTED_SECRET), 0), // A
      withMatchIndex(icecastOutput(REDACTED_SECRET), -1), // A's duplicate -- no on-disk counterpart
      withMatchIndex(icecastOutput(REDACTED_SECRET), 1), // B, shifted to index 2
    ]);

    const restored = restoreSecrets(incoming, existing);
    const outputs = restored.devices[0]!.channels[0]!.outputs;
    expect(outputs[0]).toMatchObject({ password: "pwA" });
    expect(outputs[1]).toMatchObject({ password: "" });
    expect(outputs[2]).toMatchObject({ password: "pwB" });
  });

  it("keeps the remaining output's password intact after an earlier output is removed", () => {
    const icecastOutput = (password: string) => ({ type: "icecast" as const, server: "s", port: 8000, mountpoint: "/m", username: "source", password });
    const existing = configWithOutputs([icecastOutput("pwA"), icecastOutput("pwB")]);
    // Client removed output A -- B is now at index 0 but still carries its original load-time index (1).
    const incoming = configWithOutputs([withMatchIndex(icecastOutput(REDACTED_SECRET), 1)]);

    const restored = restoreSecrets(incoming, existing);
    expect(restored.devices[0]!.channels[0]!.outputs[0]).toMatchObject({ password: "pwB" });
  });

  it("matches a mixer by name (not array index) and blanks a duplicated mixer's secret, not steal the original's", () => {
    const icecastOutput = (password: string) => ({ type: "icecast" as const, server: "s", port: 8000, mountpoint: "/m", username: "source", password });
    const existing = configWithMixers([{ name: "mix1", outputs: [icecastOutput("pwMix")] }]);
    // Client duplicated the mixer (clone's name is blanked, matching the app's own "Duplicate mixer" behavior).
    const incoming = configWithMixers([
      { name: "mix1", outputs: [withMatchIndex(icecastOutput(REDACTED_SECRET), 0)] },
      { name: "", outputs: [withMatchIndex(icecastOutput(REDACTED_SECRET), -1)] },
    ]);

    const restored = restoreSecrets(incoming, existing);
    expect(restored.mixers![0]!.outputs[0]).toMatchObject({ password: "pwMix" });
    expect(restored.mixers![1]!.outputs[0]).toMatchObject({ password: "" });
  });

  it("strips _matchIndex from the restored output so it never reaches validation/serialization", () => {
    const existing = configWithOutputs([{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "pwA" }]);
    const incoming = configWithOutputs([
      withMatchIndex({ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: REDACTED_SECRET }, 0),
    ]);

    const restored = restoreSecrets(incoming, existing);
    expect(restored.devices[0]!.channels[0]!.outputs[0]).not.toHaveProperty("_matchIndex");
  });
});
