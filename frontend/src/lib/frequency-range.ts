import type { Device } from "@rtl-airband-panel/parser";
import { DEFAULT_SAMPLE_RATE_HZ, SOFT_BW_THRESHOLD } from "@rtl-airband-panel/validate";
import { isMultichannelChannel, isScanChannel } from "./channel-targets.js";

export interface FrequencyRangeHz {
  min: number;
  max: number;
}

/**
 * Lowest/highest configured channel frequency for a device, in Hz -- an
 * at-a-glance view of how much of the device's usable window is already
 * occupied, useful when deciding where to add a new channel. For a scan
 * device this covers every frequency in its scan list. Undefined if the
 * device has no channels yet.
 */
export function channelFrequencyRangeHz(device: Device): FrequencyRangeHz | undefined {
  const freqs =
    device.mode === "scan"
      ? device.channels.filter(isScanChannel).flatMap((channel) => channel.freqs)
      : device.channels.filter(isMultichannelChannel).map((channel) => channel.freq);
  if (freqs.length === 0) return undefined;
  return { min: Math.min(...freqs), max: Math.max(...freqs) };
}

/**
 * The SDR's realistically usable capture window around centerfreq, mirroring
 * backend/validate's checkFrequencyWindow (same SOFT_BW_THRESHOLD and
 * DEFAULT_SAMPLE_RATE_HZ fallback) so this can never disagree with what that
 * check will actually flag. Undefined for a scan-mode device (the dongle
 * retunes to each scanned frequency in turn, so there's no fixed capture
 * window -- same reason checkFrequencyWindow itself skips scan devices) or
 * one with no centerfreq set yet.
 */
export function deviceUsableWindowHz(device: Device): FrequencyRangeHz | undefined {
  if (device.mode === "scan" || device.centerfreq === undefined) return undefined;
  const sampleRate = device.sample_rate ?? DEFAULT_SAMPLE_RATE_HZ;
  const bwLimit = (sampleRate / 2) * SOFT_BW_THRESHOLD;
  return { min: device.centerfreq - bwLimit, max: device.centerfreq + bwLimit };
}
