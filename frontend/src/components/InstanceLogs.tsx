import { useState } from "react";
import { api, ApiError, type LogLine } from "../api/client.js";
import { Collapsible } from "./Collapsible.js";
import { addButtonClass } from "./styles.js";

export function InstanceLogs({ name }: { name: string }) {
  const [lines, setLines] = useState<LogLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const { lines } = await api.getLogs(name);
      setLines(lines);
      setHasLoadedOnce(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load logs.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Collapsible
      className="rounded-lg border border-slate-700 bg-slate-900 p-4"
      titleClassName="text-lg font-semibold text-slate-100"
      title="Logs"
      onFirstOpen={() => void fetchLogs()}
      headerActions={
        <button type="button" onClick={() => void fetchLogs()} disabled={loading} className={addButtonClass}>
          {loading ? "Loading…" : hasLoadedOnce ? "Refresh" : "Load logs"}
        </button>
      }
    >
      {error !== null && <p className="text-sm text-red-400">{error}</p>}
      {error === null && lines === null && <p className="text-sm text-slate-400">Not loaded yet.</p>}
      {error === null && lines !== null && lines.length === 0 && <p className="text-sm text-slate-400">No log entries.</p>}
      {lines !== null && lines.length > 0 && (
        <pre className="max-h-96 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300">
          {lines.map((l) => `${l.timestamp}  ${l.message}`).join("\n")}
        </pre>
      )}
    </Collapsible>
  );
}
