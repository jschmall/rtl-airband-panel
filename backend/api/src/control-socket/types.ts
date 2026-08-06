/**
 * Outcome of a `reload_diff` request against a running instance's
 * dynamic_reload control socket (see RTLSDR-Airband fork branch
 * `dynamic_reload`, src/control_socket.{cpp,h}).
 */
export type ReloadDiffResult =
  | {
      kind: "applied";
      /** Human-readable descriptions of what the running process live-applied, verbatim from the socket. */
      applied: string[];
      /** Human-readable descriptions of what still needs a restart, verbatim from the socket. */
      skippedRequiresRestart: string[];
    }
  /**
   * The socket couldn't be reached at all -- no listener at that path (old
   * binary, or the process hasn't started yet), a stale/orphaned socket
   * file, a permission error, or a timeout waiting for a response. Always
   * safe to treat as "couldn't do a live apply this time", never as "the
   * config is bad" -- the caller falls back to the existing restart-based
   * flow.
   */
  | { kind: "unreachable"; reason: string }
  /** The socket responded, but with `{"ok":false,...}` or a line that didn't parse as the expected shape at all. */
  | { kind: "protocol-error"; message: string };

/** Narrow, swappable interface for talking to a running instance's dynamic_reload control socket -- mirrors SystemdAdapter's shape. */
export interface ControlSocketClient {
  reloadDiff(socketPath: string): Promise<ReloadDiffResult>;
}
