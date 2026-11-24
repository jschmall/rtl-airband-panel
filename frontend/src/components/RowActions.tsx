import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { useCompact } from "../lib/use-media.js";

/**
 * A row's actions (Disable, Duplicate, Remove…): inline beside its title on a
 * wide screen, behind a ⋯ button on a compact one, where they'd otherwise
 * squeeze the title or run off the edge. Pressing a button in the menu closes
 * it; ticking a checkbox doesn't.
 */
export function RowActions({
  label,
  children,
  triggerRef,
}: {
  /** What the actions are for, e.g. "Channel 151.1600 MHz". */
  label: string;
  children: ReactNode;
  /** The ⋯ button, for returning focus to it. Null while the actions are inline. */
  triggerRef?: RefObject<HTMLButtonElement>;
}) {
  const compact = useCompact();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? ownTriggerRef;
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, trigger]);

  // Turning the device to a wide layout puts the actions back inline; don't reopen on the way back.
  useEffect(() => {
    if (!compact) setOpen(false);
  }, [compact]);

  if (!compact) return <div className="flex items-center gap-3">{children}</div>;

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Actions for ${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex h-10 w-10 items-center justify-center rounded text-xl leading-none text-slate-300 hover:bg-slate-600/40"
      >
        ⋯
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={`Actions for ${label}`}
          onClick={(e) => {
            if (!(e.target as Element).closest("button")) return;
            setOpen(false);
            trigger.current?.focus();
          }}
          className="absolute right-0 top-full z-20 flex min-w-[11rem] flex-col rounded-md border border-slate-600 bg-slate-900 px-3 py-1 shadow-xl [&>*]:min-h-[2.75rem] [&>*]:whitespace-nowrap [&>*]:text-left"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Says in a compact row's title what its ⋯ menu hides: that it's switched off. */
export function OffBadge({ disable, enabled = true }: { disable?: boolean; enabled?: boolean }) {
  const compact = useCompact();
  if (!compact || (!disable && enabled)) return null;
  return (
    <>
      {/* A plain space, not a margin, so a badge that wraps starts at the left edge. */}{" "}
      <span className="inline-block rounded border border-amber-500/40 bg-amber-500/10 px-1.5 align-middle text-[10px] font-medium uppercase tracking-wide text-amber-300">
        {disable ? "disabled" : "not enabled"}
      </span>
    </>
  );
}
