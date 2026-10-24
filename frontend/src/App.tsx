import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { InstanceEditPage } from "./pages/InstanceEditPage.js";
import { InstanceCreatePage } from "./pages/InstanceCreatePage.js";
import { InstanceListProvider } from "./state/InstanceListContext.js";
import { UnsavedChangesProvider } from "./state/UnsavedChangesContext.js";
import { MobileNavProvider } from "./state/MobileNavContext.js";

// recharts (and its d3 dependencies) account for most of the bundle size but
// are only needed on this one route -- split into its own chunk instead of
// shipping them to everyone loading the instance list/editor.
const StatsPage = lazy(() => import("./pages/StatsPage.js").then((m) => ({ default: m.StatsPage })));
const HardwarePage = lazy(() => import("./pages/HardwarePage.js").then((m) => ({ default: m.HardwarePage })));

export function App() {
  return (
    <InstanceListProvider>
      <UnsavedChangesProvider>
        <MobileNavProvider>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<OverviewPage />} />
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
              <Route
                path="hardware"
                element={
                  <Suspense fallback={<p className="text-slate-400">Loading…</p>}>
                    <HardwarePage />
                  </Suspense>
                }
              />
            </Route>
          </Routes>
        </MobileNavProvider>
      </UnsavedChangesProvider>
    </InstanceListProvider>
  );
}
