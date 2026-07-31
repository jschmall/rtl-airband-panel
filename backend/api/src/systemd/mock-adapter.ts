import type { LogLine, SystemdAdapter, UnitStatus } from "./types.js";

/** A test's handle onto an in-flight followLogs() call -- push/end it to drive the stream, read `killed` to confirm abort reached it. */
export interface MockLogStream {
  /** Push a line as if journalctl just emitted it live. */
  push(line: LogLine): void;
  /** Ends the generator as if journalctl exited on its own (not via abort). */
  end(): void;
  /** True once the generator observed the signal aborting -- what tests assert to confirm route-side cleanup happened. */
  readonly killed: boolean;
}

/**
 * Records every call it receives instead of touching the system. Default
 * adapter everywhere until RTL_PANEL_SYSTEMD_MODE=sudo is set explicitly.
 */
export class MockSystemdAdapter implements SystemdAdapter {
  readonly calls: string[] = [];
  readonly unitFiles = new Map<string, string>();
  /** Seed a unit's canned journal output here before exercising getLogs()/followLogs() in tests. */
  readonly logLines = new Map<string, LogLine[]>();
  private readonly logStreams = new Map<string, MockLogStream>();
  private readonly streamWaiters = new Map<string, ((s: MockLogStream) => void)[]>();
  private readonly states = new Map<string, UnitStatus>();

  /** Resolves once a followLogs() call for `unit` has registered its stream -- lets a test grab it and push/end deterministically instead of racing the generator's own async iteration. */
  waitForLogStream(unit: string): Promise<MockLogStream> {
    const existing = this.logStreams.get(unit);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const waiters = this.streamWaiters.get(unit) ?? [];
      waiters.push(resolve);
      this.streamWaiters.set(unit, waiters);
    });
  }

  async restart(unit: string): Promise<void> {
    this.calls.push(`restart ${unit}`);
    this.states.set(unit, { unit, activeState: "active", subState: "running", activeEnterTimestamp: new Date().toISOString() });
  }

  async start(unit: string): Promise<void> {
    this.calls.push(`start ${unit}`);
    this.states.set(unit, { unit, activeState: "active", subState: "running", activeEnterTimestamp: new Date().toISOString() });
  }

  async stop(unit: string): Promise<void> {
    this.calls.push(`stop ${unit}`);
    // Real systemd doesn't clear ActiveEnterTimestamp on stop -- it still
    // reflects the last time the unit *became* active, so a stopped
    // instance can still show when it was last running. Only the state
    // fields change here.
    const previous = this.states.get(unit);
    this.states.set(unit, {
      unit,
      activeState: "inactive",
      subState: "dead",
      ...(previous?.activeEnterTimestamp !== undefined ? { activeEnterTimestamp: previous.activeEnterTimestamp } : {}),
    });
  }

  async enable(unit: string): Promise<void> {
    this.calls.push(`enable ${unit}`);
  }

  async disable(unit: string): Promise<void> {
    this.calls.push(`disable ${unit}`);
  }

  async status(unit: string): Promise<UnitStatus> {
    this.calls.push(`status ${unit}`);
    return this.states.get(unit) ?? { unit, activeState: "unknown", subState: "dead" };
  }

  async statusMany(units: string[]): Promise<Map<string, UnitStatus>> {
    // Mirrors SudoSystemctlAdapter, which never spawns a command for an
    // empty unit list -- no call recorded means "the adapter did nothing",
    // not "the adapter was asked to check zero units".
    if (units.length > 0) this.calls.push(`status-many ${units.join(",")}`);
    return new Map(units.map((unit) => [unit, this.states.get(unit) ?? { unit, activeState: "unknown", subState: "dead" }]));
  }

  async daemonReload(): Promise<void> {
    this.calls.push("daemon-reload");
  }

  async installUnitFile(unitName: string, contents: string): Promise<void> {
    this.calls.push(`install-unit ${unitName}`);
    this.unitFiles.set(unitName, contents);
    this.states.set(unitName, { unit: unitName, activeState: "inactive", subState: "dead" });
  }

  async removeUnitFile(unitName: string): Promise<void> {
    this.calls.push(`remove-unit ${unitName}`);
    this.unitFiles.delete(unitName);
    this.states.delete(unitName);
  }

  async getLogs(unit: string, lines: number): Promise<LogLine[]> {
    this.calls.push(`logs ${unit} ${lines}`);
    return (this.logLines.get(unit) ?? []).slice(-lines);
  }

  async *followLogs(unit: string, lines: number, signal: AbortSignal): AsyncGenerator<LogLine> {
    this.calls.push(`follow-logs ${unit} ${lines}`);
    const backlog = (this.logLines.get(unit) ?? []).slice(-lines);
    const pending: LogLine[] = [];
    let ended = false;
    let killedFlag = false;
    let wake: (() => void) | null = null;

    const stream: MockLogStream = {
      push: (line) => {
        pending.push(line);
        wake?.();
      },
      end: () => {
        ended = true;
        wake?.();
      },
      get killed() {
        return killedFlag;
      },
    };
    this.logStreams.set(unit, stream);
    for (const resolve of this.streamWaiters.get(unit) ?? []) resolve(stream);
    this.streamWaiters.delete(unit);

    const onAbort = () => {
      killedFlag = true;
      ended = true;
      wake?.();
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      for (const line of backlog) yield line;
      // Drains anything still queued in `pending` even after `ended` flips
      // true -- push() and end()/abort just mutate shared state whenever
      // the caller calls them, independent of wherever this generator
      // currently is in its execution, so a line pushed right before end()
      // must still be yielded rather than silently dropped.
      while (pending.length > 0 || !ended) {
        if (pending.length > 0) {
          yield pending.shift()!;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.logStreams.delete(unit);
    }
  }
}
