import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { RtlAirbandConfig } from "../types/config.js";
import type { ValidationIssue } from "../types/config.js";
import { api, ApiError, type AirbandBuild, type LiveApplyOutcome } from "../api/client.js";
import { AirbandBanner } from "../components/AirbandBanner.js";
import { AirbandBuildProvider } from "../state/AirbandBuildContext.js";
import { buildLabel, hasFeature } from "../lib/airband-build.js";
import { ConfigEditor } from "../components/ConfigEditor.js";
import { ValidationBanner } from "../components/ValidationBanner.js";
import { GuardedLink } from "../components/GuardedLink.js";
import { InstanceLogs } from "../components/InstanceLogs.js";
import { InstanceServiceAccount } from "../components/InstanceServiceAccount.js";
import { useInstanceList } from "../state/InstanceListContext.js";
import { useUnsavedChanges } from "../state/UnsavedChangesContext.js";
import { assignUiKeysDeep, stampOutputMatchIndices } from "../lib/keys.js";
import { getValueAtPath } from "../lib/validation-path.js";
import { classifySkippedRequiresRestart } from "../lib/live-apply.js";
import { formatUptime } from "../lib/time-format.js";
import { ChangePreview, usePlanPreview } from "../components/ChangePreview.js";
import { useLiveValidation } from "../lib/live-validation.js";
import { HealthStatus } from "../components/HealthLight.js";
import { InstanceActions } from "../components/InstanceActions.js";

interface LoadError {
  /** "not-found" gets its own messaging (nothing to retry -- the instance is gone);
   *  everything else (network failure, 500, ...) gets a Retry button, since those
   *  are plausibly transient. */
  kind: "not-found" | "other";
  message: string;
}

