import { Link, Route, Routes } from "react-router-dom";
import { TwoPaneLayout } from "./components/layout/TwoPaneLayout.js";
import { WelcomePage } from "./pages/WelcomePage.js";
import { InstanceEditPage } from "./pages/InstanceEditPage.js";
import { InstanceCreatePage } from "./pages/InstanceCreatePage.js";
import { StatsPage } from "./pages/StatsPage.js";

export function App() {
  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex-shrink-0 border-b border-slate-800 bg-slate-900/60">
        <div className="px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            RTLSDR-Airband Panel
          </Link>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<TwoPaneLayout />}>
            <Route index element={<WelcomePage />} />
            <Route path="instances/new" element={<InstanceCreatePage />} />
            <Route path="instances/:name" element={<InstanceEditPage />} />
            <Route path="stats" element={<StatsPage />} />
          </Route>
        </Routes>
      </main>
    </div>
  );
}
