import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { loadSectionOpen, saveSectionOpen } from "../lib/section-memory.js";

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
  /** Called with the open state on mount and after every change (a toggle, a forced open, a remembered state loading). */
  onOpenChange?: (open: boolean) => void;
  /**
   * False: openSignal only opens the section, without scrolling to it. For a
   * group (e.g. the instance's Devices) whose own child scrolls to the target;
   * the group, effects running parent-last, would otherwise scroll last and win.
   */
  scrollOnSignal?: boolean;
  /**
   * Remembers whether this section is open under this key (see
   * section-memory.ts), falling back to defaultOpen. A new key, e.g. the
   * page switching to another instance, loads that key's state.
   */
  persistKey?: string;
}

export function Collapsible({
  title,
  headerActions,
  defaultOpen = false,
  className,
  titleClassName,
  children,
  openSignal,
  onOpenChange,
  scrollOnSignal = true,
  persistKey,
}: CollapsibleProps) {
  const initialOpen = () => (persistKey ? (loadSectionOpen(persistKey) ?? defaultOpen) : defaultOpen);
  const [open, setOpen] = useState(initialOpen);
  const [loadedKey, setLoadedKey] = useState(persistKey);
  if (persistKey !== loadedKey) {
    setLoadedKey(persistKey);
    setOpen(initialOpen());
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const contentId = useId();

  // The openSignal it was forced open for, until that scroll is done.
  const [scrollFor, setScrollFor] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    if (scrollOnSignal) setScrollFor(openSignal);
  }, [openSignal]);

  // Reports every open state, including the first (a remembered open
  // section starts open), and remembers it.
  useEffect(() => {
    onOpenChange?.(open);
    if (persistKey) saveSectionOpen(persistKey, open);
  }, [open, persistKey]);

  // Scrolls once the expanded content has rendered, so it's the opened
  // section that gets centered (or, taller than the viewport, top-aligned)
  // rather than its collapsed header with the content then pushing out below.
  useEffect(() => {
    if (!scrollFor || !open) return;
    setScrollFor(undefined);
    const el = rootRef.current;
    if (!el) return;
    const tall = el.getBoundingClientRect().height > window.innerHeight * 0.8;
    el.scrollIntoView({ behavior: "smooth", block: tall ? "start" : "center" });
  }, [scrollFor, open]);

  return (
    <div ref={rootRef} className={className} style={{ scrollMarginTop: 16 }}>
      {/* flex-wrap: without it, a headerActions cluster (Disable/Duplicate/Remove, etc.)
          that doesn't fit next to the title on a narrow viewport squeezes the title
          button's flex-1 all the way to zero width instead of just wrapping below --
          found empirically while testing this component's many callers at phone widths. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
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
