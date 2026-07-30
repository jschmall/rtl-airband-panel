import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Mirrors RTLSDR-Airband's own startup check (config.cpp): stats_http_address
 * and stats_http_port must be set together, and stats_http_port must be a
 * valid TCP port. The C++ check also requires stats_filepath to be set, but
 * RtlAirbandConfig.stats_filepath is already a required (non-optional)
 * field in the panel's schema, so that half of the check can never fire here.
 */
export function checkStatsHttp(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { stats_http_address, stats_http_port } = config;

  if ((stats_http_address !== undefined) !== (stats_http_port !== undefined)) {
    issues.push({
      severity: "error",
      code: "stats-http-address-and-port-must-be-set-together",
      path: "$",
      message: "stats_http_address and stats_http_port must be set together",
    });
  }

  if (stats_http_port !== undefined && (stats_http_port <= 0 || stats_http_port > 65535)) {
    issues.push({
      severity: "error",
      code: "stats-http-port-out-of-range",
      path: "$.stats_http_port",
      message: "stats_http_port must be between 1 and 65535",
    });
  }

  return issues;
}
