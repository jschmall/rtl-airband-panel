import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Mirrors RTLSDR-Airband's own startup checks (config.cpp, WITH_RDIO_SCANNER
 * build):
 * - a `file` output's `rdio_scanner` block is only honored when
 *   `split_on_transmission` is also set — RTLSDR-Airband refuses to start
 *   otherwise.
 * - `timeout_ms` must be > 0 (0 means "no timeout" to libcurl, which can
 *   hang a worker thread indefinitely) and `max_retries` must be >= 0.
 * - `rdio_scanner` is rejected on a scan-mode ("R_SCAN") device's channel,
 *   since talkgroup_id/labels are fixed at config time and can't track
 *   which frequency is currently being scanned. Mixer-routed rdio_scanner
 *   outputs are exempt — mixers have no scan-mode concept, matching the
 *   C++'s R_MULTICHANNEL treatment of mixer outputs.
 */
export function checkRdioScanner(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const checkOutputs = (
    outputs: RtlAirbandConfig["devices"][number]["channels"][number]["outputs"],
    pathPrefix: string,
    isScanDevice: boolean
  ) => {
    outputs.forEach((output, oi) => {
      if (output.type !== "file" || output.rdio_scanner === undefined || output.rdio_scanner.disable) return;
      const outputPath = `${pathPrefix}.outputs[${oi}]`;
      if (!output.split_on_transmission) {
        issues.push({
          severity: "error",
          code: "rdio-scanner-requires-split-on-transmission",
          path: outputPath,
          message: "rdio_scanner requires split_on_transmission to be true on the same output",
        });
      }
      if (isScanDevice) {
        issues.push({
          severity: "error",
          code: "rdio-scanner-not-supported-on-scan-mode",
          path: outputPath,
          message:
            "rdio_scanner is not supported on scan-mode channels — talkgroup_id and the other per-channel fields " +
            "are fixed at config time and can't track the frequency currently being scanned",
        });
      }
      const { timeout_ms, max_retries } = output.rdio_scanner;
      if (timeout_ms !== undefined && timeout_ms <= 0) {
        issues.push({
          severity: "error",
          code: "rdio-scanner-invalid-timeout",
          path: `${outputPath}.rdio_scanner.timeout_ms`,
          message: "rdio_scanner timeout_ms must be greater than 0 (0 means libcurl never times out)",
        });
      }
      if (max_retries !== undefined && max_retries < 0) {
        issues.push({
          severity: "error",
          code: "rdio-scanner-invalid-max-retries",
          path: `${outputPath}.rdio_scanner.max_retries`,
          message: "rdio_scanner max_retries must not be negative",
        });
      }
    });
  };

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      checkOutputs(channel.outputs, `$.devices[${di}].channels[${ci}]`, device.mode === "scan");
    });
  });

  (config.mixers ?? []).forEach((mixer, mi) => {
    checkOutputs(mixer.outputs, `$.mixers[${mi}]`, false);
  });

  if (config.rdio_scanner_queue_depth !== undefined && config.rdio_scanner_queue_depth <= 0) {
    issues.push({
      severity: "error",
      code: "rdio-scanner-invalid-queue-depth",
      path: "$.rdio_scanner_queue_depth",
      message: "rdio_scanner_queue_depth must be greater than 0",
    });
  }

  return issues;
}
