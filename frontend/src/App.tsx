import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { TwoPaneLayout } from "./components/layout/TwoPaneLayout.js";
import { PendingRestartIndicator } from "./components/PendingRestartIndicator.js";
import { InstanceSearchInput } from "./components/InstanceSearchInput.js";
import { GuardedLink } from "./components/GuardedLink.js";
import { WelcomePage } from "./pages/WelcomePage.js";
import { InstanceEditPage } from "./pages/InstanceEditPage.js";
import { InstanceCreatePage } from "./pages/InstanceCreatePage.js";
import { InstanceListProvider } from "./state/InstanceListContext.js";
import { UnsavedChangesProvider } from "./state/UnsavedChangesContext.js";
import { MobileNavProvider, useMobileNav } from "./state/MobileNavContext.js";

// recharts (and its d3 dependencies) account for most of the bundle size but
// are only needed on this one route -- split into its own chunk instead of
// shipping them to everyone loading the instance list/editor.
const StatsPage = lazy(() => import("./pages/StatsPage.js").then((m) => ({ default: m.StatsPage })));

/**
 * Toggles the below-md: sidebar drawer (rendered by TwoPaneLayout.tsx, which
 * isn't a parent/child of this header -- see MobileNavContext). Hidden at
 * md: and wider, where the sidebar is always visible and there's nothing for
 * this to open/close.
 */
function HamburgerButton() {
  const { drawerOpen, toggleDrawer, triggerRef } = useMobileNav();
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={toggleDrawer}
      aria-label={drawerOpen ? "Close instance list" : "Open instance list"}
      aria-expanded={drawerOpen}
      aria-controls="mobile-sidebar-drawer"
      className="-ml-1.5 rounded p-1.5 text-xl leading-none text-slate-300 hover:bg-slate-800 hover:text-white md:hidden"
    >
      ☰
    </button>
  );
}

export function App() {
  return (
    <InstanceListProvider>
      <UnsavedChangesProvider>
        <MobileNavProvider>
          <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
            <header className="flex-shrink-0 border-b border-slate-800 bg-slate-900/60">
              {/* Below md:, the actions row (restart indicator + search) drops to its own
                  full-width line instead of squeezing next to the title -- w-full/md:w-auto
                  forces that split deterministically rather than leaving it to flex-wrap's
                  natural overflow point, matching the rest of the app's single md: breakpoint. */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div className="flex items-center gap-2">
                  <HamburgerButton />
                  <GuardedLink to="/" className="text-lg font-semibold tracking-tight">
                    RTLSDR-Airband Panel
                  </GuardedLink>
                </div>
                <div className="flex w-full items-center gap-3 md:w-auto">
                  <PendingRestartIndicator />
                  <InstanceSearchInput />
                </div>
              </div>
            </header>
            <main className="min-h-0 flex-1">
              <Routes>
                <Route path="/" element={<TwoPaneLayout />}>
                  <Route index element={<WelcomePage />} />
                  <Route path="instances/new" element={<InstanceCreatePage />} />
                  <Route path="instances/:name" element={<InstanceEditPage />} />
                  <Route
                    path="stats"
                    element={
                      <Suspense fallback={<p className="text-slate-400">Loading…</p>}>
                        <StatsPage />
                      </Suspense>
                    }
                  />
                </Route>
              </Routes>
            </main>
          </div>
        </MobileNavProvider>
      </UnsavedChangesProvider>
    </InstanceListProvider>
  );
}
