import { useId, useState, type ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

/**
 * Replaces a bare `title=` attribute, which only shows on mouse hover --
 * invisible to keyboard users, most screen readers, and touch. This shows on
 * hover *and* keyboard focus, is dismissible with Escape, and associates the
 * tooltip text with its trigger via `aria-describedby` (a `role="tooltip"`
 * element a screen reader will actually announce) instead of relying on the
 * browser's own undocumented `title` handling.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex">
      <span
        tabIndex={0}
        aria-describedby={id}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setVisible(false);
        }}
        className={className ?? "cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2"}
      >
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-0 z-20 mb-1 w-max max-w-xs rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs font-normal text-slate-200 shadow-lg ${
          visible ? "block" : "hidden"
        }`}
      >
        {content}
      </span>
    </span>
  );
}
