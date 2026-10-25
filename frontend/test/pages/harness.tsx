import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InstanceListProvider } from "../../src/state/InstanceListContext.js";
import { UnsavedChangesProvider } from "../../src/state/UnsavedChangesContext.js";

/**
 * Renders a page the way App does (instance-list and unsaved-changes
 * providers inside a router) at `url`, matched against `route`. Pair it with
 * a `vi.mock` of the api client: the providers fetch the instance list, and
 * jsdom's WebSocket should be stubbed out (`vi.stubGlobal("WebSocket", undefined)`).
 */
export function renderPage(route: string, url: string, page: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <UnsavedChangesProvider>
        <InstanceListProvider>
          <Routes>
            <Route path={route} element={page} />
          </Routes>
        </InstanceListProvider>
      </UnsavedChangesProvider>
    </MemoryRouter>
  );
}
