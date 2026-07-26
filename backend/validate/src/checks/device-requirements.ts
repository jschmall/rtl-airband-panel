import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";
import { DEFAULT_SAMPLE_RATE_HZ, MIN_SAMPLE_RATE_HZ } from "../rtlsdr-defaults.js";

/** The device types this codebase models (rtlsdr/mirisdr-specific buffers fields, soapysdr-specific device_string/channel/antenna) -- anything else is "unsupported device type" upstream (config.cpp), a fatal error(). */
const KNOWN_DEVICE_TYPES = ["rtlsdr", "mirisdr", "soapysdr"];

/**
 * Fields whose requiredness depends on device type/mode rather than being
 * statically required by the TS shape (backend/parser deliberately leaves
 * them optional since it's a purely structural mapper):
 *  - `gain` is required unless the device is a soapysdr device (which
 *    enables AGC when gain is omitted);
 *  - `device_string` is required for soapysdr devices;
 *  - `centerfreq` is required unless the device is in scan mode (the
 *    dongle retunes to each scanned frequency instead of holding one);
 *  - `serial` or `index` (at least one) is required for rtlsdr/mirisdr
 *    devices, which need to select a physical dongle.
 *
 * Also enforces several other RTLSDR-Airband startup checks (config.cpp /
 * input-rtlsdr.cpp / input-mirisdr.cpp) that call error() (_Exit(1)) on
 * violation: an unsupported device `type`, `sample_rate` at or below
 * RTLSDR-Airband's own floor, and non-positive `buffers`/`num_buffers`.
 */
export function checkDeviceRequirements(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    const path = `$.devices[${di}]`;
    const isSoapy = device.type === "soapysdr";
    const isRtl = device.type === "rtlsdr";
    const isMiri = device.type === "mirisdr";

    if (!KNOWN_DEVICE_TYPES.includes(device.type)) {
      issues.push({
        severity: "error",
        code: "device-type-unsupported",
        path,
        message: `unsupported device type '${device.type}' (must be one of: ${KNOWN_DEVICE_TYPES.join(", ")})`,
      });
    }

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

    if ((isRtl || isMiri) && device.serial === undefined && device.index === undefined) {
      issues.push({
        severity: "error",
        code: "device-serial-or-index-required",
        path,
        message: `device type '${device.type}' requires either 'serial' or 'index' to select a dongle`,
      });
    }

    const sampleRate = device.sample_rate ?? DEFAULT_SAMPLE_RATE_HZ;
    if (sampleRate <= MIN_SAMPLE_RATE_HZ) {
      issues.push({
        severity: "error",
        code: "device-sample-rate-too-low",
        path,
        message: `sample_rate ${sampleRate} must be greater than ${MIN_SAMPLE_RATE_HZ}`,
      });
    }

    if (isRtl && device.buffers !== undefined && device.buffers <= 0) {
      issues.push({
        severity: "error",
        code: "device-buffers-invalid",
        path,
        message: `buffers ${device.buffers} must be greater than 0`,
      });
    }

    if (isMiri && device.num_buffers !== undefined && device.num_buffers <= 0) {
      issues.push({
        severity: "error",
        code: "device-num-buffers-invalid",
        path,
        message: `num_buffers ${device.num_buffers} must be greater than 0`,
      });
    }
  });

  return issues;
}
