import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Walks every channel's value for `fieldName`, which may be a scalar or (on
 * ScanChannel) a per-frequency list, and reports one issue per invalid entry
 * via `isInvalid`. `path` points at the whole field for a scalar, or at the
 * specific list index for a list entry.
 */
function checkScalarOrList(
  config: RtlAirbandConfig,
  fieldName: string,
  getValue: (channel: RtlAirbandConfig["devices"][number]["channels"][number]) => number | number[] | undefined,
  isInvalid: (value: number) => boolean,
  message: (value: number) => string,
  code: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      const value = getValue(channel);
      if (value === undefined) return;
      const channelPath = `$.devices[${di}].channels[${ci}]`;

      if (Array.isArray(value)) {
        value.forEach((entry, vi) => {
          if (!isInvalid(entry)) return;
          issues.push({ severity: "error", code, path: `${channelPath}.${fieldName}[${vi}]`, message: message(entry) });
        });
      } else if (isInvalid(value)) {
        issues.push({ severity: "error", code, path: `${channelPath}.${fieldName}`, message: message(value) });
      }
    });
  });

  return issues;
}

/** Mirrors RTLSDR-Airband's own startup check (config.cpp): ampfactor must not be negative, or config parsing calls error() (_Exit(1)). */
export function checkAmpfactor(config: RtlAirbandConfig): ValidationIssue[] {
  return checkScalarOrList(
    config,
    "ampfactor",
    (channel) => channel.ampfactor,
    (v) => v < 0,
    (v) => `ampfactor ${v} must not be negative`,
    "ampfactor-negative"
  );
}

/** Mirrors RTLSDR-Airband's own startup check (config.cpp): squelch_threshold (dBFS) must be <= 0, or config parsing calls error() (_Exit(1)). */
export function checkSquelchThreshold(config: RtlAirbandConfig): ValidationIssue[] {
  return checkScalarOrList(
    config,
    "squelch_threshold",
    (channel) => channel.squelch_threshold,
    (v) => v > 0,
    (v) => `squelch_threshold ${v} must be less than or equal to 0`,
    "squelch-threshold-positive"
  );
}

/**
 * Mirrors RTLSDR-Airband's own startup check (config.cpp): squelch_snr_threshold
 * must be >= 0, with -1.0 as a documented sentinel meaning "use the default"
 * (not an error) -- any other negative value calls error() (_Exit(1)). This
 * exception applies uniformly whether squelch_snr_threshold is set on a
 * MultichannelChannel (scalar only) or a ScanChannel (scalar or per-frequency
 * list).
 */
export function checkSquelchSnrThreshold(config: RtlAirbandConfig): ValidationIssue[] {
  return checkScalarOrList(
    config,
    "squelch_snr_threshold",
    (channel) => channel.squelch_snr_threshold,
    (v) => v < 0 && v !== -1,
    (v) => `squelch_snr_threshold ${v} must be greater than or equal to 0 (or exactly -1 to use the default)`,
    "squelch-snr-threshold-invalid"
  );
}

/**
 * RTLSDR-Airband's own startup check (config.cpp) only warns when both
 * squelch_threshold and squelch_snr_threshold are set on the same channel
 * ("may conflict") and keeps running with whichever one its code picks. The
 * panel treats it as a hard error instead: a saved config that leaves it
 * ambiguous which threshold actually governs squelch is never what someone
 * intended, so fail closed rather than silently pick one on their behalf.
 */
export function checkSquelchMutualExclusion(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      if (channel.squelch_threshold !== undefined && channel.squelch_snr_threshold !== undefined) {
        issues.push({
          severity: "error",
          code: "squelch-threshold-and-snr-threshold-both-set",
          path: `$.devices[${di}].channels[${ci}]`,
          message: "squelch_threshold and squelch_snr_threshold can't both be set on the same channel",
        });
      }
    });
  });

  return issues;
}

/** Mirrors RTLSDR-Airband's own startup check (config.cpp): notch_q must be greater than 0.0, or config parsing calls error() (_Exit(1)). */
export function checkNotchQ(config: RtlAirbandConfig): ValidationIssue[] {
  return checkScalarOrList(
    config,
    "notch_q",
    (channel) => channel.notch_q,
    (v) => v <= 0,
    (v) => `notch_q ${v} must be greater than 0.0`,
    "notch-q-non-positive"
  );
}
