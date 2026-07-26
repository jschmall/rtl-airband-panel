import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Mirrors RTLSDR-Airband's own startup check (config.cpp): a `file` output
 * can't have both `continuous` and `split_on_transmission` set, or config
 * parsing calls error() (_Exit(1)).
 */
export function checkFileOutputFlags(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const checkOutputs = (outputs: RtlAirbandConfig["devices"][number]["channels"][number]["outputs"], pathPrefix: string) => {
    outputs.forEach((output, oi) => {
      if (output.type !== "file") return;
      if (output.continuous && output.split_on_transmission) {
        issues.push({
          severity: "error",
          code: "file-output-continuous-and-split-on-transmission",
          path: `${pathPrefix}.outputs[${oi}]`,
          message: "can't have both continuous and split_on_transmission set on the same file output",
        });
      }
    });
  };

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      checkOutputs(channel.outputs, `$.devices[${di}].channels[${ci}]`);
    });
  });

  (config.mixers ?? []).forEach((mixer, mi) => {
    checkOutputs(mixer.outputs, `$.mixers[${mi}]`);
  });

  return issues;
}
