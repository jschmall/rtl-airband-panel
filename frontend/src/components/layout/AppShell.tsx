import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useMobileNav } from "../../state/MobileNavContext.js";
import { StatusBanners } from "../StatusBanners.js";
import { Rail } from "./Rail.js";

/**
 * Rail on the left (a slide-over drawer below md:), banners above the page,
 * and the routed page itself.
 */
export function AppShell() {
  const { drawerOpen, toggleDrawer, closeDrawer, triggerRef } = useMobileNav();
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

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      <aside className="hidden w-64 flex-shrink-0 border-r border-slate-800 md:block">
        <Rail />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-20 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={closeDrawer} aria-hidden="true" />
          <div id="mobile-sidebar-drawer" role="dialog" aria-label="Navigation" className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-800 bg-slate-950 shadow-xl">
            <Rail />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2.5 md:hidden">
          <button
            ref={triggerRef}
            type="button"
            onClick={toggleDrawer}
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={drawerOpen}
            aria-controls="mobile-sidebar-drawer"
            className="-ml-1.5 rounded p-1.5 text-xl leading-none text-slate-300 hover:bg-slate-800 hover:text-slate-50"
          >
            ☰
          </button>
          <span className="text-sm font-semibold">RTLSDR-Airband Panel</span>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
            <StatusBanners />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
