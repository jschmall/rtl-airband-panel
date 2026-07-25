import type { ReactNode } from "react";
import { useState } from "react";

interface CollapsibleProps {
  title: ReactNode;
  headerActions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  titleClassName?: string;
  children: ReactNode;
}

export function Collapsible({ title, headerActions, defaultOpen = false, className, titleClassName, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-2 text-left">
          <span className={`inline-block text-slate-500 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
            ▶
          </span>
          <span className={titleClassName}>{title}</span>
        </button>
        {headerActions}
      </div>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}
