import { useState } from "react";
import { useInstanceList, type Connection } from "../../state/InstanceListContext.js";
import { applyThemePreference, loadThemePreference, type ThemePreference } from "../../lib/theme.js";
import { GuardedLink, GuardedNavLink } from "../GuardedLink.js";
import { HealthLight, healthLabel } from "../HealthLight.js";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm ${
    isActive ? "bg-slate-800 text-slate-50" : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-50"
  }`;

function OverviewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current opacity-80">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-none stroke-current opacity-80" strokeWidth="1.6">
      <polyline points="1,13 5,8 8,10 12,4 15,6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const CONNECTION: Record<Connection, { label: string; light: string; title: string }> = {
  live: { label: "Live", light: "bg-emerald-500", title: "Receiving live updates from the panel server" },
  polling: { label: "Polling", light: "bg-amber-500", title: "No live update channel; refreshing every 20 seconds" },
  offline: { label: "Offline", light: "bg-red-500", title: "The panel server can't be reached" },
};

const THEME_NEXT: Record<ThemePreference, ThemePreference> = { system: "dark", dark: "light", light: "system" };
const THEME_LABEL: Record<ThemePreference, string> = { system: "Auto theme", dark: "Dark theme", light: "Light theme" };

function RailFooter() {
  const { connection } = useInstanceList();
  const [theme, setTheme] = useState<ThemePreference>(loadThemePreference);
  const c = CONNECTION[connection];
  return (
    <div className="flex items-center justify-between border-t border-slate-800 px-3 py-2 text-xs text-slate-400">
      <span className="flex items-center gap-1.5" title={c.title}>
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${c.light}`} />
        {c.label}
      </span>
      <button
        type="button"
        onClick={() => {
          const next = THEME_NEXT[theme];
          applyThemePreference(next);
          setTheme(next);
        }}
        title="Switch theme (auto follows your system)"
        className="rounded px-1.5 py-0.5 hover:bg-slate-800 hover:text-slate-200"
      >
        {THEME_LABEL[theme]}
      </button>
    </div>
  );
}

/** Left navigation: app sections, then every instance with its status light. */
export function Rail() {
  const { instances, filteredInstances, searchQuery, setSearchQuery, error } = useInstanceList();
  const shown = filteredInstances ?? instances;
  const query = searchQuery.trim().toLowerCase();

  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-slate-900/40">
      <GuardedLink to="/" className="flex items-center gap-2 px-4 pb-3 pt-4">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 fill-none stroke-sky-400" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 13a7 7 0 0 1 14 0" />
          <path d="M6 13a4 4 0 0 1 8 0" />
          <circle cx="10" cy="13" r="1.2" className="fill-sky-400" />
        </svg>
        <span className="text-sm font-semibold tracking-tight text-slate-50">RTLSDR-Airband Panel</span>
      </GuardedLink>

      <div className="space-y-0.5 px-2">
        <GuardedNavLink to="/" end className={navItemClass}>
          <OverviewIcon />
          Overview
        </GuardedNavLink>
        <GuardedNavLink to="/stats" className={navItemClass}>
          <StatsIcon />
          Stats
        </GuardedNavLink>
      </div>

      <div className="mt-4 flex items-center justify-between px-4">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Instances</span>
        <GuardedNavLink to="/instances/new" title="New instance" className="rounded px-1.5 text-sm leading-6 text-sky-400 hover:bg-slate-800">
          + New
        </GuardedNavLink>
      </div>
      <div className="px-3 pb-2 pt-1">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter by name, label, MHz…"
          aria-label="Search instances"
          className="h-7 w-full rounded-md border border-slate-800 bg-slate-950 px-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
        />
      </div>

      {error && <p className="mx-3 mb-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">{error}</p>}

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {shown === null ? (
          <p className="px-2 text-xs text-slate-500">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="px-2 text-xs text-slate-500">{instances?.length ? `Nothing matches "${searchQuery}".` : "No instances yet."}</p>
        ) : (
          shown.map((instance) => {
            const matched =
              query && !instance.name.toLowerCase().includes(query)
                ? [...new Set(instance.searchFields.filter((f) => f.toLowerCase().includes(query)))]
                : [];
            return (
              <GuardedNavLink
                key={instance.name}
                to={`/instances/${encodeURIComponent(instance.name)}`}
                title={`${healthLabel(instance.status.activeState)} (${instance.status.subState})${instance.pendingRestart ? " -- saved config not running yet" : ""}`}
                className={({ isActive }) =>
                  `block rounded-md px-2.5 py-1.5 text-sm ${isActive ? "bg-slate-800 text-slate-50" : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-50"}`
                }
              >
                <span className="flex items-center gap-2">
                  <HealthLight state={instance.status.activeState} />
                  <span className="min-w-0 flex-1 truncate">{instance.name}</span>
                  {instance.pendingRestart && (
                    <span className="rounded border border-amber-500/40 px-1 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                      pending
                    </span>
                  )}
                </span>
                {matched.length > 0 && <span className="ml-4 block truncate text-xs text-slate-500">{matched.join(", ")}</span>}
              </GuardedNavLink>
            );
          })
        )}
      </div>

      <RailFooter />
    </nav>
  );
}
