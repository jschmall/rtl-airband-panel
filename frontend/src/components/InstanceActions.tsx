import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import { useInstanceList } from "../state/InstanceListContext.js";
import { inputClass } from "./styles.js";

const actionClass =
  "rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50";

/** Restart / rename / delete for one instance (shown in its page header). */
export function InstanceActions({ name }: { name: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { refresh, pollBriefly } = useInstanceList();
  const [busy, setBusy] = useState<"restart" | "rename" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);

  async function run(kind: "restart" | "rename" | "delete", fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${kind} failed`);
    } finally {
      setBusy(null);
    }
  }

  function restart() {
    if (!window.confirm(`Restart '${name}'? This interrupts live audio for a few seconds.`)) return;
    void run("restart", async () => {
      await api.restartInstance(name);
      await refresh();
      void pollBriefly();
    });
  }

  function rename() {
    const target = renameValue.trim();
    if (target === name) {
      setRenaming(false);
      return;
    }
    if (!window.confirm(`Rename '${name}' to '${target}'? This restarts the instance under its new name, interrupting live audio for a few seconds.`)) {
      return;
    }
    void run("rename", async () => {
      await api.renameInstance(name, target);
      setRenaming(false);
      if (location.pathname.startsWith(`/instances/${encodeURIComponent(name)}`)) navigate(`/instances/${encodeURIComponent(target)}`);
      await refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete instance '${name}'? This stops and removes its systemd unit and config file.`)) return;
    void run("delete", async () => {
      await api.deleteInstance(name);
      navigate("/");
      await refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {renaming ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label={`New name for ${name}`}
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className={`w-44 ${inputClass}`}
          />
          <button type="button" disabled={busy !== null || renameValue.trim() === ""} onClick={rename} className={actionClass}>
            {busy === "rename" ? "Renaming…" : "Rename"}
          </button>
          <button type="button" onClick={() => setRenaming(false)} className={actionClass}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy !== null} onClick={restart} className={actionClass}>
            {busy === "restart" ? "Restarting…" : "Restart"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setRenameValue(name);
              setRenaming(true);
            }}
            className={actionClass}
          >
            Rename
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={remove}
            className="rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
