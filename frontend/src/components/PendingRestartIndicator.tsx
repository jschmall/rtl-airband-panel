import { useEffect, useRef, useState } from "react";
import { useInstanceList } from "../state/InstanceListContext.js";

export function PendingRestartIndicator() {
  const { instances } = useInstanceList();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const pendingNames = (instances ?? []).filter((i) => i.pendingRestart).map((i) => i.name);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  useEffect(() => {
    if (pendingNames.length === 0) setOpen(false);
  }, [pendingNames.length]);

  if (pendingNames.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Saved but not yet restarted: ${pendingNames.join(", ")}`}
        className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
      >
        {pendingNames.length} pending restart{pendingNames.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded border border-slate-700 bg-slate-900 p-2 shadow-lg">
          <p className="mb-1 px-1 text-xs font-medium text-slate-400">Saved, waiting on a restart:</p>
          <ul className="max-h-48 overflow-y-auto text-sm text-slate-100">
            {pendingNames.map((name) => (
              <li key={name} className="truncate rounded px-1 py-0.5 hover:bg-slate-800">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
