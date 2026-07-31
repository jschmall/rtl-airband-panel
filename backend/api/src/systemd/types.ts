export type UnitActiveState = "active" | "inactive" | "activating" | "deactivating" | "failed" | "unknown";

export interface UnitStatus {
  unit: string;
  activeState: UnitActiveState;
  subState: string;
  /**
   * ISO 8601 timestamp of systemd's `ActiveEnterTimestamp` -- when this unit
   * last transitioned to active. Doubles as both "uptime" (now - this) and
   * "last (re)started at", since they're the same underlying data point.
   * Undefined for a unit that has never been active, or when the adapter
   * can't parse the value it got back.
   */
  activeEnterTimestamp?: string;
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
  /**
   * Same as calling status() once per unit, but in a single underlying
   * call -- e.g. one `sudo systemctl show` invocation covering every unit
   * instead of one per unit. Exists specifically for status-polling call
   * sites that check many units at once (the instance-list health poll);
   * each individual `sudo` invocation logs its own PAM session open/close
   * to syslog, so polling N units one-by-one on a ~20s cadence generates
   * 3N syslog lines per cycle -- this collapses that to 3 regardless of N.
   * Missing/unrecognized units come back the same way status() reports
   * them (activeState "unknown" or "inactive", never a thrown error).
   */
  statusMany(units: string[]): Promise<Map<string, UnitStatus>>;
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
