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

/** The optional frontend-only field an incoming output may carry -- see matchExistingOutput. */
type MatchIndexed = { _matchIndex?: number };

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

function stripMatchIndex<T extends object>(value: T): T {
  if (!("_matchIndex" in value)) return value;
  const clone = { ...value } as T & MatchIndexed;
  delete clone._matchIndex;
  return clone;
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
  return stripMatchIndex(out);
}

/**
 * Set on a duplicate/copy's `_matchIndex` (frontend/src/lib/keys.ts) instead
 * of leaving the field absent -- a duplicate has no on-disk counterpart, so
 * it must be distinguishable from a caller that simply never sends
 * `_matchIndex` at all (a hand-built API request, an older client), which
 * still needs the raw positional fallback below to behave as it always has.
 */
const NO_MATCH = -1;

/**
 * Finds the previous-config output to pair an incoming output against for
 * secret restoration. Outputs have no natural content-based identity (two
 * identical icecast outputs on one channel are legal, unlike a channel's
 * frequency), so this relies on `_matchIndex` -- the output's array
 * position at load time, stamped client-side and set to NO_MATCH on every
 * duplicate/copy, since restoring a duplicate's secret from whatever
 * happens to occupy its new position would silently steal an unrelated
 * output's password/api_key. A request that omits `_matchIndex` entirely
 * (no stamping done) falls back to raw positional pairing -- the only
 * behavior available before this fix, kept for callers that never send it.
 */
function matchExistingOutput(output: Output, oi: number, existingOutputs: Output[] | undefined): Output | undefined {
  if (!existingOutputs) return undefined;
  const matchIndex = (output as Output & MatchIndexed)._matchIndex;
  if (matchIndex === NO_MATCH) return undefined;
  if (matchIndex !== undefined && matchIndex >= 0 && matchIndex < existingOutputs.length) {
    return existingOutputs[matchIndex];
  }
  return existingOutputs[oi];
}

function restoreMixer(mixer: Mixer, existing: Mixer | undefined): Mixer {
  return { ...mixer, outputs: mixer.outputs.map((output, i) => restoreOutput(output, matchExistingOutput(output, i, existing?.outputs))) };
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

/** Stable key for matching a mixer across an edit — its name, which is real, referenced identity (MixerOutput.name), not synthetic. */
function mixerNameKey(mixer: Mixer): string {
  return mixer.name;
}

/**
 * Finds the previous-config mixer to pair an incoming mixer against for
 * secret restoration, keyed by name rather than raw array index so that
 * duplicating/removing a mixer (see ConfigEditor's mixer duplicate/remove
 * actions) doesn't splice the wrong mixer's outputs' secrets onto the wrong
 * mixer. "Duplicate mixer" already blanks the clone's name, so it never
 * uniquely matches and falls back to positional pairing, same as a
 * genuinely new mixer would.
 */
function matchExistingMixer(mixer: Mixer, mi: number, existingMixers: Mixer[] | undefined): Mixer | undefined {
  if (!existingMixers) return undefined;
  const key = mixerNameKey(mixer);
  const matches = existingMixers.filter((m) => mixerNameKey(m) === key);
  if (matches.length === 1) return matches[0];
  return existingMixers[mi];
}

/**
 * Applied to an incoming PUT/POST body before validation, paired against the
 * config currently on disk (or `undefined` for a brand-new instance, where
 * there's nothing to restore). Only ever replaces a field that's still
 * exactly the redaction sentinel — anything the user actually typed passes
 * through untouched. Channels are paired by frequency (matchExistingChannel)
 * so reordering channels doesn't misattribute secrets; outputs (within a
 * channel or a mixer) are paired by client-stamped `_matchIndex`
 * (matchExistingOutput), and mixers by name (matchExistingMixer) — both
 * needed once "Duplicate"/"Copy to channel…"/"Remove" could shift an
 * output's or mixer's array position out from under a naive index pairing.
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
          outputs: channel.outputs.map((output, oi) => restoreOutput(output, matchExistingOutput(output, oi, existingChannel?.outputs))),
        };
      }),
    };
  });
  if (incoming.mixers === undefined) return { ...incoming, devices };
  return {
    ...incoming,
    devices,
    mixers: incoming.mixers.map((mixer, mi) => restoreMixer(mixer, matchExistingMixer(mixer, mi, existing?.mixers))),
  };
}
