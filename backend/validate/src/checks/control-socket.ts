import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * control_socket_path just needs to not be an empty/whitespace-only string
 * -- an empty path would bind() somewhere unexpected (the process's cwd, or
 * fail obscurely) rather than the operator's intended location. No other
 * format/writability checks: that's environment-dependent, and the C++ side
 * already surfaces a clear `control_socket: bind(...) failed` log line if
 * it's wrong, same minimal-check spirit as checkStatsHttp.
 */
export function checkControlSocketPath(config: RtlAirbandConfig): ValidationIssue[] {
  if (config.control_socket_path !== undefined && config.control_socket_path.trim() === "") {
    return [
      {
        severity: "error",
        code: "control-socket-path-empty",
        path: "$.control_socket_path",
        message: "control_socket_path, if set, must not be empty",
      },
    ];
  }
  return [];
}
