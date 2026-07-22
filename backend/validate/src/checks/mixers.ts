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
