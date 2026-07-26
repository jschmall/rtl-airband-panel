import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

interface CollapsibleProps {
  title: ReactNode;
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
}

export function Collapsible({ title, headerActions, defaultOpen = false, className, titleClassName, children, openSignal }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentId = useId();

  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [openSignal]);

  return (
    <div ref={rootRef} className={className}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          aria-controls={contentId}
        >
          <span className={`inline-block text-slate-500 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
            ▶
          </span>
          <span className={titleClassName}>{title}</span>
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
