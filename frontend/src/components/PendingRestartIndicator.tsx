import { useEffect, useRef, useState } from "react";
import { useInstanceList } from "../state/InstanceListContext.js";

export function PendingRestartIndicator() {
  const { instances } = useInstanceList();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const pendingNames = (instances ?? []).filter((i) => i.pendingRestart).map((i) => i.name);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Return focus to the trigger rather than letting it fall back to <body> --
      // otherwise a keyboard user closing the popover loses their place entirely.
      buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (pendingNames.length === 0) setOpen(false);
  }, [pendingNames.length]);

  if (pendingNames.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
      >
        {pendingNames.length} pending restart{pendingNames.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div role="dialog" aria-label="Instances saved but not yet restarted" className="absolute right-0 z-10 mt-2 w-64 rounded border border-slate-700 bg-slate-900 p-2 shadow-lg">
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