export function InstanceEditPage() {
  const { name } = useParams<{ name: string }>();
  const { instances, refresh: refreshInstanceList, pollBriefly } = useInstanceList();
  const { setDirty } = useUnsavedChanges();
  const [config, setConfig] = useState<RtlAirbandConfig | null>(null);
  // The last-loaded-or-saved config, compared against the live-edited `config`
  // to decide whether there's anything unsaved -- see the `isDirty` effect below.
  const [savedConfig, setSavedConfig] = useState<RtlAirbandConfig | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [errors, setErrors] = useState<ValidationIssue[]>([]);
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);
  const [warningsDismissed, setWarningsDismissed] = useState(false);
  const [pendingAction, setPendingAction] = useState<"save" | "restart" | "apply-live" | "check" | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // Result of the most recent "Apply live" click -- kept separate from the plain-string
  // savedMessage above since it needs to render two lists (applied/skipped), not one line.
  const [liveApplyResult, setLiveApplyResult] = useState<LiveApplyOutcome | null>(null);
  // Set when the user clicks a validation issue in the banner -- nonce is bumped
  // (not just the path) so clicking the same issue twice still re-triggers the
  // scroll/expand even though the path string didn't change. See Collapsible's
  // openSignal prop.
  const [jumpTarget, setJumpTarget] = useState<{ path: string; nonce: number } | null>(null);
  const [jsonLoggingPending, setJsonLoggingPending] = useState(false);
  const [serviceAccountPending, setServiceAccountPending] = useState(false);
  const [airband, setAirband] = useState<AirbandBuild | null>(null);

  // Tracks the instance this page is currently showing, so an in-flight
  // save/check for the *previous* instance can tell it's stale once the user
  // has navigated away, and skip applying its result to this instance's state.
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  // Validation state (errors/warnings/etc.) is a result of an action taken
  // against one specific instance -- it must not carry over when the user
  // switches to editing a different instance's config.
  useEffect(() => {
    setErrors([]);
    setWarnings([]);
    setWarningsDismissed(false);
    setSavedMessage(null);
    setLiveApplyResult(null);
    setPendingAction(null);
  }, [name]);

  const loadConfig = useCallback(() => {
    if (!name) return;
    setLoadError(null);
    api
      .getConfig(name)
      .then(({ config, version }) => {
        // Nothing server-side knows about these keys -- assign them once, here,
        // so every device/channel/output/mixer keeps its own UI state (open/
        // closed, remembered type-cache) even as items before it in a list are
        // added or removed. See lib/keys.ts. stampOutputMatchIndices also
        // records each output's load-time position, so a later save can
        // restore a still-redacted secret onto the right on-disk output even
        // if an earlier output in the same list was duplicated or removed.
        const keyed = stampOutputMatchIndices(assignUiKeysDeep(config));
        setConfig(keyed);
        setSavedConfig(keyed);
        setVersion(version);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setLoadError({ kind: "not-found", message: `Instance '${name}' wasn't found -- it may have been deleted or renamed.` });
        } else if (err instanceof ApiError) {
          setLoadError({ kind: "other", message: err.message });
        } else {
          setLoadError({ kind: "other", message: "Couldn't reach the server. Check your connection and try again." });
        }
      });
  }, [name]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Which rtl_airband this instance runs, for soft-locking fork-only
  // features. Failing to find out locks nothing.
  const loadAirband = useCallback(() => {
    if (!name) return;
    api
      .getAirband(name)
      .then((build) => {
        if (nameRef.current === name) setAirband(build);
      })
      .catch(() => {
        if (nameRef.current === name) setAirband(null);
      });
  }, [name]);

  useEffect(() => {
    setAirband(null);
    loadAirband();
  }, [loadAirband]);

  // Two full-tree JSON.stringify passes over the whole config -- memoized so
  // it only re-runs when config/savedConfig actually change identity, not on
  // every render (e.g. the background instance-list poll re-rendering this
  // page while the user is mid-edit and neither config nor savedConfig moved).
  const isDirty = useMemo(
    () => config !== null && savedConfig !== null && JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig]
  );

  // Covers an actual tab close/refresh/navigating to a URL outside the SPA.
  // In-app navigation (sidebar, header logo, "View stats") goes through
  // GuardedLink/GuardedNavLink instead, which reads the same shared flag.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    setDirty(isDirty);
  }, [isDirty, setDirty]);

  const summary = instances?.find((i) => i.name === name);
  // Preview whatever isn't running yet: unsaved edits, or a saved-but-unapplied config.
  const predicted = usePlanPreview(name, config, isDirty || summary?.pendingRestart === true);
  // A build without the fork's control socket can't apply anything live.
  const liveCapable = hasFeature(airband, "control_socket");
  const plan =
    predicted && !liveCapable && predicted.method === "live"
      ? { ...predicted, method: "restart" as const, restart: [...predicted.restart, ...predicted.live], live: [], interrupts: [] }
      : predicted;
  // The server's validator running in the browser: errors show up while
  // editing. Results from an actual save/check (incl. conflicts) take priority.
  const buildFeatures = airband && airband.kind !== "unknown" ? airband.features : null;
  const live = useLiveValidation(config, isDirty, buildFeatures);
  const liveErrors = errors.length === 0 ? (live?.errors ?? []) : [];

  // Don't leave the flag set for the next page this component happens to render for.
  useEffect(() => () => setDirty(false), [setDirty]);

  // Ctrl/Cmd+S saves without restarting -- the less disruptive of the two
  // actions, matching the "just save my work" intent of the shortcut.
  // Save-and-restart stays a deliberate button click, since it interrupts
  // live audio and already has its own confirm dialog.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void handleSave(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Only ever called from a PasswordInput's "Show" click on a field still holding
  // the server's redaction placeholder -- fetches the unredacted config fresh
  // each time rather than caching it, since revealing a secret should stay a
  // deliberate, infrequent action (see backend `getSecrets`/`/secrets` route).
  // useCallback (not a plain function) so this stays a stable prop identity down
  // through ConfigEditor -- otherwise it alone would defeat React.memo on every
  // device/channel/output editor on every keystroke, regardless of the other
  // memoization work in that tree.
  const revealSecret = useCallback(
    async (fieldPath: string): Promise<string> => {
      if (!name) return "";
      const raw = await api.getSecrets(name);
      const value = getValueAtPath(raw, fieldPath);
      return typeof value === "string" ? value : "";
    },
    [name]
  );

  async function handleSave(restart: boolean) {
    if (!name || !config || pendingAction) return;
    if (restart && !window.confirm(`Restart '${name}'? This applies the saved changes but interrupts live audio for a few seconds while it restarts.`)) {
      return;
    }
    setPendingAction(restart ? "restart" : "save");
    setErrors([]);
    setSavedMessage(null);
    setLiveApplyResult(null);
    try {
      const result = await api.updateConfig(name, config, { restart, ifMatch: version ?? undefined });
      // The user may have navigated to a different instance while this request
      // was in flight -- its result belongs to `name`, not whatever instance
      // this page happens to be showing now, so drop it rather than let it
      // clobber that instance's state.
      if (nameRef.current !== name) return;
      setWarnings(result.warnings);
      setWarningsDismissed(false);
      setVersion(result.version);
      setSavedConfig(config);
      setSavedMessage(
        restart
          ? `Saved and restarted ${name}.service (${result.status.activeState}).`
          : `Saved ${name}.conf. Changes will take effect after a restart.`
      );
      await refreshInstanceList();
      loadAirband(); // a (re)started process can answer the control-socket check now
      // The unit may still be settling (activating -> active/failed) -- keep the
      // sidebar's health badge for this instance updating for a few more seconds
      // instead of freezing on whatever snapshot the request above happened to catch.
      if (restart) pollBriefly();
    } catch (err) {
      if (nameRef.current !== name) return;
      if (err instanceof ApiError && err.status === 422 && err.body.errors) {
        setErrors(err.body.errors);
      } else if (err instanceof ApiError && err.status === 409) {
        setErrors([
          {
            severity: "error",
            code: "conflict",
            path: "$",
            message: `${err.message}. Your unsaved edits are still here below — reload the page to see the latest version, then re-apply them before saving.`,
          },
        ]);
      } else {
        setErrors([
          {
            severity: "error",
            code: "request-failed",
            path: "$",
            message: err instanceof ApiError ? err.message : "Save failed",
          },
        ]);
      }
    } finally {
      if (nameRef.current === name) setPendingAction(null);
    }
  }

  // Saves, then asks the running process to live-apply whatever it safely can via its
  // dynamic_reload control socket instead of restarting. Only ever offered (see the
  // button below) when the *saved* config already has control_socket_path set, since
  // the currently-running process won't have it otherwise either.
  async function handleApplyLive() {
    if (!name || !config || pendingAction) return;
    if (
      !window.confirm(
        `Apply changes to '${name}' live? This saves the config and asks the running process to pick up whatever it can without restarting (retune, sample rate, gain, tuner bandwidth, correction, channel/mixer on/off, and adding, editing, or removing channels within a device's reserved headroom). Some changes (device/mixer count, driver type, etc.) always require a restart regardless.`
      )
    ) {
      return;
    }
    setPendingAction("apply-live");
    setErrors([]);
    setSavedMessage(null);
    setLiveApplyResult(null);
    try {
      const result = await api.applyConfigLive(name, config, { ifMatch: version ?? undefined });
      if (nameRef.current !== name) return;
      setWarnings(result.warnings);
      setWarningsDismissed(false);
      setVersion(result.version);
      setSavedConfig(config);
      setLiveApplyResult(result.liveApply);
      await refreshInstanceList();
      loadAirband(); // a (re)started process can answer the control-socket check now
    } catch (err) {
      if (nameRef.current !== name) return;
      if (err instanceof ApiError && err.status === 422 && err.body.errors) {
        setErrors(err.body.errors);
      } else if (err instanceof ApiError && err.status === 409) {
        setErrors([
          {
            severity: "error",
            code: "conflict",
            path: "$",
            message: `${err.message}. Your unsaved edits are still here below — reload the page to see the latest version, then re-apply them before saving.`,
          },
        ]);
      } else {
        setErrors([
          {
            severity: "error",
            code: "request-failed",
            path: "$",
            message: err instanceof ApiError ? err.message : "Apply live failed",
          },
        ]);
      }
    } finally {
      if (nameRef.current === name) setPendingAction(null);
    }
  }

  // Runs the same validation a save would, without writing or restarting anything --
  // an early-warning convenience so the user can find problems before committing to
  // Save-and-restart, which interrupts live audio.
  async function handleCheck() {
    if (!name || !config || pendingAction) return;
    setPendingAction("check");
    setSavedMessage(null);
    setLiveApplyResult(null);
    try {
      const result = await api.validate(name, config);
      if (nameRef.current !== name) return;
      setErrors(result.errors);
      setWarnings(result.warnings);
      setWarningsDismissed(false);
    } catch (err) {
      if (nameRef.current !== name) return;
      setErrors([
        {
          severity: "error",
          code: "request-failed",
          path: "$",
          message: err instanceof ApiError ? err.message : "Check failed",
        },
      ]);
    } finally {
      if (nameRef.current === name) setPendingAction(null);
    }
  }

  // Toggles the -j (JSON logging) flag on this instance's unit -- a panel-only,
  // non-.conf setting (see InstanceOptionsStore), so it's applied immediately
  // via its own endpoint rather than folded into handleSave. Like Save-and-
  // restart, changing it restarts the running process, so it gets the same
  // confirm-before-interrupting-audio treatment.
  async function handleToggleJsonLogging(next: boolean) {
    if (!name || jsonLoggingPending) return;
    const verb = next ? "Enable" : "Disable";
    if (!window.confirm(`${verb} JSON logging for '${name}'? This restarts the instance, interrupting live audio for a few seconds.`)) {
      return;
    }
    setJsonLoggingPending(true);
    try {
      await api.updateInstanceOptions(name, { jsonLogging: next });
      await refreshInstanceList();
      loadAirband(); // the unit was rewritten: it may run another binary now
      pollBriefly();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Failed to update JSON logging");
    } finally {
      setJsonLoggingPending(false);
    }
  }

  // Updates the systemd unit's User=/Group= -- a panel-only, non-.conf setting
  // (see InstanceOptionsStore), same restart-on-change contract as
  // handleToggleJsonLogging above. Passing "" for either field clears a
  // previously-set value back to unset (see extractInstanceOptionsPatch).
  async function handleUpdateServiceAccount(serviceUser: string, serviceGroup: string) {
    if (!name || serviceAccountPending) return;
    if (
      !window.confirm(`Update the service account for '${name}'? This restarts the instance, interrupting live audio for a few seconds.`)
    ) {
      return;
    }
    setServiceAccountPending(true);
    try {
      await api.updateInstanceOptions(name, { serviceUser, serviceGroup });
      await refreshInstanceList();
      loadAirband(); // the unit was rewritten: it may run another binary now
      pollBriefly();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Failed to update service account");
    } finally {
      setServiceAccountPending(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 rounded border border-red-500/40 bg-red-500/10 p-4">
        <p className="text-red-300">{loadError.message}</p>
        <div className="flex gap-3 text-sm">
          {loadError.kind === "other" && (
            <button type="button" onClick={loadConfig} className="text-sky-400 hover:text-sky-300">
              Retry
            </button>
          )}
          <GuardedLink to="/" className="text-sky-400 hover:text-sky-300">
            Back to instances
          </GuardedLink>
        </div>
      </div>
    );
  }
  if (!config) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-slate-50">{name}</h1>
          {summary && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
              <HealthStatus state={summary.status.activeState} subState={summary.status.subState} />
              {summary.status.activeState === "active" && <span>up {formatUptime(summary.status.activeEnterTimestamp)}</span>}
              <span className="font-mono text-xs text-slate-500">{summary.unit}</span>
              {airband && <span className="text-xs text-slate-500">{buildLabel(airband)}</span>}
              {summary.pendingRestart && (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-300">
                  Saved config not running yet
                </span>
              )}
              <GuardedLink to="/stats" state={{ instanceName: name }} className="text-sky-400 hover:text-sky-300">
                Stats →
              </GuardedLink>
            </p>
          )}
        </div>
        {name && <InstanceActions name={name} />}
      </div>

      <AirbandBanner build={airband} />
      <ValidationBanner
        errors={errors.length > 0 ? errors : liveErrors}
        warnings={warningsDismissed ? [] : warnings}
        config={config}
        onJumpTo={(path) => setJumpTarget({ path, nonce: Date.now() })}
        onDismissWarnings={() => setWarningsDismissed(true)}
      />
      {savedMessage && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">{savedMessage}</div>
      )}
      {liveApplyResult && <LiveApplyBanner name={name} outcome={liveApplyResult} />}

      <AirbandBuildProvider value={airband}>
        <ConfigEditor
          config={config}
          onChange={setConfig}
          jumpTarget={jumpTarget}
          onRevealSecret={revealSecret}
          afterGlobalSettings={
            name && (
              <>
                <InstanceLogs
                  name={name}
                  jsonLogging={instances?.find((i) => i.name === name)?.jsonLogging ?? false}
                  jsonLoggingPending={jsonLoggingPending}
                  onToggleJsonLogging={(next) => void handleToggleJsonLogging(next)}
                />
                <InstanceServiceAccount
                  name={name}
                  serviceUser={instances?.find((i) => i.name === name)?.serviceUser}
                  serviceGroup={instances?.find((i) => i.name === name)?.serviceGroup}
                  controlSocketPathSet={savedConfig?.control_socket_path !== undefined}
                  pending={serviceAccountPending}
                  onSave={(user, group) => void handleUpdateServiceAccount(user, group)}
                />
              </>
            )
          }
        />
      </AirbandBuildProvider>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        {liveErrors.length > 0 && (
          <button
            type="button"
            onClick={() => setJumpTarget({ path: liveErrors[0]!.path, nonce: Date.now() })}
            title={liveErrors[0]!.message}
            className="flex-shrink-0 text-sm text-red-300 underline decoration-dotted hover:text-red-200"
          >
            {liveErrors.length} error{liveErrors.length === 1 ? "" : "s"} to fix before saving
          </button>
        )}
        {plan && <ChangePreview plan={plan} />}
        <button
          type="button"
          disabled={pendingAction !== null}
          onClick={() => void handleCheck()}
          className="rounded border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {pendingAction === "check" ? "Checking…" : "Check config"}
        </button>
        <button
          type="button"
          disabled={pendingAction !== null}
          onClick={() => void handleSave(false)}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {pendingAction === "save" ? "Saving…" : "Save"}
        </button>
        {savedConfig?.control_socket_path !== undefined && liveCapable && (
          <button
            type="button"
            disabled={pendingAction !== null}
            onClick={() => void handleApplyLive()}
            className={
              plan?.method === "restart"
                ? "rounded border border-emerald-600/60 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-600/10 disabled:opacity-50"
                : "rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            }
          >
            {pendingAction === "apply-live" ? "Applying…" : "Apply live"}
          </button>
        )}
        <button
          type="button"
          disabled={pendingAction !== null}
          onClick={() => void handleSave(true)}
          className={
            plan?.method === "live"
              ? "rounded border border-red-600/60 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-600/10 disabled:opacity-50"
              : "rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          }
        >
          {pendingAction === "restart" ? "Restarting…" : "Save and restart"}
        </button>
      </div>
    </div>
  );
}

