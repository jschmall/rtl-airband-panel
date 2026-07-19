import { Link, Route, Routes } from "react-router-dom";
import { InstanceListPage } from "./pages/InstanceListPage.js";
import { InstanceEditPage } from "./pages/InstanceEditPage.js";
import { InstanceCreatePage } from "./pages/InstanceCreatePage.js";
import { InstanceStatsPage } from "./pages/InstanceStatsPage.js";

export function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            RTLSDR-Airband Panel
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">
        <Routes>
          <Route path="/" element={<InstanceListPage />} />
          <Route path="/instances/new" element={<InstanceCreatePage />} />
          <Route path="/instances/:name" element={<InstanceEditPage />} />
          <Route path="/instances/:name/stats" element={<InstanceStatsPage />} />
        </Routes>
      </main>
    </div>
  );
}
