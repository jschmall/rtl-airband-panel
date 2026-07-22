import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Fields whose requiredness depends on device type/mode rather than being
 * statically required by the TS shape (backend/parser deliberately leaves
 * them optional since it's a purely structural mapper):
 *  - `gain` is required unless the device is a soapysdr device (which
 *    enables AGC when gain is omitted);
 *  - `device_string` is required for soapysdr devices;
 *  - `centerfreq` is required unless the device is in scan mode (the
 *    dongle retunes to each scanned frequency instead of holding one).
 */
export function checkDeviceRequirements(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    const path = `$.devices[${di}]`;
    const isSoapy = device.type === "soapysdr";

    if (!isSoapy && device.gain === undefined) {
      issues.push({
        severity: "error",
        code: "device-gain-required",
        path,
        message: `device type '${device.type}' requires a 'gain' value (only soapysdr devices may omit it, to enable AGC)`,
      });
    }

    if (isSoapy && device.device_string === undefined) {
      issues.push({
        severity: "error",
        code: "device-string-required",
        path,
        message: `soapysdr devices require a 'device_string'`,
      });
    }

    if (device.mode !== "scan" && device.centerfreq === undefined) {
      issues.push({
        severity: "error",
        code: "device-centerfreq-required",
        path,
        message: `device is in multichannel mode and requires a 'centerfreq'`,
      });
    }
  });

  return issues;
}
