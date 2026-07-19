import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "@rtl-airband-panel/validate";
import { api, ApiError } from "../api/client.js";
import { ConfigEditor } from "../components/ConfigEditor.js";
import { ValidationBanner } from "../components/ValidationBanner.js";

export function InstanceEditPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [config, setConfig] = useState<RtlAirbandConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationIssue[]>([]);
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    api
      .getConfig(name)
      .then(setConfig)
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : "Failed to load config"));
  }, [name]);

  async function handleSave() {
    if (!name || !config) return;
    setSaving(true);
    setErrors([]);
    setSavedMessage(null);
    try {
      const result = await api.updateConfig(name, config);
      setWarnings(result.warnings);
      setSavedMessage(`Saved and restarted ${name}.service (${result.status.activeState}).`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.body.errors) {
        setErrors(err.body.errors);
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
      setSaving(false);
    }
  }

  if (loadError) return <div className="text-red-300">{loadError}</div>;
  if (!config) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Edit {name}</h1>
        <div className="flex items-center gap-4">
          <Link to={`/instances/${name}/stats`} className="text-sm text-sky-400 hover:text-sky-300">
            View stats →
          </Link>
          <button type="button" onClick={() => navigate("/")} className="text-sm text-slate-400 hover:text-slate-200">
            ← Back to instances
          </button>
        </div>
      </div>

      <ValidationBanner errors={errors} warnings={warnings} />
      {savedMessage && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">{savedMessage}</div>
      )}

      <ConfigEditor config={config} onChange={setConfig} />

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save and restart"}
        </button>
      </div>
    </div>
  );
}
