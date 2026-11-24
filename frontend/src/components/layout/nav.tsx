import { useEffect, type ComponentType } from "react";
import { errorLog, unacknowledgedProblems, useErrorLog } from "../../lib/error-log.js";

function OverviewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-5 w-5 fill-current opacity-80 lg:h-4 lg:w-4">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-5 w-5 fill-none lg:h-4 lg:w-4 stroke-current opacity-80" strokeWidth="1.6">
      <polyline points="1,13 5,8 8,10 12,4 15,6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function HardwareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-5 w-5 fill-none lg:h-4 lg:w-4 stroke-current opacity-80" strokeWidth="1.5" strokeLinecap="round">
      <rect x="1.5" y="6" width="13" height="8" rx="1.5" />
      <path d="M11 6 13.5 1.5" />
      <circle cx="5" cy="10" r="1.6" />
      <path d="M9 9h3M9 11h3" />
    </svg>
  );
}

function ErrorsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-5 w-5 fill-none lg:h-4 lg:w-4 stroke-current opacity-80" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d="M8 1.5 15 14H1z" />
      <path d="M8 6v3.5" />
      <circle cx="8" cy="11.8" r="0.4" className="fill-current" />
    </svg>
  );
}

/** Errors and warnings nobody has acknowledged yet; the same in every browser. */
export function ErrorsBadge({ className = "" }: { className?: string }) {
  const log = useErrorLog();
  // Pushes keep it current while live; otherwise InstanceListContext's background poll reloads it.
  useEffect(() => {
    void errorLog.ensureLoaded();
  }, []);
  const { count, anyError } = unacknowledgedProblems(log);
  if (count === 0) return null;
  return (
    <span
      title={`${count} unacknowledged error${count === 1 ? "" : "s"} or warning${count === 1 ? "" : "s"}`}
      className={`${className} rounded-full border px-1.5 text-[10px] font-semibold tabular-nums ${
        anyError ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** The app's sections, for the wide layout's Rail and the compact one's TabNav. */
export const NAV_ITEMS: { to: string; label: string; Icon: ComponentType; end?: boolean; badge?: boolean }[] = [
  { to: "/", label: "Overview", Icon: OverviewIcon, end: true },
  { to: "/stats", label: "Stats", Icon: StatsIcon },
  { to: "/hardware", label: "Hardware", Icon: HardwareIcon },
  { to: "/errors", label: "Errors", Icon: ErrorsIcon, badge: true },
];
