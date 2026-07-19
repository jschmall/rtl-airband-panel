import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "@rtl-airband-panel/validate";
import { api, ApiError } from "../api/client.js";
import { ConfigEditor } from "../components/ConfigEditor.js";
import { ValidationBanner } from "../components/ValidationBanner.js";
import { Field } from "../components/Field.js";
import { inputClass } from "../components/styles.js";
import { defaultConfig } from "../lib/defaults.js";

const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function InstanceCreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [config, setConfig] = useState<RtlAirbandConfig>(defaultConfig());
  const [errors, setErrors] = useState<ValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);

  const nameValid = SAFE_NAME.test(name);

  async function handleCreate() {
    setSaving(true);
    setErrors([]);
    try {
      await api.createInstance(name, config);
      navigate(`/instances/${encodeURIComponent(name)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.body.errors) {
        setErrors(err.body.errors);
      } else {
        setErrors([
          {
            severity: "error",
            code: "request-failed",
            path: "$",
            message: err instanceof ApiError ? err.message : "Create failed",
          },
        ]);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">New instance</h1>
        <button type="button" onClick={() => navigate("/")} className="text-sm text-slate-400 hover:text-slate-200">
          ← Back to instances
        </button>
      </div>

      <div className="max-w-sm rounded-lg border border-slate-700 bg-slate-900/60 p-4">
        <Field label="Instance name (used for the .conf file and systemd unit)">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="rtl_151780" />
        </Field>
        {name.length > 0 && !nameValid && (
          <p className="mt-1 text-xs text-red-400">Only letters, digits, underscore, and hyphen (max 64 chars).</p>
        )}
      </div>

      <ValidationBanner errors={errors} />

      <ConfigEditor config={config} onChange={setConfig} />

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving || !nameValid}
          onClick={() => void handleCreate()}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create instance"}
        </button>
      </div>
    </div>
  );
}
