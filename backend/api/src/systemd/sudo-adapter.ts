import type { SystemdAdapter, UnitActiveState, UnitStatus } from "./types.js";
import { runCommand } from "./run-command.js";

const ACTIVE_STATES: readonly UnitActiveState[] = ["active", "inactive", "activating", "deactivating", "failed"];

function systemctl(args: string[]): Promise<string> {
  return runCommand("sudo", ["systemctl", ...args]);
}

/**
 * Real implementation: shells out to `sudo systemctl ...`. This is the
 * stopgap privilege model (see project memory systemd-privilege-model) —
 * every operation goes through this one adapter so a future least-
 * privilege mechanism can replace it without touching InstanceService or
 * routes.
 */
export class SudoSystemctlAdapter implements SystemdAdapter {
  constructor(private readonly unitDir: string = "/etc/systemd/system") {}

  async restart(unit: string): Promise<void> {
    await systemctl(["restart", unit]);
  }

  async start(unit: string): Promise<void> {
    await systemctl(["start", unit]);
  }

  async stop(unit: string): Promise<void> {
    await systemctl(["stop", unit]);
  }

  async enable(unit: string): Promise<void> {
    await systemctl(["enable", unit]);
  }

  async disable(unit: string): Promise<void> {
    await systemctl(["disable", unit]);
  }

  async status(unit: string): Promise<UnitStatus> {
    // `systemctl show` exits 0 even for a unit that doesn't exist (it
    // reports ActiveState=inactive), so this never throws on "not found".
    const output = await systemctl(["show", unit, "--property=ActiveState", "--property=SubState"]);
    const props = new Map<string, string>();
    for (const line of output.split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      props.set(line.slice(0, eq), line.slice(eq + 1));
    }
    const activeStateRaw = props.get("ActiveState") ?? "unknown";
    const activeState: UnitActiveState = (ACTIVE_STATES as readonly string[]).includes(activeStateRaw)
      ? (activeStateRaw as UnitActiveState)
      : "unknown";
    return { unit, activeState, subState: props.get("SubState") ?? "unknown" };
  }

  async daemonReload(): Promise<void> {
    await systemctl(["daemon-reload"]);
  }

  async installUnitFile(unitName: string, contents: string): Promise<void> {
    await runCommand("sudo", ["tee", `${this.unitDir}/${unitName}`], contents);
  }

  async removeUnitFile(unitName: string): Promise<void> {
    await runCommand("sudo", ["rm", "-f", `${this.unitDir}/${unitName}`]);
  }
}
