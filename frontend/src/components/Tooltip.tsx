import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
  /** Makes the trigger a button (one tab stop; Enter/Space activate it) that
   *  toggles something, e.g. a longer explanation; `expanded` is its state. */
  onClick?: () => void;
  expanded?: boolean;
  /** Accessible name for a button trigger whose children are only an icon. */
  label?: string;
}

/**
 * Replaces a bare `title=` attribute, which only shows on mouse hover --
 * invisible to keyboard users, most screen readers, and touch. This shows on
 * hover *and* keyboard focus, is dismissible with Escape, and associates the
 * tooltip text with its trigger via `aria-describedby` (a `role="tooltip"`
 * element a screen reader will actually announce) instead of relying on the
 * browser's own undocumented `title` handling.
 */
export function Tooltip({ content, children, className, onClick, expanded, label }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  // Where the tooltip sits relative to the trigger's left edge: normally 0,
  // shifted so it stays inside the window (8px margin) when the trigger is
  // near an edge, and never wider than the window allows.
  const [place, setPlace] = useState<{ left: number; maxWidth: number } | null>(null);
  const id = useId();

  const show = (e: { currentTarget: Element }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const margin = 8;
    const maxWidth = Math.min(20 * rem, window.innerWidth - 2 * margin);
    const viewportLeft = Math.min(Math.max(rect.left, margin), window.innerWidth - margin - maxWidth);
    setPlace({ left: viewportLeft - rect.left, maxWidth });
    setVisible(true);
  };

  const triggerProps = {
    "aria-describedby": id,
    onMouseEnter: show,
    onMouseLeave: () => setVisible(false),
    onFocus: show,
    onBlur: () => setVisible(false),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisible(false);
    },
    className: className ?? "cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2",
  };

  return (
    <span className="relative inline-flex">
      {onClick ? (
        <button type="button" {...triggerProps} onClick={onClick} aria-expanded={expanded} aria-label={label}>
          {children}
        </button>
      ) : (
        <span tabIndex={0} {...triggerProps}>
          {children}
        </span>
      )}
      <span
        id={id}
        role="tooltip"
        style={place ? { left: place.left, maxWidth: place.maxWidth } : undefined}
        className={`pointer-events-none absolute bottom-full left-0 z-20 mb-1 w-max max-w-xs whitespace-pre-line rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs font-normal text-slate-200 shadow-lg ${
          visible ? "block" : "hidden"
        }`}
      >
        {content}
      </span>
    </span>
  );
}
