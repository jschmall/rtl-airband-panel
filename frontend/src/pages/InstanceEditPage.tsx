import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "@rtl-airband-panel/validate";
import { api, ApiError } from "../api/client.js";
import { ConfigEditor } from "../components/ConfigEditor.js";
import { ValidationBanner } from "../components/ValidationBanner.js";
import { GuardedLink } from "../components/GuardedLink.js";
import { useInstanceList } from "../state/InstanceListContext.js";
import { useUnsavedChanges } from "../state/UnsavedChangesContext.js";
import { assignUiKeysDeep } from "../lib/keys.js";
import { getValueAtPath } from "../lib/validation-path.js";

export function InstanceEditPage() {
  const { name } = useParams<{ name: string }>();
  const { refresh: refreshInstanceList, pollBriefly } = useInstanceList();
  const { setDirty } = useUnsavedChanges();
  const [config, setConfig] = useState<RtlAirbandConfig | null>(null);
  // The last-loaded-or-saved config, compared against the live-edited `config`
  // to decide whether there's anything unsaved -- see the `isDirty` effect below.
  const [savedConfig, setSavedConfig] = useState<RtlAirbandConfig | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationIssue[]>([]);
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);
  const [pendingAction, setPendingAction] = useState<"save" | "restart" | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // Set when the user clicks a validation issue in the banner -- nonce is bumped
  // (not just the path) so clicking the same issue twice still re-triggers the
  // scroll/expand even though the path string didn't change. See Collapsible's
  // openSignal prop.
  const [jumpTarget, setJumpTarget] = useState<{ path: string; nonce: number } | null>(null);

  useEffect(() => {
    if (!name) return;
    api
      .getConfig(name)
      .then(({ config, version }) => {
        // Nothing server-side knows about these keys -- assign them once, here,
        // so every device/channel/output/mixer keeps its own UI state (open/
        // closed, remembered type-cache) even as items before it in a list are
        // added or removed. See lib/keys.ts.
        const keyed = assignUiKeysDeep(config);
        setConfig(keyed);
        setSavedConfig(keyed);
        setVersion(version);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : "Failed to load config"));
  }, [name]);

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
      setWarnings(result.warnings);
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
      setPendingAction(null);
    }
  }

  if (loadError) return <div className="text-red-300">{loadError}</div>;
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
        warnings={warnings}
        config={config}
        onJumpTo={(path) => setJumpTarget({ path, nonce: Date.now() })}
      />
      {savedMessage && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">{savedMessage}</div>
      )}

      <ConfigEditor config={config} onChange={setConfig} jumpTarget={jumpTarget} onRevealSecret={revealSecret} />

      <div className="flex justify-end gap-3">
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
