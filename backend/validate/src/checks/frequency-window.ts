import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";
import { DEFAULT_SAMPLE_RATE_HZ } from "../rtlsdr-defaults.js";

/** RTLSDR-Airband's own soft threshold (config.cpp, warn_if_freq_not_in_range). */
const SOFT_BW_THRESHOLD = 0.9;

/**
 * Warns (not errors — RTLSDR-Airband itself only logs a warning and keeps
 * running) when a channel's frequency sits outside the SDR's realistically
 * usable capture bandwidth around its device's centerfreq.
 *
 * Does not apply to scan-mode devices: the dongle retunes its centerfreq to
 * each scanned frequency in turn, so there's no fixed capture window to
 * check a frequency against.
 */
export function checkFrequencyWindow(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    if (device.mode === "scan" || device.centerfreq === undefined) return;
    const centerfreq = device.centerfreq;
    const sampleRate = device.sample_rate ?? DEFAULT_SAMPLE_RATE_HZ;
    const bwLimit = (sampleRate / 2) * SOFT_BW_THRESHOLD;
    device.channels.forEach((channel, ci) => {
      if (!("freq" in channel)) return;
      const offset = Math.abs(channel.freq - centerfreq);
      if (offset < bwLimit) return;
      issues.push({
        severity: "warning",
        code: "frequency-out-of-window",
        path: `$.devices[${di}].channels[${ci}]`,
        message:
          `channel frequency ${channel.freq} Hz is outside of the SDR's usable operating bandwidth ` +
          `(${centerfreq - bwLimit}-${centerfreq + bwLimit} Hz around centerfreq ${centerfreq} Hz)`,
      });
    });
  });

  return issues;
}
