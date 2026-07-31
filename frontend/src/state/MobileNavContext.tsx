import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

interface MobileNavContextValue {
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  /** The hamburger button (App.tsx) attaches this -- lets the drawer (TwoPaneLayout.tsx)
   *  return focus to it on Escape, matching PendingRestartIndicator's popover convention. */
  triggerRef: RefObject<HTMLButtonElement>;
}

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

/**
 * Whether the below-md: sidebar drawer is open, shared between the hamburger
 * button (App.tsx's header) and the drawer itself (TwoPaneLayout.tsx) -- they
 * aren't otherwise in a parent/child relationship, since the header lives
 * above the routed <Outlet> that renders TwoPaneLayout.
 */
export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((o) => !o), []);

  const value = useMemo(
    () => ({ drawerOpen, openDrawer, closeDrawer, toggleDrawer, triggerRef }),
    [drawerOpen, openDrawer, closeDrawer, toggleDrawer]
  );

  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export function useMobileNav(): MobileNavContextValue {
  const ctx = useContext(MobileNavContext);
  if (!ctx) throw new Error("useMobileNav must be used within a MobileNavProvider");
  return ctx;
}
