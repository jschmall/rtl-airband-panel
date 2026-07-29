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
  /** Called the first time this section transitions from closed to open -- never again after. Omit for no such behavior. */
  onFirstOpen?: () => void;
}

export function Collapsible({ title, headerActions, defaultOpen = false, className, titleClassName, children, openSignal, onFirstOpen }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const firstOpenFired = useRef(false);

  function fireFirstOpen(): void {
    if (firstOpenFired.current) return;
    firstOpenFired.current = true;
    onFirstOpen?.();
  }

  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    fireFirstOpen();
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [openSignal]);

  return (
    <div ref={rootRef} className={className}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() =>
            setOpen((o) => {
              const next = !o;
              if (next) fireFirstOpen();
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
