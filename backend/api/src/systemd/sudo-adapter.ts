import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { LogLine, SystemdAdapter, UnitActiveState, UnitStatus } from "./types.js";
import { CommandError, runCommand } from "./run-command.js";
import { parseShortIsoLine } from "./log-line-parse.js";

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

// sudo, on its own, doesn't respect piped stdio for a password prompt -- it opens
// /dev/tty directly and writes to it regardless of how stdin/stdout/stderr are
// redirected, specifically so a prompt can never be silently hidden. That's fine
// under systemd (no controlling tty exists there, so sudo just fails), but running
// this process at a real foreground terminal (a missing/misscoped sudoers rule, an
// expired cached credential, ...) means that prompt lands directly on the user's
// console, interleaved with this process's own stdout writes with no coordination
// between the two -- which reads as garbled/misaligned log output, not a password
// prompt. -n makes sudo fail immediately (a normal, piped, catchable error) instead
// of ever reaching for the controlling tty.
const SUDO_NONINTERACTIVE = "-n";

function systemctl(args: string[]): Promise<string> {
  return runCommand("sudo", [SUDO_NONINTERACTIVE, "systemctl", ...args]);
}

/** Parses one unit's `key=value` property block, as printed by `systemctl show`. */
function parseProps(block: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const line of block.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    props.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return props;
}

/**
 * Parses systemd's raw `ActiveEnterTimestamp` property (e.g.
 * "Thu 2026-07-31 14:03:11 UTC") into an ISO 8601 string. Empty (a unit
 * that has never been active) or anything JS's Date can't parse falls back
 * to undefined rather than throwing -- callers treat this the same as an
 * unrecognized ActiveState: unknown, not fatal.
 */
export function parseActiveEnterTimestamp(raw: string): string | undefined {
  if (raw === "") return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toUnitStatus(unit: string, props: Map<string, string>): UnitStatus {
  const activeStateRaw = props.get("ActiveState") ?? "unknown";
  const activeState: UnitActiveState = (ACTIVE_STATES as readonly string[]).includes(activeStateRaw)
    ? (activeStateRaw as UnitActiveState)
    : "unknown";
  const activeEnterTimestamp = parseActiveEnterTimestamp(props.get("ActiveEnterTimestamp") ?? "");
  return {
    unit,
    activeState,
    subState: props.get("SubState") ?? "unknown",
    ...(activeEnterTimestamp !== undefined ? { activeEnterTimestamp } : {}),
  };
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
    const output = await systemctl([
      "show",
      unit,
      "--property=ActiveState",
      "--property=SubState",
      "--property=ActiveEnterTimestamp",
    ]);
    return toUnitStatus(unit, parseProps(output));
  }

  /**
   * One `systemctl show` call for every unit rather than one call each --
   * see statusMany's doc comment on SystemdAdapter for why. Given multiple
   * units, systemctl show prints each unit's own property block in the same
   * order the units were passed, separated by a blank line.
   */
  async statusMany(units: string[]): Promise<Map<string, UnitStatus>> {
    for (const unit of units) this.assertScoped(unit);
    const result = new Map<string, UnitStatus>();
    if (units.length === 0) return result;
    const output = await systemctl([
      "show",
      ...units,
      "--property=ActiveState",
      "--property=SubState",
      "--property=ActiveEnterTimestamp",
    ]);
    const blocks = output.split("\n\n");
    units.forEach((unit, i) => result.set(unit, toUnitStatus(unit, parseProps(blocks[i] ?? ""))));
    return result;
  }

  async daemonReload(): Promise<void> {
    await systemctl(["daemon-reload"]);
  }

  async getLogs(unit: string, lines: number): Promise<LogLine[]> {
    this.assertScoped(unit);
    let output: string;
    try {
      output = await runCommand("sudo", [SUDO_NONINTERACTIVE, "journalctl", "-u", unit, "-n", String(lines), "--no-pager", "-o", "short-iso"]);
    } catch (err) {
      // Consistent with status()'s "never throws on not found" behavior --
      // an unrecognized/never-started unit is reported as having no logs,
      // not treated as a request-level failure.
      if (err instanceof CommandError) return [];
      throw err;
    }
    return output
      .split("\n")
      .filter((line) => line !== "")
      .map(parseShortIsoLine);
  }

  /**
   * Spawns `journalctl -f` directly rather than going through runCommand --
   * runCommand only resolves once, on process exit, and buffers all output
   * in memory, neither of which works for a command that runs indefinitely
   * and needs to be consumed line-by-line as it's produced.
   */
  async *followLogs(unit: string, lines: number, signal: AbortSignal): AsyncGenerator<LogLine> {
    this.assertScoped(unit);
    if (signal.aborted) return;

    const child = spawn(
      "sudo",
      [SUDO_NONINTERACTIVE, "journalctl", "-u", unit, "-n", String(lines), "-f", "-o", "short-iso", "--no-pager"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let spawnError: Error | null = null;
    // Without this listener, a failed spawn (e.g. "sudo" missing) would surface
    // as an uncaught "error" event instead of propagating to the caller.
    child.once("error", (err) => {
      spawnError = err;
    });
    const onAbort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", onAbort, { once: true });

    // readline handles lines split across stdout chunk boundaries -- a
    // manual chunk-splitting loop over the Readable would have to
    // reimplement that itself.
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (line !== "") yield parseShortIsoLine(line);
      }
    } finally {
      rl.close();
      signal.removeEventListener("abort", onAbort);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      child.stderr.resume(); // drain, never inspected -- journalctl -f only ever ends via kill or a genuine crash
    }
    if (spawnError && !signal.aborted) throw spawnError;
  }

  async installUnitFile(unitName: string, contents: string): Promise<void> {
    this.assertScoped(unitName);
    await runCommand("sudo", [SUDO_NONINTERACTIVE, "tee", `${this.unitDir}/${unitName}`], contents);
  }

  async removeUnitFile(unitName: string): Promise<void> {
    this.assertScoped(unitName);
    await runCommand("sudo", [SUDO_NONINTERACTIVE, "rm", "-f", `${this.unitDir}/${unitName}`]);
  }
}