/** Renders the result of the most recent "Apply live" click -- see handleApplyLive above. */
function LiveApplyBanner({ name, outcome }: { name: string | undefined; outcome: LiveApplyOutcome }) {
  if (outcome.attempted) {
    if (outcome.skippedRequiresRestart.length === 0) {
      return (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          Applied live to {name}.service — nothing left pending.
        </div>
      );
    }
    const { needsRestart, retryable } = classifySkippedRequiresRestart(outcome.skippedRequiresRestart);
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
        <p>
          Applied {outcome.applied.length} change{outcome.applied.length === 1 ? "" : "s"} live to {name}.service.
        </p>
        {needsRestart.length > 0 && (
          <>
            <p className="mt-2">
              {needsRestart.length} still need{needsRestart.length === 1 ? "s" : ""} a restart:
            </p>
            <ul className="mt-1 list-inside list-disc">
              {needsRestart.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
        {retryable.length > 0 && (
          <>
            <p className="mt-2">
              {retryable.length} didn't take — no restart needed, click "Apply live" again to retry:
            </p>
            <ul className="mt-1 list-inside list-disc">
              {retryable.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
        {outcome.applied.length > 0 && (
          <>
            <p className="mt-2 text-amber-300/70">Applied:</p>
            <ul className="mt-1 list-inside list-disc text-amber-300/70">
              {outcome.applied.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (outcome.reason === "stock-rtl-airband") {
    return (
      <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
        Saved {name}.conf. Changes will take effect after a restart — this instance runs a stock rtl_airband, which has no control socket to apply them
        live.
      </div>
    );
  }

  if (outcome.reason === "no-control-socket") {
    return (
      <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
        Saved {name}.conf. Changes will take effect after a restart — this instance has no control_socket_path set, so nothing could be applied live.
      </div>
    );
  }

  if (outcome.reason === "cooldown") {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
        Applied too recently — wait a moment and try again. The config was still saved to disk.
      </div>
    );
  }

  return (
    <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
      Couldn't apply live{outcome.detail ? ` (${outcome.detail})` : ""}. The config was saved to disk — use "Save and restart" or restart manually to apply it.
    </div>
  );
}
