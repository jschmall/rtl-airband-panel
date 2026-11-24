import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useCompact } from "../../lib/use-media.js";
import { useMobileNav } from "../../state/MobileNavContext.js";
import { StatusBanners } from "../StatusBanners.js";
import { Rail } from "./Rail.js";
import { TabNav } from "./TabNav.js";

/**
 * Banners above the routed page, with the navigation beside it: the Rail on a
 * wide screen; on a compact one (below lg:) tabs for the sections (TabNav)
 * and a slide-over drawer for the instances.
 */
export function AppShell() {
  const { drawerOpen, toggleDrawer, closeDrawer, triggerRef } = useMobileNav();
  const compact = useCompact();
  const location = useLocation();

  useEffect(() => {
    closeDrawer();
  }, [location.pathname, closeDrawer]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      closeDrawer();
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, closeDrawer, triggerRef]);

  const menuButton = (
    <button
      ref={triggerRef}
      type="button"
      onClick={toggleDrawer}
      aria-label={drawerOpen ? "Close instance list" : "Open instance list"}
      aria-expanded={drawerOpen}
      aria-controls="mobile-sidebar-drawer"
      className="flex h-10 w-10 items-center justify-center rounded text-xl leading-none text-slate-300 hover:bg-slate-800 hover:text-slate-50"
    >
      ☰
    </button>
  );

  // h-dvh: a phone browser's own bars would cover the bottom of a 100vh page.
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 portrait:flex-col supports-[height:100dvh]:h-dvh lg:!flex-row">
      {compact ? (
        <div className="flex flex-shrink-0 items-center portrait:border-b portrait:border-slate-800 portrait:px-2 portrait:py-1 landscape:w-16 landscape:flex-col landscape:overflow-y-auto landscape:border-r landscape:border-slate-800 landscape:pt-1">
          {menuButton}
          <span className="ml-1 text-sm font-semibold landscape:hidden">RTLSDR-Airband Panel</span>
          <div className="hidden w-full landscape:block">
            <TabNav />
          </div>
        </div>
      ) : (
        <aside className="w-64 flex-shrink-0 border-r border-slate-800">
          <Rail />
        </aside>
      )}

      {compact && drawerOpen && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/60" onClick={closeDrawer} aria-hidden="true" />
          <div id="mobile-sidebar-drawer" role="dialog" aria-label="Instances" className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-800 bg-slate-950 shadow-xl">
            <Rail instancesOnly />
          </div>
        </div>
      )}

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6">
          <StatusBanners />
          <Outlet />
        </div>
      </main>

      {compact && (
        <div className="landscape:hidden">
          <TabNav />
        </div>
      )}
    </div>
  );
}
