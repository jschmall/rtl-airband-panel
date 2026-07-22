import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Enforces RTLSDR-Airband's startup constraints around `disable` (Disabling
 * configuration sections): there must be at least one non-disabled device,
 * each non-disabled device needs at least one non-disabled channel, and each
 * non-disabled channel needs at least one non-disabled output.
 */
export function checkDisableCascade(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let activeDeviceCount = 0;

  config.devices.forEach((device, di) => {
    if (device.disable) return;
    activeDeviceCount++;
    const devicePath = `$.devices[${di}]`;
    let activeChannelCount = 0;

    device.channels.forEach((channel, ci) => {
      if (channel.disable) return;
      activeChannelCount++;
      const channelPath = `${devicePath}.channels[${ci}]`;
      const activeOutputCount = channel.outputs.filter((o) => !o.disable).length;
      if (activeOutputCount === 0) {
        issues.push({
          severity: "error",
          code: "no-active-outputs",
          path: channelPath,
          message: "every output on this channel is disabled (or none is configured); RTLSDR-Airband requires at least one non-disabled output per channel",
        });
      }
    });

    if (activeChannelCount === 0) {
      issues.push({
        severity: "error",
        code: "no-active-channels",
        path: devicePath,
        message: "every channel on this device is disabled (or none is configured); RTLSDR-Airband requires at least one non-disabled channel per device",
      });
    }
  });

  if (activeDeviceCount === 0) {
    issues.push({
      severity: "error",
      code: "no-active-devices",
      path: "$",
      message: "every device is disabled (or none is configured); RTLSDR-Airband requires at least one non-disabled device",
    });
  }

  return issues;
}
