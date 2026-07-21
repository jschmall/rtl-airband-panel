import type { SystemdAdapter, UnitActiveState, UnitStatus } from "./types.js";
import { runCommand } from "./run-command.js";

const ACTIVE_STATES: readonly UnitActiveState[] = ["active", "inactive", "activating", "deactivating", "failed"];

// Same charset instance-name.ts's SAFE_NAME allows for a whole instance
// name; a configured prefix must be drawn from it too, since it becomes
// part of a regex built at runtime and is expected to correspond 1:1 with
// a sudoers glob the operator writes by hand (see
// deploy/rtl-airband-panel.sudoers) -- anything outside this charset would
// either need escaping (silently changing what the sudoers glob matches)
// or risks behaving as a regex metacharacter.
const SAFE_PREFIX = /^[A-Za-z0-9_-]*$/;

export class UnitOutOfScopeError extends Error {
  constructor(unit: string, prefix: string) {
    const scope = prefix ? `the '${prefix}' unit-name prefix` : "the configured unit-name scope";
    super(`Refusing to act on unit '${unit}': outside ${scope} this adapter is scoped to`);
    this.name = "UnitOutOfScopeError";
  }
}

export class InvalidUnitNamePrefixError extends Error {
  constructor(prefix: string) {
    super(`Invalid sudo unit-name prefix '${prefix}': must match ${SAFE_PREFIX}`);
    this.name = "InvalidUnitNamePrefixError";
  }
}

/**
 * Builds the regex a unit name must match for SudoSystemctlAdapter to act
 * on it. Naming is fully up to the operator -- there's no app-wide
 * required prefix -- so this only restricts anything beyond the existing
 * instance-name charset check when a prefix is actually configured (see
 * ApiConfig.sudoUnitNamePrefix). An empty prefix intentionally matches any
 * valid instance name, since requiring one by default would force a
 * naming convention on every deployment, not just ones that opt into it.
 */
export function buildScopedUnitPattern(prefix: string): RegExp {
  if (!SAFE_PREFIX.test(prefix)) {
    throw new InvalidUnitNamePrefixError(prefix);
  }
  return new RegExp(`^${prefix}[A-Za-z0-9_-]{1,64}\\.service$`);
}

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
  private readonly scopedUnit: RegExp;

  constructor(
    private readonly unitDir: string = "/etc/systemd/system",
    private readonly unitNamePrefix: string = ""
  ) {
    this.scopedUnit = buildScopedUnitPattern(unitNamePrefix);
  }

  private assertScoped(unit: string): void {
    if (!this.scopedUnit.test(unit)) {
      throw new UnitOutOfScopeError(unit, this.unitNamePrefix);
    }
  }

  async restart(unit: string): Promise<void> {
    this.assertScoped(unit);
    await systemctl(["restart", unit]);
  }

  async start(unit: string): Promise<void> {
    this.assertScoped(unit);
    await systemctl(["start", unit]);
  }

  async stop(unit: string): Promise<void> {
    this.assertScoped(unit);
    await systemctl(["stop", unit]);
  }

  async enable(unit: string): Promise<void> {
    this.assertScoped(unit);
    await systemctl(["enable", unit]);
  }

  async disable(unit: string): Promise<void> {
    this.assertScoped(unit);
    await systemctl(["disable", unit]);
  }

  async status(unit: string): Promise<UnitStatus> {
    this.assertScoped(unit);
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
    this.assertScoped(unitName);
    await runCommand("sudo", ["tee", `${this.unitDir}/${unitName}`], contents);
  }

  async removeUnitFile(unitName: string): Promise<void> {
    this.assertScoped(unitName);
    await runCommand("sudo", ["rm", "-f", `${this.unitDir}/${unitName}`]);
  }
}
