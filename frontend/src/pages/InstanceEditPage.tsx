import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "@rtl-airband-panel/validate";
import { api, ApiError } from "../api/client.js";
import { ConfigEditor } from "../components/ConfigEditor.js";
import { ValidationBanner } from "../components/ValidationBanner.js";
import { useInstanceList } from "../state/InstanceListContext.js";

export function InstanceEditPage() {
  const { name } = useParams<{ name: string }>();
  const { refresh: refreshInstanceList } = useInstanceList();
  const [config, setConfig] = useState<RtlAirbandConfig | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationIssue[]>([]);
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);
  const [pendingAction, setPendingAction] = useState<"save" | "restart" | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    api
      .getConfig(name)
      .then(({ config, version }) => {
        setConfig(config);
        setVersion(version);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : "Failed to load config"));
  }, [name]);

  async function handleSave(restart: boolean) {
    if (!name || !config) return;
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
      setSavedMessage(
        restart
          ? `Saved and restarted ${name}.service (${result.status.activeState}).`
          : `Saved ${name}.conf. Changes will take effect after a restart.`
      );
      await refreshInstanceList();
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
        <Link to="/stats" state={{ instanceName: name }} className="text-sm text-sky-400 hover:text-sky-300">
          View stats →
        </Link>
      </div>

      <ValidationBanner errors={errors} warnings={warnings} />
      {savedMessage && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">{savedMessage}</div>
      )}

      <ConfigEditor config={config} onChange={setConfig} />

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
