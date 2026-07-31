import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

interface CollapsibleProps {
  title: ReactNode;
  /** Rendered before the toggle button, in the same items-center row -- e.g. a drag
   *  handle. Keeping it in this row (rather than a sibling column outside Collapsible
   *  entirely) means it's always centered against the title, at any header height,
   *  with no margin tuning against a guessed row height. */
  dragHandle?: ReactNode;
  headerActions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  titleClassName?: string;
  children: ReactNode;
  /**
   * Bump (to a new, non-zero value) to force this section open and scroll it
   * into view -- used by the validation-error "jump to field" feature. A
   * changing value re-triggers the scroll even if the section is already
   * open, so clicking the same error twice still re-locates it.
   */
  openSignal?: number;
  /** Called on every open/close transition, including a programmatic force-open via openSignal, with the new state. Omit for no such behavior. */
  onOpenChange?: (open: boolean) => void;
}

export function Collapsible({ title, dragHandle, headerActions, defaultOpen = false, className, titleClassName, children, openSignal, onOpenChange }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentId = useId();

  useEffect(() => {
    if (!openSignal) return;
    setOpen((o) => {
      if (!o) onOpenChange?.(true);
      return true;
    });
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [openSignal]);

  return (
    <div ref={rootRef} className={className}>
      {/* flex-wrap: without it, a headerActions cluster (Disable/Duplicate/Remove, etc.)
          that doesn't fit next to the title on a narrow viewport squeezes the title
          button's flex-1 all the way to zero width instead of just wrapping below --
          found empirically while testing this component's many callers at phone widths. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {dragHandle}
        <button
          type="button"
          onClick={() =>
            setOpen((o) => {
              const next = !o;
              onOpenChange?.(next);
              return next;
            })
          }
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          aria-controls={contentId}
        >
          <span className={`inline-block flex-shrink-0 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
            ▶
          </span>
          <span className={`min-w-0 ${titleClassName ?? ""}`}>{title}</span>
        </button>
        {headerActions}
      </div>
      {open && (
        <div id={contentId} className="mt-3 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}
