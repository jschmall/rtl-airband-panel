import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Mirrors three of RTLSDR-Airband's own startup checks (config.cpp) specific
 * to outputs nested under a top-level mixer (as opposed to a channel), each
 * of which calls error() (_Exit(1)) if violated:
 *  - a mixer's outputs can't be of type "rawfile";
 *  - a mixer's outputs can't have split_on_transmission set;
 *  - a mixer's "pulse" outputs must have stream_name set (unlike a channel's
 *    pulse outputs, where it's optional).
 */
export function checkMixerNestedOutputs(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  (config.mixers ?? []).forEach((mixer, mi) => {
    mixer.outputs.forEach((output, oi) => {
      const path = `$.mixers[${mi}].outputs[${oi}]`;

      if (output.type === "rawfile") {
        issues.push({
          severity: "error",
          code: "mixer-output-rawfile-not-allowed",
          path,
          message: "rawfile output is not allowed for mixers",
        });
      }

      if ("split_on_transmission" in output && output.split_on_transmission) {
        issues.push({
          severity: "error",
          code: "mixer-output-split-on-transmission-not-allowed",
          path,
          message: "split_on_transmission is not allowed for mixers",
        });
      }

      if (output.type === "pulse" && output.stream_name === undefined) {
        issues.push({
          severity: "error",
          code: "mixer-output-pulse-stream-name-required",
          path,
          message: "pulse outputs of mixers must have stream_name defined",
        });
      }
    });
  });

  return issues;
}
