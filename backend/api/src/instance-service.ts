import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { validateConfig, type ValidationIssue, type ValidationResult } from "@rtl-airband-panel/validate";
import type { ConfigStore } from "./config-store.js";
import type { PendingRestartStore } from "./pending-restart-store.js";
import type { InstanceOptions, InstanceOptionsStore } from "./instance-options-store.js";
import type { LogLine, SystemdAdapter, UnitStatus } from "./systemd/types.js";
import { assertValidInstanceName, confFilePath, unitFileName } from "./instance-name.js";
import { renderUnitFile } from "./unit-template.js";
import { redactSecrets, restoreSecrets } from "./secrets.js";
import { KeyedMutex } from "./keyed-mutex.js";

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
  /** See InstanceOptions.jsonLogging. */
  jsonLogging: boolean;
  /**
   * Every free-text term worth matching a global search against: channel
   * labels (multichannel `label` and scan-mode `labels[]`), each channel's
   * frequency formatted in MHz, each channel's modulation, and each
   * device's type/serial -- so e.g. searching "146.94" or "nfm" or "rtlsdr"
   * surfaces the right instance, not just a search on channel labels.
   */
  searchFields: string[];
}

/** Hz -> MHz string with no trailing zeros, matching how a user would type a frequency (e.g. 146940000 -> "146.94"). */
function formatFreqMHz(hz: number): string {
  return (hz / 1_000_000).toString();
}

