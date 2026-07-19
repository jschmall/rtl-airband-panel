import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";
import { DEFAULT_SAMPLE_RATE_HZ } from "../rtlsdr-defaults.js";

/** RTLSDR-Airband's own soft threshold (config.cpp, warn_if_freq_not_in_range). */
const SOFT_BW_THRESHOLD = 0.9;

/**
 * Warns (not errors — RTLSDR-Airband itself only logs a warning and keeps
 * running) when a channel's frequency sits outside the SDR's realistically
 * usable capture bandwidth around its device's centerfreq.
 */
export function checkFrequencyWindow(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    const sampleRate = device.sample_rate ?? DEFAULT_SAMPLE_RATE_HZ;
    const bwLimit = (sampleRate / 2) * SOFT_BW_THRESHOLD;
    device.channels.forEach((channel, ci) => {
      const offset = Math.abs(channel.freq - device.centerfreq);
      if (offset < bwLimit) return;
      issues.push({
        severity: "warning",
        code: "frequency-out-of-window",
        path: `$.devices[${di}].channels[${ci}]`,
        message:
          `channel frequency ${channel.freq} Hz is outside of the SDR's usable operating bandwidth ` +
          `(${device.centerfreq - bwLimit}-${device.centerfreq + bwLimit} Hz around centerfreq ${device.centerfreq} Hz)`,
      });
    });
  });

  return issues;
}
