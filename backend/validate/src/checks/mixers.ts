import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/** Errors when a channel output of type "mixer" names a mixer with no matching top-level `mixers` entry. */
export function checkMixerReferences(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const mixerNames = new Set((config.mixers ?? []).map((m) => m.name));

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      channel.outputs.forEach((output, oi) => {
        if (output.type !== "mixer") return;
        if (!mixerNames.has(output.name)) {
          issues.push({
            severity: "error",
            code: "mixer-reference-not-found",
            path: `$.devices[${di}].channels[${ci}].outputs[${oi}]`,
            message: `output routes into mixer '${output.name}', which has no matching entry in the top-level mixers list`,
          });
        }
      });
    });
  });

  return issues;
}

/**
 * Mirrors RTLSDR-Airband's own startup check (config.cpp): a channel output
 * routing into a mixer (`type: "mixer"`) must have `balance` in [-1.0, 1.0],
 * or config parsing calls error() (_Exit(1)).
 */
export function checkMixerOutputBalance(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      channel.outputs.forEach((output, oi) => {
        if (output.type !== "mixer" || output.balance === undefined) return;
        if (output.balance < -1.0 || output.balance > 1.0) {
          issues.push({
            severity: "error",
            code: "mixer-output-balance-out-of-range",
            path: `$.devices[${di}].channels[${ci}].outputs[${oi}]`,
            message: `balance ${output.balance} is out of allowed range <-1.0;1.0>`,
          });
        }
      });
    });
  });

  return issues;
}

/** Errors when a mixer's reserve_inputs is negative -- RTLSDR-Airband's own config.cpp rejects this at startup. */
export function checkMixerReserveInputs(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  (config.mixers ?? []).forEach((mixer, mi) => {
    if (mixer.reserve_inputs !== undefined && mixer.reserve_inputs < 0) {
      issues.push({
        severity: "error",
        code: "mixer-reserve-inputs-negative",
        path: `$.mixers[${mi}]`,
        message: `reserve_inputs ${mixer.reserve_inputs} must not be negative`,
      });
    }
  });

  return issues;
}
