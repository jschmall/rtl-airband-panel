import { useState } from "react";
import { api, ApiError } from "../api/client.js";
import { useInstanceList } from "../state/InstanceListContext.js";
import { GuardedLink } from "./GuardedLink.js";

/**
 * App-wide banners above every page: the server being unreachable, and
 * instances whose saved config isn't running yet (with a one-click
 * "restart them all").
 */
export function StatusBanners() {
  const { instances, connection, refresh, pollBriefly } = useInstanceList();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = (instances ?? []).filter((i) => i.pendingRestart).map((i) => i.name);

  async function restartAll() {
    if (!window.confirm(`Restart ${pending.length} instance${pending.length === 1 ? "" : "s"} (${pending.join(", ")})? Each one's live audio is interrupted for a few seconds.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const results = await api.restartPending();
      const failed = Object.entries(results).filter(([, r]) => "error" in r);
      if (failed.length) setError(`Failed to restart: ${failed.map(([n]) => n).join(", ")}`);
      await refresh();
      void pollBriefly();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Restart failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 empty:hidden">
      {connection === "offline" && (
        <div role="alert" className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Can't reach the panel server. Showing the last known state; retrying in the background.
        </div>
      )}
      {pending.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <span>
            Saved but not running yet:{" "}
            {pending.map((name, i) => (
              <span key={name}>
                {i > 0 && ", "}
                <GuardedLink to={`/instances/${encodeURIComponent(name)}`} className="font-medium underline decoration-dotted hover:text-amber-100">
                  {name}
                </GuardedLink>
              </span>
            ))}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void restartAll()}
            className="rounded border border-amber-500/50 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/20 disabled:opacity-50"
          >
            {busy ? "Restarting…" : pending.length === 1 ? "Restart it" : `Restart all ${pending.length}`}
          </button>
          {error && <p className="w-full text-xs text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}
