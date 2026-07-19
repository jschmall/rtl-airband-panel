export type UnitActiveState = "active" | "inactive" | "activating" | "deactivating" | "failed" | "unknown";

export interface UnitStatus {
  unit: string;
  activeState: UnitActiveState;
  subState: string;
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
}
