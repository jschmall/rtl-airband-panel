export type UnitActiveState = "active" | "inactive" | "activating" | "deactivating" | "failed" | "unknown";

export interface UnitStatus {
  unit: string;
  activeState: UnitActiveState;
  subState: string;
}

export interface LogLine {
  /** journalctl's own timestamp for the entry, as printed by `-o short-iso`. */
  timestamp: string;
  message: string;
}

/**
 * Everything backend/api needs to control a single systemd unit. Kept
 * narrow and swappable so the real (sudo-based) implementation can later
 * be replaced by a least-privilege mechanism without touching callers.
 */
export interface SystemdAdapter {
  restart(unit: string): Promise<void>;
  start(unit: string): Promise<void>;
  stop(unit: string): Promise<void>;
  enable(unit: string): Promise<void>;
  disable(unit: string): Promise<void>;
  status(unit: string): Promise<UnitStatus>;
  daemonReload(): Promise<void>;
  installUnitFile(unitName: string, contents: string): Promise<void>;
  removeUnitFile(unitName: string): Promise<void>;
  /** Most recent `lines` journal entries for `unit`, oldest first. */
  getLogs(unit: string, lines: number): Promise<LogLine[]>;
  /**
   * Streams `lines` of backlog followed by live journal entries for `unit`,
   * until `signal` aborts. Backed by `journalctl -f`, which prints the
   * requested backlog and then keeps following in one invocation, so there
   * is no separate backlog/live reconciliation step for a caller to do.
   */
  followLogs(unit: string, lines: number, signal: AbortSignal): AsyncGenerator<LogLine>;
}
