import type { Channel, Mixer, Output, RtlAirbandConfig } from "@rtl-airband-panel/parser";

/**
 * GET /instances/:name returns the whole config verbatim, which previously
 * included Icecast passwords and rdio-scanner API keys in plaintext — visible
 * to anyone who can reach the API (there's no auth layer), and liable to end
 * up in browser history, dev-tools network tabs, or server access logs.
 *
 * This sentinel is substituted for those two fields on the way out, and
 * substituted back for the real on-disk value on the way back in (see
 * `restoreSecrets`) as long as the client echoes it back unchanged — which is
 * exactly what happens when a user edits some other field and saves without
 * touching the password/key field. This is defense-in-depth against
 * incidental exposure, not a substitute for real authentication: anyone who
 * can issue the same requests the frontend does can still recover a secret
 * by setting a new value and reading it back.
 */
export const REDACTED_SECRET = "••••••••";

// Generic over T so a mixer's output list (Exclude<Output, MixerOutput>[]) round-trips
// as that same narrowed type — these never change an output's `type`, only fields
// nested inside the icecast/rdio-scanner branches, so the input/output shape matches.
function redactOutput<T extends Output>(output: T): T {
  if (output.type === "icecast") {
    return { ...output, password: REDACTED_SECRET };
  }
  if (output.type === "file" && output.rdio_scanner !== undefined) {
    return { ...output, rdio_scanner: { ...output.rdio_scanner, api_key: REDACTED_SECRET } };
  }
  return output;
}

function redactMixer(mixer: Mixer): Mixer {
  return { ...mixer, outputs: mixer.outputs.map(redactOutput) };
}

/** Applied to every config returned from a GET endpoint. */
export function redactSecrets(config: RtlAirbandConfig): RtlAirbandConfig {
  const devices = config.devices.map((device) => ({
    ...device,
    channels: device.channels.map((channel) => ({ ...channel, outputs: channel.outputs.map(redactOutput) })),
  }));
  return config.mixers === undefined ? { ...config, devices } : { ...config, devices, mixers: config.mixers.map(redactMixer) };
}

function restoreOutput<T extends Output>(incoming: T, existing: Output | undefined): T {
  let out = incoming;
  if (out.type === "icecast" && out.password === REDACTED_SECRET) {
    const previous = existing?.type === "icecast" ? existing.password : "";
    out = { ...out, password: previous };
  }
  if (out.type === "file" && out.rdio_scanner?.api_key === REDACTED_SECRET) {
    const previous = existing?.type === "file" ? (existing.rdio_scanner?.api_key ?? "") : "";
    out = { ...out, rdio_scanner: { ...out.rdio_scanner, api_key: previous } };
  }
  return out;
}

function restoreMixer(mixer: Mixer, existing: Mixer | undefined): Mixer {
  return { ...mixer, outputs: mixer.outputs.map((output, i) => restoreOutput(output, existing?.outputs[i])) };
}

/** Stable key for matching a channel across a client-side reorder — its frequency, the one thing that survives an array-position shuffle. */
function channelFreqKey(channel: Channel): string {
  return "freqs" in channel ? `fs:${channel.freqs.join(",")}` : `f:${channel.freq}`;
}

/**
 * Finds the previous-config channel to pair an incoming channel against for
 * secret restoration, keyed by frequency rather than raw array index so that
 * dragging channels into a new order (see channel drag-and-drop reordering)
 * doesn't splice the wrong channel's secret onto the wrong channel. Falls
 * back to positional pairing whenever a frequency key isn't uniquely
 * resolvable -- a genuinely new channel with no match, or two channels
 * sharing the same frequency (legal, e.g. differing CTCSS tones), where the
 * key alone can't disambiguate.
 */
function matchExistingChannel(channel: Channel, ci: number, existingChannels: Channel[] | undefined): Channel | undefined {
  if (!existingChannels) return undefined;
  const key = channelFreqKey(channel);
  const matches = existingChannels.filter((c) => channelFreqKey(c) === key);
  if (matches.length === 1) return matches[0];
  return existingChannels[ci];
}

/**
 * Applied to an incoming PUT/POST body before validation, paired against the
 * config currently on disk (or `undefined` for a brand-new instance, where
 * there's nothing to restore). Only ever replaces a field that's still
 * exactly the redaction sentinel — anything the user actually typed passes
 * through untouched. Channels are paired by frequency (see
 * matchExistingChannel) rather than raw index so reordering channels doesn't
 * misattribute secrets; outputs within a channel are still paired by
 * position, since outputs are never reordered independently of their
 * channel. Mixers are paired by position too — mixers aren't reorderable.
 */
export function restoreSecrets(incoming: RtlAirbandConfig, existing: RtlAirbandConfig | undefined): RtlAirbandConfig {
  const devices = incoming.devices.map((device, di) => {
    const existingDevice = existing?.devices[di];
    return {
      ...device,
      channels: device.channels.map((channel, ci) => {
        const existingChannel = matchExistingChannel(channel, ci, existingDevice?.channels);
        return {
          ...channel,
          outputs: channel.outputs.map((output, oi) => restoreOutput(output, existingChannel?.outputs[oi])),
        };
      }),
    };
  });
  if (incoming.mixers === undefined) return { ...incoming, devices };
  return { ...incoming, devices, mixers: incoming.mixers.map((mixer, mi) => restoreMixer(mixer, existing?.mixers?.[mi])) };
}
