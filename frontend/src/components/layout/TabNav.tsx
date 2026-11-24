import { GuardedNavLink } from "../GuardedLink.js";
import { ErrorsBadge, NAV_ITEMS } from "./nav.js";

/**
 * The compact layout's section switcher: tabs along the bottom of an upright
 * phone, a slim strip on the left of one on its side, where height is scarce.
 */
export function TabNav() {
  return (
    <nav
      aria-label="Main"
      className="flex flex-shrink-0 border-t border-slate-800 bg-slate-900/60 landscape:flex-col landscape:border-t-0"
    >
      {NAV_ITEMS.map(({ to, end, label, Icon, badge }) => (
        <GuardedNavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] landscape:flex-none landscape:py-2.5 ${
              isActive ? "bg-slate-800 text-slate-50" : "text-slate-400 hover:text-slate-50"
            }`
          }
        >
          <span className="relative">
            <Icon />
            {badge && <ErrorsBadge className="absolute -right-5 -top-1.5 bg-slate-950" />}
          </span>
          {label}
        </GuardedNavLink>
      ))}
    </nav>
  );
}
