import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { isMultichannelChannel } from "./channel-targets.js";

export interface MixerLookups {
  /** Numeric mixer index as it appears in stats labels (mixer="0") -> mixer name. */
  mixerNames: Map<string, string>;
  /** "mixerIndex:inputIndex" (as they appear in input_overrun_count's labels) -> the feeding channel's display label. */
  inputChannels: Map<string, string>;
  /** "deviceIndex:channelIndex" (as they appear in device/channel-scoped output counters' labels) -> that channel's Output stats group title. */
  deviceChannels: Map<string, string>;
}

/**
 * RTLSDR-Airband's stats file identifies mixers and mixer inputs by
 * position, not name: `mixer="N"` is the mixer's index among *enabled*
 * top-level mixers in file order, and `input="N"` is the index among that
 * mixer's inbound inputs, also in connection order -- disabled
 * devices/channels/outputs/mixers are skipped entirely and never consume an
 * index (config.cpp's parse_mixers / mixer_connect_input). Critically,
 * `parse_mixers()` runs BEFORE `parse_devices()` (verified against the
 * fork's rtl_airband.cpp), and a mixer's `remote_inputs` entries connect via
 * mixer_connect_input() *inside* parse_mixers() -- so for any mixer with
 * remote_inputs, those entries always claim input indices `0..N-1` first,
 * and channel-routed "mixer"-type outputs (connected later, during
 * parse_devices()) start counting from `remote_inputs.length`, not 0.
 * This rebuilds that same numbering from the JSON model so stats tiles can
 * show the mixer name and feeding channel/remote input instead of bare
 * indices.
 */
export function buildMixerLookups(config: RtlAirbandConfig): MixerLookups {
  const mixerNames = new Map<string, string>();
  const inputIndexByMixerName = new Map<string, number>();
  const mixerIndexByName = new Map<string, number>();

  const inputChannels = new Map<string, string>();

  (config.mixers ?? [])
    .filter((mixer) => !mixer.disable)
    .forEach((mixer, mixerIndex) => {
      mixerNames.set(String(mixerIndex), mixer.name);
      mixerIndexByName.set(mixer.name, mixerIndex);

      const remoteInputs = mixer.remote_inputs ?? [];
      remoteInputs.forEach((remoteInput, remoteInputIndex) => {
        inputChannels.set(`${mixerIndex}:${remoteInputIndex}`, remoteInput.label ?? `Remote input (stream ${remoteInput.stream_id})`);
      });
      inputIndexByMixerName.set(mixer.name, remoteInputs.length);
    });

  config.devices.forEach((device, deviceIndex) => {
    if (device.disable) return;
    device.channels.forEach((channel) => {
      if (channel.disable) return;
      const channelLabel = isMultichannelChannel(channel)
        ? `${(channel.freq / 1e6).toFixed(4)} MHz${channel.label ? ` — ${channel.label}` : ""}`
        : `Scan channel (Device ${deviceIndex} — ${device.type})`;

      channel.outputs.forEach((output) => {
        if (output.disable || output.type !== "mixer") return;
        const mixerIndex = mixerIndexByName.get(output.name);
        if (mixerIndex === undefined) return; // references a disabled/unknown mixer -- flagged separately by validation

        const inputIndex = inputIndexByMixerName.get(output.name) ?? 0;
        inputIndexByMixerName.set(output.name, inputIndex + 1);
        inputChannels.set(`${mixerIndex}:${inputIndex}`, channelLabel);
      });
    });
  });

  const deviceChannels = new Map<string, string>();
  config.devices
    .filter((device) => !device.disable)
    .forEach((device, deviceIndex) => {
      let channelIndex = 0;
      device.channels.forEach((channel) => {
        if (channel.disable) return;
        const label = isMultichannelChannel(channel) && channel.label ? channel.label : `Channel ${channelIndex + 1}`;
        deviceChannels.set(`${deviceIndex}:${channelIndex}`, label);
        channelIndex += 1;
      });
    });

  return { mixerNames, inputChannels, deviceChannels };
}

/**
 * Renders an Output stats device-channel group's title: the channel's own
 * configured label when it has one, otherwise "Channel N" by position among
 * that device's enabled channels (1-indexed) -- never the raw device/channel
 * indices RTLSDR-Airband uses internally, which aren't meaningful to a user.
 */
export function resolveDeviceChannelLabel(device: string, channel: string, lookups: MixerLookups): string | undefined {
  return lookups.deviceChannels.get(`${device}:${channel}`);
}

/**
 * Renders a device/mixer stat tile's sublabel with `mixer`/`input` indices
 * resolved to the mixer name and feeding channel, for the two metrics that
 * carry them (input_overrun_count, output_overrun_count). Returns
 * undefined for every other metric, so callers fall back to their default
 * (index-based) label formatting.
 */
export function resolveMixerSampleLabel(metric: string, labels: Record<string, string>, lookups: MixerLookups): string | undefined {
  const mixerIndex = labels["mixer"];
  if (mixerIndex === undefined) return undefined;
  const mixerName = lookups.mixerNames.get(mixerIndex) ?? mixerIndex;

  if (metric === "input_overrun_count") {
    const inputIndex = labels["input"];
    if (inputIndex === undefined) return undefined;
    const channel = lookups.inputChannels.get(`${mixerIndex}:${inputIndex}`);
    return channel ? `${mixerName} — ${channel}` : `Mixer ${mixerName}, Input ${inputIndex}`;
  }
  if (metric === "output_overrun_count") return `Mixer ${mixerName}`;
  return undefined;
}
