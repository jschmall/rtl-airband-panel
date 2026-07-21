import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { validateConfig, type ValidationIssue } from "@rtl-airband-panel/validate";
import type { ConfigStore } from "./config-store.js";
import type { SystemdAdapter, UnitStatus } from "./systemd/types.js";
import { assertValidInstanceName, confFilePath, unitFileName } from "./instance-name.js";
import { renderUnitFile } from "./unit-template.js";

export class InstanceNotFoundError extends Error {
  constructor(name: string) {
    super(`No instance named '${name}'`);
    this.name = "InstanceNotFoundError";
  }
}

export class InstanceAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`An instance named '${name}' already exists`);
    this.name = "InstanceAlreadyExistsError";
  }
}

export class ValidationFailedError extends Error {
  constructor(public readonly errors: ValidationIssue[]) {
    super(`Config validation failed: ${errors.map((e) => e.message).join("; ")}`);
    this.name = "ValidationFailedError";
  }
}

export interface InstanceSummary {
  name: string;
  confPath: string;
  unit: string;
}

export interface WriteResult {
  warnings: ValidationIssue[];
  status: UnitStatus;
}

export interface InstanceServiceOptions {
  instancesDir: string;
  rtlAirbandBinary: string;
}

/**
 * Orchestrates ConfigStore (file I/O) and SystemdAdapter (process control)
 * behind the "fail closed on any validation error" rule from CLAUDE.md:
 * validation always runs, and completes successfully, before any file is
 * written or any unit is touched.
 */
export class InstanceService {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly systemd: SystemdAdapter,
    private readonly options: InstanceServiceOptions
  ) {}

  async listInstances(): Promise<InstanceSummary[]> {
    const infos = await this.configStore.list();
    return infos.map((info) => ({ name: info.name, confPath: info.confPath, unit: unitFileName(info.name) }));
  }

  async getConfig(name: string): Promise<RtlAirbandConfig> {
    await this.requireExists(name);
    return this.configStore.read(name);
  }

  async getHealth(name: string): Promise<UnitStatus> {
    assertValidInstanceName(name);
    return this.systemd.status(unitFileName(name));
  }

  /** Validates (fail closed on errors), writes, then restarts only this instance's unit. */
  async updateConfig(name: string, config: RtlAirbandConfig): Promise<WriteResult> {
    await this.requireExists(name);
    const { errors, warnings } = validateConfig(config);
    if (errors.length > 0) throw new ValidationFailedError(errors);

    await this.configStore.write(name, config);
    const unit = unitFileName(name);
    await this.systemd.restart(unit);
    const status = await this.systemd.status(unit);
    return { warnings, status };
  }

  async restartInstance(name: string): Promise<UnitStatus> {
    await this.requireExists(name);
    const unit = unitFileName(name);
    await this.systemd.restart(unit);
    return this.systemd.status(unit);
  }

  /** Writes the conf file, installs+enables+starts a new unit. Rolls back the conf file on any systemd failure. */
  async createInstance(name: string, config: RtlAirbandConfig): Promise<WriteResult> {
    assertValidInstanceName(name);
    if (await this.configStore.exists(name)) throw new InstanceAlreadyExistsError(name);

    const { errors, warnings } = validateConfig(config);
    if (errors.length > 0) throw new ValidationFailedError(errors);

    await this.configStore.write(name, config);
    const unit = unitFileName(name);
    const unitContents = renderUnitFile({
      description: `RTLSDR-Airband instance: ${name}`,
      binaryPath: this.options.rtlAirbandBinary,
      confPath: confFilePath(this.options.instancesDir, name),
    });

    try {
      await this.systemd.installUnitFile(unit, unitContents);
      await this.systemd.daemonReload();
      await this.systemd.enable(unit);
      await this.systemd.start(unit);
    } catch (err) {
      await this.configStore.remove(name).catch(() => undefined);
      throw err;
    }

    const status = await this.systemd.status(unit);
    return { warnings, status };
  }

  /**
   * Stops the old unit, stands up the new conf+unit, and only tears down
   * the old unit once the new one is confirmed running — so a failure
   * never leaves the instance running under neither name. Failures before
   * the new unit starts are fully rolled back; failures during old-unit
   * teardown (after the new unit is already up) propagate as errors.
   */
  async renameInstance(oldName: string, newName: string): Promise<WriteResult> {
    assertValidInstanceName(newName);
    await this.requireExists(oldName);

    if (newName === oldName) {
      return { warnings: [], status: await this.systemd.status(unitFileName(oldName)) };
    }
    if (await this.configStore.exists(newName)) throw new InstanceAlreadyExistsError(newName);

    const config = await this.configStore.read(oldName);
    const oldUnit = unitFileName(oldName);
    const newUnit = unitFileName(newName);
    const newUnitContents = renderUnitFile({
      description: `RTLSDR-Airband instance: ${newName}`,
      binaryPath: this.options.rtlAirbandBinary,
      confPath: confFilePath(this.options.instancesDir, newName),
    });

    await this.systemd.stop(oldUnit);

    try {
      await this.configStore.write(newName, config);
      await this.systemd.installUnitFile(newUnit, newUnitContents);
      await this.systemd.daemonReload();
      await this.systemd.enable(newUnit);
      await this.systemd.start(newUnit);
    } catch (err) {
      await this.configStore.remove(newName).catch(() => undefined);
      await this.systemd.removeUnitFile(newUnit).catch(() => undefined);
      await this.systemd.daemonReload().catch(() => undefined);
      await this.systemd.start(oldUnit).catch(() => undefined);
      throw err;
    }

    await this.systemd.disable(oldUnit);
    await this.systemd.removeUnitFile(oldUnit);
    await this.systemd.daemonReload();
    await this.configStore.remove(oldName);

    const status = await this.systemd.status(newUnit);
    return { warnings: [], status };
  }

  /** Stops, disables, and removes both the unit file and the conf file. */
  async deleteInstance(name: string): Promise<void> {
    await this.requireExists(name);
    const unit = unitFileName(name);
    await this.systemd.stop(unit);
    await this.systemd.disable(unit);
    await this.systemd.removeUnitFile(unit);
    await this.systemd.daemonReload();
    await this.configStore.remove(name);
  }

  private async requireExists(name: string): Promise<void> {
    assertValidInstanceName(name);
    if (!(await this.configStore.exists(name))) throw new InstanceNotFoundError(name);
  }
}
