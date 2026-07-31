import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { InstanceSidebar } from "../InstanceSidebar.js";
import { useMobileNav } from "../../state/MobileNavContext.js";

const STORAGE_KEY = "rtl-panel-sidebar-width";
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 220;
const MAX_WIDTH = 560;

function clamp(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function loadStoredWidth(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_WIDTH;
}

export function TwoPaneLayout() {
  const [width, setWidth] = useState(loadStoredWidth);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const { drawerOpen, closeDrawer, triggerRef } = useMobileNav();
  const location = useLocation();

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setWidth(clamp(e.clientX - rect.left));
  }, []);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setWidth((current) => {
      localStorage.setItem(STORAGE_KEY, String(current));
      return current;
    });
  }, []);

  // Closes the drawer on every route change (picking an instance, navigating to
  // Stats, etc.) -- once a destination is chosen, the drawer has done its job.
  useEffect(() => {
    closeDrawer();
  }, [location.pathname, closeDrawer]);

  // Escape closes the drawer and returns focus to the hamburger button that
  // opened it (App.tsx), matching PendingRestartIndicator's popover convention.
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
    <div ref={containerRef} className="flex h-full">
      {/* Desktop/tablet (md:+): always-visible, resizable sidebar -- entirely absent
          from the layout below md: (not just visually hidden), so it can never
          contribute to the header-squeeze class of bug Phase 1 found elsewhere. */}
      <div style={{ width }} className="hidden flex-shrink-0 overflow-y-auto border-r border-slate-800 md:block">
        <InstanceSidebar />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="hidden w-1 flex-shrink-0 cursor-col-resize bg-slate-800 hover:bg-sky-600 active:bg-sky-600 md:block"
      />

      {/* Below md:: a slide-over drawer instead, triggered by App.tsx's hamburger
          button (see MobileNavContext) -- reuses InstanceSidebar unchanged. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-20 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={closeDrawer} aria-hidden="true" />
          <div
            id="mobile-sidebar-drawer"
            role="dialog"
            aria-label="Instance list"
            className="absolute inset-y-0 left-0 flex w-[85vw] max-w-sm flex-col overflow-y-auto border-r border-slate-800 bg-slate-950 shadow-xl"
          >
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => {
                  closeDrawer();
                  triggerRef.current?.focus();
                }}
                aria-label="Close instance list"
                className="rounded px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>
            <InstanceSidebar />
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}
