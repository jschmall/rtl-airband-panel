import type { Channel, Device, MultichannelChannel, ScanChannel } from "@rtl-airband-panel/parser";

export function isMultichannelChannel(channel: Channel): channel is MultichannelChannel {
  return "freq" in channel;
}

export function isScanChannel(channel: Channel): channel is ScanChannel {
  return "freqs" in channel;
}

/** A channel an output can be copied to -- see OutputEditor's "Copy to channel…" action. */
export interface ChannelTarget {
  deviceIndex: number;
  channelIndex: number;
  label: string;
}

/**
 * Flattens every copy-able channel across all devices, for the "Copy to
 * channel…" target dropdown. A scan-mode device has exactly one channel
 * (its ScanChannel, at index 0) with no single frequency of its own, so it
 * gets a distinct label instead of the frequency-based one used for
 * multichannel channels.
 */
export function buildChannelTargets(devices: Device[]): ChannelTarget[] {
  const targets: ChannelTarget[] = [];
  devices.forEach((device, deviceIndex) => {
    if (device.mode === "scan") {
      const scanChannel = device.channels.find(isScanChannel);
      if (!scanChannel) return;
      targets.push({ deviceIndex, channelIndex: 0, label: `Scan channel (Device ${deviceIndex} — ${device.type})` });
      return;
    }
    device.channels.forEach((channel, channelIndex) => {
      if (!isMultichannelChannel(channel)) return;
      const freqLabel = `${(channel.freq / 1e6).toFixed(4)} MHz${channel.label ? ` — ${channel.label}` : ""}`;
      targets.push({ deviceIndex, channelIndex, label: `${freqLabel} (Device ${deviceIndex})` });
    });
  });
  return targets;
}
