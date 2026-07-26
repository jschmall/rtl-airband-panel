import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Mirrors RTLSDR-Airband's own startup check (config.cpp), applied to both
 * channels and mixers: when both lowpass and highpass are set, lowpass must
 * be >= highpass, or config parsing calls error() (_Exit(1)).
 */
export function checkFilterCutoffs(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      if (channel.lowpass === undefined || channel.highpass === undefined) return;
      if (channel.lowpass < channel.highpass) {
        issues.push({
          severity: "error",
          code: "lowpass-below-highpass",
          path: `$.devices[${di}].channels[${ci}]`,
          message: `lowpass (${channel.lowpass}) must be greater than or equal to highpass (${channel.highpass})`,
        });
      }
    });
  });

  (config.mixers ?? []).forEach((mixer, mi) => {
    if (mixer.lowpass === undefined || mixer.highpass === undefined) return;
    if (mixer.lowpass < mixer.highpass) {
      issues.push({
        severity: "error",
        code: "lowpass-below-highpass",
        path: `$.mixers[${mi}]`,
        message: `lowpass (${mixer.lowpass}) must be greater than or equal to highpass (${mixer.highpass})`,
      });
    }
  });

  return issues;
}
