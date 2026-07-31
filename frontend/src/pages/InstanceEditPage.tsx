import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "@rtl-airband-panel/validate";
import { api, ApiError } from "../api/client.js";
import { ConfigEditor } from "../components/ConfigEditor.js";
import { ValidationBanner } from "../components/ValidationBanner.js";
import { GuardedLink } from "../components/GuardedLink.js";
import { InstanceLogs } from "../components/InstanceLogs.js";
import { useInstanceList } from "../state/InstanceListContext.js";
import { useUnsavedChanges } from "../state/UnsavedChangesContext.js";
import { assignUiKeysDeep, stampOutputMatchIndices } from "../lib/keys.js";
import { getValueAtPath } from "../lib/validation-path.js";

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
  const [pendingAction, setPendingAction] = useState<"save" | "restart" | "check" | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // Set when the user clicks a validation issue in the banner -- nonce is bumped
  // (not just the path) so clicking the same issue twice still re-triggers the
  // scroll/expand even though the path string didn't change. See Collapsible's
  // openSignal prop.
  const [jumpTarget, setJumpTarget] = useState<{ path: string; nonce: number } | null>(null);
  const [jsonLoggingPending, setJsonLoggingPending] = useState(false);

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

  const isDirty = config !== null && savedConfig !== null && JSON.stringify(config) !== JSON.stringify(savedConfig);

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
  async function revealSecret(fieldPath: string): Promise<string> {
    if (!name) return "";
    const raw = await api.getSecrets(name);
    const value = getValueAtPath(raw, fieldPath);
    return typeof value === "string" ? value : "";
  }

  async function handleSave(restart: boolean) {
    if (!name || !config || pendingAction) return;
    if (restart && !window.confirm(`Restart '${name}'? This applies the saved changes but interrupts live audio for a few seconds while it restarts.`)) {
      return;
    }
    setPendingAction(restart ? "restart" : "save");
    setErrors([]);
    setSavedMessage(null);
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

  // Runs the same validation a save would, without writing or restarting anything --
  // an early-warning convenience so the user can find problems before committing to
  // Save-and-restart, which interrupts live audio.
  async function handleCheck() {
    if (!name || !config || pendingAction) return;
    setPendingAction("check");
    setSavedMessage(null);
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
      pollBriefly();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Failed to update JSON logging");
    } finally {
      setJsonLoggingPending(false);
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Edit {name}</h1>
        <GuardedLink to="/stats" state={{ instanceName: name }} className="text-sm text-sky-400 hover:text-sky-300">
          View stats →
        </GuardedLink>
      </div>

      <ValidationBanner
        errors={errors}
        warnings={warningsDismissed ? [] : warnings}
        config={config}
        onJumpTo={(path) => setJumpTarget({ path, nonce: Date.now() })}
        onDismissWarnings={() => setWarningsDismissed(true)}
      />
      {savedMessage && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">{savedMessage}</div>
      )}

      <ConfigEditor
        config={config}
        onChange={setConfig}
        jumpTarget={jumpTarget}
        onRevealSecret={revealSecret}
        afterGlobalSettings={
          name && (
            <InstanceLogs
              name={name}
              jsonLogging={instances?.find((i) => i.name === name)?.jsonLogging ?? false}
              jsonLoggingPending={jsonLoggingPending}
              onToggleJsonLogging={(next) => void handleToggleJsonLogging(next)}
            />
          )
        }
      />

      <div className="flex justify-end gap-3">
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
        <button
          type="button"
          disabled={pendingAction !== null}
          onClick={() => void handleSave(true)}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          {pendingAction === "restart" ? "Restarting…" : "Save and restart"}
        </button>
      </div>
    </div>
  );
}
