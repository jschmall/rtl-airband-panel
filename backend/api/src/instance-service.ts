import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { validateConfig, type ValidationIssue } from "@rtl-airband-panel/validate";
import type { ConfigStore } from "./config-store.js";
import type { PendingRestartStore } from "./pending-restart-store.js";
import type { SystemdAdapter, UnitStatus } from "./systemd/types.js";
import { assertValidInstanceName, confFilePath, unitFileName } from "./instance-name.js";
import { renderUnitFile } from "./unit-template.js";
import { redactSecrets, restoreSecrets } from "./secrets.js";

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

export class ConfigConflictError extends Error {
  constructor(name: string) {
    super(`'${name}' was changed on disk since this copy was loaded — reload it and re-apply your edits before saving again`);
    this.name = "ConfigConflictError";
  }
}

export interface InstanceSummary {
  name: string;
  confPath: string;
  unit: string;
  /** True if the .conf on disk has been saved since the running unit last (re)started, so it's not live yet. */
  pendingRestart: boolean;
}

export interface WriteResult {
  warnings: ValidationIssue[];
  status: UnitStatus;
  /** The written config's new version identifier — pass as `ifMatch` on the next updateConfig call to detect a conflicting edit. */
  version: string;
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
    private readonly pendingRestartStore: PendingRestartStore,
    private readonly options: InstanceServiceOptions
  ) {}

  async listInstances(): Promise<InstanceSummary[]> {
    const infos = await this.configStore.list();
    return Promise.all(
      infos.map(async (info) => ({
        name: info.name,
        confPath: info.confPath,
        unit: unitFileName(info.name),
        pendingRestart: await this.pendingRestartStore.has(info.name),
      }))
    );
  }

  async getConfig(name: string): Promise<RtlAirbandConfig> {
    return (await this.getConfigWithVersion(name)).config;
  }

  /** Like `getConfig`, but also returns a version identifier for optimistic concurrency — see `updateConfig`'s `ifMatch` option. */
  async getConfigWithVersion(name: string): Promise<{ config: RtlAirbandConfig; version: string }> {
    await this.requireExists(name);
    const { config, version } = await this.configStore.readWithVersion(name);
    return { config: redactSecrets(config), version };
  }

  async getHealth(name: string): Promise<UnitStatus> {
    assertValidInstanceName(name);
    return this.systemd.status(unitFileName(name));
  }

  /**
   * Validates (fail closed on errors), writes, then restarts only this
   * instance's unit — unless `restart: false` is passed, in which case the
   * conf file is written but the running process (if any) keeps running on
   * its old, in-memory config until an explicit restart. RTLSDR-Airband has
   * no live-reload, so a write-only save never takes effect on its own.
   *
   * If `ifMatch` is passed (the `version` from a prior getConfigWithVersion/
   * updateConfig call), this throws ConfigConflictError instead of writing
   * when the on-disk config has changed since — e.g. two browser tabs, or two
   * people, editing the same instance. Omitting it skips the check entirely
   * (last-write-wins, the previous behavior), so existing callers are
   * unaffected until they opt in.
   */
  async updateConfig(name: string, config: RtlAirbandConfig, options: { restart?: boolean; ifMatch?: string } = {}): Promise<WriteResult> {
    const restart = options.restart ?? true;
    await this.requireExists(name);
    const { config: existing, version } = await this.configStore.readWithVersion(name);
    if (options.ifMatch !== undefined && options.ifMatch !== version) {
      throw new ConfigConflictError(name);
    }
    const restored = restoreSecrets(config, existing);
    const { errors, warnings } = validateConfig(restored);
    if (errors.length > 0) throw new ValidationFailedError(errors);

    const newVersion = await this.configStore.write(name, restored);
    const unit = unitFileName(name);
    // Marked as pending the moment the file is written, regardless of whether the
    // restart below succeeds — a failed restart still leaves the on-disk config
    // ahead of whatever the running process has loaded, so "pending" must already
    // be true before we find out whether restart() throws, not only if it doesn't.
    await this.pendingRestartStore.mark(name);
    if (restart) {
      await this.systemd.restart(unit);
      await this.pendingRestartStore.clear(name);
    }
    const status = await this.systemd.status(unit);
    return { warnings, status, version: newVersion };
  }

  async restartInstance(name: string): Promise<UnitStatus> {
    await this.requireExists(name);
    const unit = unitFileName(name);
    await this.systemd.restart(unit);
    await this.pendingRestartStore.clear(name);
    return this.systemd.status(unit);
  }

  /** Writes the conf file, installs+enables+starts a new unit. Rolls back the conf file on any systemd failure. */
  async createInstance(name: string, config: RtlAirbandConfig): Promise<WriteResult> {
    assertValidInstanceName(name);
    if (await this.configStore.exists(name)) throw new InstanceAlreadyExistsError(name);

    const restored = restoreSecrets(config, undefined);
    const { errors, warnings } = validateConfig(restored);
    if (errors.length > 0) throw new ValidationFailedError(errors);

    const version = await this.configStore.write(name, restored);
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
      // Mirrors renameInstance's rollback: undo whichever of the steps above
      // actually happened, not just the conf file — a failure after
      // installUnitFile succeeds (daemonReload/enable/start) used to leave an
      // orphaned unit file on disk referencing a .conf that was just deleted.
      await this.configStore.remove(name).catch(() => undefined);
      await this.systemd.removeUnitFile(unit).catch(() => undefined);
      await this.systemd.daemonReload().catch(() => undefined);
      throw err;
    }

    const status = await this.systemd.status(unit);
    return { warnings, status, version };
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
      const { version } = await this.configStore.readWithVersion(oldName);
      return { warnings: [], status: await this.systemd.status(unitFileName(oldName)), version };
    }
    if (await this.configStore.exists(newName)) throw new InstanceAlreadyExistsError(newName);

    const { config } = await this.configStore.readWithVersion(oldName);
    const oldUnit = unitFileName(oldName);
    const newUnit = unitFileName(newName);
    const newUnitContents = renderUnitFile({
      description: `RTLSDR-Airband instance: ${newName}`,
      binaryPath: this.options.rtlAirbandBinary,
      confPath: confFilePath(this.options.instancesDir, newName),
    });

    await this.systemd.stop(oldUnit);

    let version: string;
    try {
      version = await this.configStore.write(newName, config);
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
    // newUnit just started fresh against the current .conf contents, so
    // whatever was pending under oldName is now applied; nothing carries over.
    await this.pendingRestartStore.clear(oldName);

    const status = await this.systemd.status(newUnit);
    return { warnings: [], status, version };
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
    await this.pendingRestartStore.clear(name);
  }

  private async requireExists(name: string): Promise<void> {
    assertValidInstanceName(name);
    if (!(await this.configStore.exists(name))) throw new InstanceNotFoundError(name);
  }
}
