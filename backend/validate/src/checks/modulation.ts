import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Mirrors RTLSDR-Airband's own startup check (config.cpp): modulation values
 * are matched with strncmp against "nfm" (first 3 chars) and "am" (first 2
 * chars) -- anything else is an "unknown modulation" config error()
 * (_Exit(1)). Deliberately kept as permissive as upstream (a prefix match,
 * not exact equality) so a config upstream would actually accept is never
 * flagged here.
 */
function isRecognizedModulation(value: string): boolean {
  return value.startsWith("nfm") || value.startsWith("am");
}

export function checkModulation(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      const path = `$.devices[${di}].channels[${ci}]`;

      if (channel.modulation !== undefined && !isRecognizedModulation(channel.modulation)) {
        issues.push({
          severity: "error",
          code: "modulation-unrecognized",
          path: `${path}.modulation`,
          message: `unknown modulation '${channel.modulation}' (must start with "nfm" or "am")`,
        });
      }

      if ("modulations" in channel && channel.modulations !== undefined) {
        channel.modulations.forEach((modulation, mi) => {
          if (isRecognizedModulation(modulation)) return;
          issues.push({
            severity: "error",
            code: "modulation-unrecognized",
            path: `${path}.modulations[${mi}]`,
            message: `unknown modulation '${modulation}' (must start with "nfm" or "am")`,
          });
        });
      }
    });
  });

  return issues;
}
