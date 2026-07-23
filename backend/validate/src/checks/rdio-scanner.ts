import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Mirrors RTLSDR-Airband's own startup check (config.cpp, WITH_RDIO_SCANNER
 * build): a `file` output's `rdio_scanner` block is only honored when
 * `split_on_transmission` is also set — RTLSDR-Airband refuses to start
 * otherwise.
 */
export function checkRdioScanner(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const checkOutputs = (outputs: RtlAirbandConfig["devices"][number]["channels"][number]["outputs"], pathPrefix: string) => {
    outputs.forEach((output, oi) => {
      if (output.type !== "file" || output.rdio_scanner === undefined) return;
      if (!output.split_on_transmission) {
        issues.push({
          severity: "error",
          code: "rdio-scanner-requires-split-on-transmission",
          path: `${pathPrefix}.outputs[${oi}]`,
          message: "rdio_scanner requires split_on_transmission to be true on the same output",
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
