import type { Channel, RtlAirbandConfig, ScanChannel } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

function isScanChannel(channel: Channel): channel is ScanChannel {
  return "freqs" in channel;
}

/**
 * Enforces RTLSDR-Airband's scan-mode structural rules (General configuration
 * file structure / Configuring channels for scan mode):
 *  - a device in scan mode must have exactly one channel entry, and it must
 *    use `freqs` rather than `freq`;
 *  - a device NOT in scan mode must not contain a `freqs`-shaped channel;
 *  - any per-frequency list field (labels, modulations, ampfactor, ctcss,
 *    notch, notch_q, bandwidth, squelch_threshold, squelch_snr_threshold)
 *    must have at least as many entries as `freqs`.
 */
export function checkScanMode(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    const devicePath = `$.devices[${di}]`;
    const scanChannelCount = device.channels.filter(isScanChannel).length;

    if (device.mode === "scan") {
      if (device.channels.length !== 1) {
        issues.push({
          severity: "error",
          code: "scan-mode-single-channel",
          path: devicePath,
          message: `device is in scan mode but has ${device.channels.length} channel entries; scan mode allows exactly one`,
        });
      }
      if (scanChannelCount !== device.channels.length) {
        issues.push({
          severity: "error",
          code: "scan-mode-channel-shape-mismatch",
          path: devicePath,
          message: `device is in scan mode but its channel uses 'freq' instead of 'freqs'`,
        });
      }
    } else if (scanChannelCount > 0) {
      issues.push({
        severity: "error",
        code: "scan-mode-channel-shape-mismatch",
        path: devicePath,
        message: `device has a channel using 'freqs' (scan mode) but the device's mode is not "scan"`,
      });
    }

    device.channels.forEach((channel, ci) => {
      if (!isScanChannel(channel)) return;
      const channelPath = `${devicePath}.channels[${ci}]`;
      const freqCount = channel.freqs.length;
      checkListLength(issues, channelPath, "labels", channel.labels, freqCount);
      checkListLength(issues, channelPath, "modulations", channel.modulations, freqCount);
      checkListLength(issues, channelPath, "ampfactor", asList(channel.ampfactor), freqCount);
      checkListLength(issues, channelPath, "ctcss", asList(channel.ctcss), freqCount);
      checkListLength(issues, channelPath, "notch", asList(channel.notch), freqCount);
      checkListLength(issues, channelPath, "notch_q", asList(channel.notch_q), freqCount);
      checkListLength(issues, channelPath, "bandwidth", asList(channel.bandwidth), freqCount);
      checkListLength(issues, channelPath, "squelch_threshold", asList(channel.squelch_threshold), freqCount);
      checkListLength(issues, channelPath, "squelch_snr_threshold", asList(channel.squelch_snr_threshold), freqCount);
    });
  });

  return issues;
}

function asList<T>(value: T | T[] | undefined): T[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function checkListLength(
  issues: ValidationIssue[],
  channelPath: string,
  fieldName: string,
  list: unknown[] | undefined,
  freqCount: number
): void {
  if (list === undefined) return;
  const path = `${channelPath}.${fieldName}`;
  if (list.length < freqCount) {
    issues.push({
      severity: "error",
      code: "scan-list-too-short",
      path,
      message: `'${fieldName}' has ${list.length} entries but 'freqs' has ${freqCount}; RTLSDR-Airband requires at least one entry per scanned frequency`,
    });
  } else if (list.length > freqCount) {
    issues.push({
      severity: "warning",
      code: "scan-list-too-long",
      path,
      message: `'${fieldName}' has ${list.length} entries but 'freqs' only has ${freqCount}; the extra entries are ignored`,
    });
  }
}
