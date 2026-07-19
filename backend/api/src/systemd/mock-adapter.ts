import type { SystemdAdapter, UnitStatus } from "./types.js";

/**
 * Records every call it receives instead of touching the system. Default
 * adapter everywhere until RTL_PANEL_SYSTEMD_MODE=sudo is set explicitly.
 */
export class MockSystemdAdapter implements SystemdAdapter {
  readonly calls: string[] = [];
  readonly unitFiles = new Map<string, string>();
  private readonly states = new Map<string, UnitStatus>();

  async restart(unit: string): Promise<void> {
    this.calls.push(`restart ${unit}`);
    this.states.set(unit, { unit, activeState: "active", subState: "running" });
  }

  async start(unit: string): Promise<void> {
    this.calls.push(`start ${unit}`);
    this.states.set(unit, { unit, activeState: "active", subState: "running" });
  }

  async stop(unit: string): Promise<void> {
    this.calls.push(`stop ${unit}`);
    this.states.set(unit, { unit, activeState: "inactive", subState: "dead" });
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
}
