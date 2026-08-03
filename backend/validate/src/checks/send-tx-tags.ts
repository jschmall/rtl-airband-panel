import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Mirrors RTLSDR-Airband's own config.cpp startup check: send_tx_tags is
 * rejected on a scan-mode ("R_SCAN") device's channel, since the frequency
 * itself changes at runtime there — send_scan_freq_tags already covers
 * that case. Mixer-routed icecast outputs are exempt: mixers have no
 * scan-mode concept.
 */
export function checkSendTxTags(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    if (device.mode !== "scan") return;
    device.channels.forEach((channel, ci) => {
      channel.outputs.forEach((output, oi) => {
        if (output.type !== "icecast" || !output.send_tx_tags) return;
        issues.push({
          severity: "error",
          code: "send-tx-tags-not-supported-on-scan-mode",
          path: `$.devices[${di}].channels[${ci}].outputs[${oi}]`,
          message:
            "send_tx_tags is not supported on scan-mode channels — the frequency itself changes at runtime " +
            "there; use send_scan_freq_tags instead",
        });
      });
    });
  });

  return issues;
}