/** Every searchable term on a config, across all devices/channels -- see `InstanceSummary.searchFields` for exactly what's included and why. */
function extractSearchFields(config: RtlAirbandConfig): string[] {
  const fields: string[] = [];
  for (const device of config.devices) {
    fields.push(device.type);
    if (device.serial) fields.push(device.serial);
    for (const channel of device.channels) {
      if ("freqs" in channel) {
        for (const label of channel.labels ?? []) if (label) fields.push(label);
        for (const freq of channel.freqs) fields.push(formatFreqMHz(freq));
        if (channel.modulation) fields.push(channel.modulation);
        for (const mod of channel.modulations ?? []) if (mod) fields.push(mod);
      } else {
        if (channel.label) fields.push(channel.label);
        fields.push(formatFreqMHz(channel.freq));
        if (channel.modulation) fields.push(channel.modulation);
      }
    }
  }
  return fields;
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
  // Serializes create/update/restart/rename/delete per instance name, so two
  // overlapping requests for the same instance (two browser tabs, a retry
  // racing the original) can't both slip through a check-then-act window --
  // e.g. both seeing an instance "doesn't exist yet" and both creating it, or
  // both seeing an ifMatch version as current and both writing. Reads
  // (getConfig, validateOnly, ...) don't participate: ConfigStore.write's
  // temp-file+rename is already atomic, so a concurrent read only ever sees
  // a fully-old or fully-new file, never a partial one.
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly systemd: SystemdAdapter,
    private readonly pendingRestartStore: PendingRestartStore,
    private readonly instanceOptionsStore: InstanceOptionsStore,
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
        jsonLogging: (await this.instanceOptionsStore.get(info.name)).jsonLogging,
        searchFields: await this.getSearchFields(info.name),
      }))
    );
  }

  /** Empty (rather than throwing) for a config that fails to parse -- an unparsable
   *  instance just won't be searchable until it's fixed, but it must still
   *  show up in the list. */
  private async getSearchFields(name: string): Promise<string[]> {
    try {
      return extractSearchFields(await this.configStore.read(name));
    } catch {
      return [];
    }
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

  /**
   * Unredacted config, for the "reveal" action on a password/API-key field the
   * frontend is currently showing as `REDACTED_SECRET`. Deliberately a separate,
   * explicitly-opted-into call rather than a flag on `getConfigWithVersion` — the
   * whole point of redacting by default is that a plain GET never carries a real
   * secret, so revealing one has to be a distinct action, not an easy-to-flip option
   * on the common path.
   */
  async getSecrets(name: string): Promise<RtlAirbandConfig> {
    await this.requireExists(name);
    return this.configStore.read(name);
  }

  async getHealth(name: string): Promise<UnitStatus> {
    assertValidInstanceName(name);
    return this.systemd.status(unitFileName(name));
  }

  private static readonly MIN_LOG_LINES = 10;
  private static readonly MAX_LOG_LINES = 2000;
  private static readonly DEFAULT_LOG_LINES = 200;

  /** Clamps an arbitrary client-supplied "how many lines" request into a sane range before it ever reaches a shelled-out journalctl invocation. */
  private static clampLogLines(lines: number | undefined): number {
    if (lines === undefined || !Number.isFinite(lines)) return InstanceService.DEFAULT_LOG_LINES;
    return Math.min(InstanceService.MAX_LOG_LINES, Math.max(InstanceService.MIN_LOG_LINES, Math.trunc(lines)));
  }

  async getLogs(name: string, lines?: number): Promise<LogLine[]> {
    assertValidInstanceName(name);
    return this.systemd.getLogs(unitFileName(name), InstanceService.clampLogLines(lines));
  }

  followLogs(name: string, lines: number | undefined, signal: AbortSignal): AsyncGenerator<LogLine> {
    assertValidInstanceName(name);
    return this.systemd.followLogs(unitFileName(name), InstanceService.clampLogLines(lines), signal);
  }

  /**
   * Runs the same validation updateConfig would, without writing anything or
   * touching systemd — lets a client check "would this save?" (e.g. before
   * committing to a Save-and-restart, which interrupts live audio) without
   * the side effects. Never throws on validation failure; the caller reads
   * `errors`/`warnings` directly, same shape as updateConfig's ValidationFailedError.errors.
   */
  async validateOnly(name: string, config: RtlAirbandConfig): Promise<ValidationResult> {
    await this.requireExists(name);
    const { config: existing } = await this.configStore.readWithVersion(name);
    const restored = restoreSecrets(config, existing);
    return validateConfig(restored);
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
    return this.mutex.run(name, async () => {
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
    });
  }

  /**
   * Updates panel-only, non-.conf per-instance settings that affect the
   * generated unit's ExecStart (currently just jsonLogging, i.e. -j) --
   * regenerates and reinstalls the unit file with the new flag(s), then
   * behaves like updateConfig's restart handling: marks pending-restart
   * immediately (an ExecStart change needs a restart to take effect, same
   * as a .conf write), and restarts unless `restart: false` is passed.
   */
  async updateInstanceOptions(
    name: string,
    patch: Partial<InstanceOptions>,
    opts: { restart?: boolean } = {}
  ): Promise<{ status: UnitStatus; options: InstanceOptions }> {
    return this.mutex.run(name, async () => {
      await this.requireExists(name);
      const restart = opts.restart ?? true;
      const merged = await this.instanceOptionsStore.set(name, patch);
      const unit = unitFileName(name);
      const unitContents = renderUnitFile({
        description: `RTLSDR-Airband instance: ${name}`,
        binaryPath: this.options.rtlAirbandBinary,
        confPath: confFilePath(this.options.instancesDir, name),
        jsonLogging: merged.jsonLogging,
      });
      await this.systemd.installUnitFile(unit, unitContents);
      await this.systemd.daemonReload();
      await this.pendingRestartStore.mark(name);
      if (restart) {
        await this.systemd.restart(unit);
        await this.pendingRestartStore.clear(name);
      }
      const status = await this.systemd.status(unit);
      return { status, options: merged };
    });
  }

  async restartInstance(name: string): Promise<UnitStatus> {
    return this.mutex.run(name, async () => {
      await this.requireExists(name);
      const unit = unitFileName(name);
      await this.systemd.restart(unit);
      await this.pendingRestartStore.clear(name);
      return this.systemd.status(unit);
    });
  }

  /**
   * Restarts every instance currently marked pending-restart, so an operator
   * who saved several instances with `restart: false` doesn't have to click
   * restart on each one individually. One instance's restart failing doesn't
   * stop the rest — each result is reported independently.
   */
  async restartAllPending(): Promise<Record<string, { status: UnitStatus } | { error: string }>> {
    const summaries = await this.listInstances();
    const results: Record<string, { status: UnitStatus } | { error: string }> = {};
    for (const { name, pendingRestart } of summaries) {
      if (!pendingRestart) continue;
      try {
        results[name] = { status: await this.restartInstance(name) };
      } catch (err) {
        results[name] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return results;
  }

  /**
   * A faithful backup of every instance's config, meant for migrating hosts
   * or backing up before a risky change — deliberately unredacted (unlike
   * getConfig), since a backup that's missing its Icecast passwords/
   * rdio-scanner API keys on restore isn't a usable backup.
   */
  async exportAll(): Promise<{ instances: Record<string, RtlAirbandConfig> }> {
    const summaries = await this.listInstances();
    const instances: Record<string, RtlAirbandConfig> = {};
    for (const { name } of summaries) {
      instances[name] = await this.configStore.read(name);
    }
    return { instances };
  }

  /**
   * Creates every instance in the bundle that doesn't already exist. An
   * instance whose name collides with an existing one is skipped, not
   * overwritten — importing is for standing up new instances (e.g. on a new
   * host), not for bulk-editing existing ones. Each instance's outcome is
   * independent, same as restartAllPending.
   */
  async importAll(
    bundle: { instances: Record<string, RtlAirbandConfig> }
  ): Promise<Record<string, { status: "created" } | { status: "skipped" } | { status: "failed"; error: string }>> {
    const results: Record<string, { status: "created" } | { status: "skipped" } | { status: "failed"; error: string }> = {};
    for (const [name, config] of Object.entries(bundle.instances)) {
      try {
        await this.createInstance(name, config);
        results[name] = { status: "created" };
      } catch (err) {
        results[name] = err instanceof InstanceAlreadyExistsError ? { status: "skipped" } : { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    }
    return results;
  }

  /** Writes the conf file, installs+enables+starts a new unit. Rolls back the conf file on any systemd failure. */
  async createInstance(name: string, config: RtlAirbandConfig): Promise<WriteResult> {
    assertValidInstanceName(name);
    return this.mutex.run(name, async () => {
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
    });
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
    // Locks both names (sorted, so any two renames always acquire in the same
    // order and can't deadlock each other) -- prevents e.g. a concurrent
    // createInstance(newName) or updateConfig(oldName) from racing the rename.
    const keys = [...new Set([oldName, newName])].sort();
    const run = () => this.renameInstanceLocked(oldName, newName);
    return keys.length === 1 ? this.mutex.run(keys[0]!, run) : this.mutex.run(keys[0]!, () => this.mutex.run(keys[1]!, run));
  }

  private async renameInstanceLocked(oldName: string, newName: string): Promise<WriteResult> {
    await this.requireExists(oldName);

    if (newName === oldName) {
      const { version } = await this.configStore.readWithVersion(oldName);
      return { warnings: [], status: await this.systemd.status(unitFileName(oldName)), version };
    }
    if (await this.configStore.exists(newName)) throw new InstanceAlreadyExistsError(newName);

    const { config } = await this.configStore.readWithVersion(oldName);
    const oldUnit = unitFileName(oldName);
    const newUnit = unitFileName(newName);
    const instanceOptions = await this.instanceOptionsStore.get(oldName);
    const newUnitContents = renderUnitFile({
      description: `RTLSDR-Airband instance: ${newName}`,
      binaryPath: this.options.rtlAirbandBinary,
      confPath: confFilePath(this.options.instancesDir, newName),
      jsonLogging: instanceOptions.jsonLogging,
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
    await this.instanceOptionsStore.rename(oldName, newName);

    const status = await this.systemd.status(newUnit);
    return { warnings: [], status, version };
  }

  /** Stops, disables, and removes both the unit file and the conf file. */
  async deleteInstance(name: string): Promise<void> {
    await this.mutex.run(name, async () => {
      await this.requireExists(name);
      const unit = unitFileName(name);
      await this.systemd.stop(unit);
      await this.systemd.disable(unit);
      await this.systemd.removeUnitFile(unit);
      await this.systemd.daemonReload();
      await this.configStore.remove(name);
      await this.pendingRestartStore.clear(name);
      await this.instanceOptionsStore.remove(name);
    });
  }

  private async requireExists(name: string): Promise<void> {
    assertValidInstanceName(name);
    if (!(await this.configStore.exists(name))) throw new InstanceNotFoundError(name);
  }
}
