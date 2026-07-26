import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface UnsavedChangesContextValue {
  isDirty: boolean;
  /** The currently-open editor calls this whenever its dirty state changes. */
  setDirty: (dirty: boolean) => void;
  /** Returns true if it's OK to navigate away: either nothing's unsaved, or the user confirmed discarding it. */
  confirmDiscard: () => boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

const DISCARD_MESSAGE = "You have unsaved changes on this instance. Discard them and continue?";

/**
 * Single shared "is the currently-open editor dirty" flag, so any in-app nav
 * link (sidebar instance switch, header logo, "Stats") can guard against
 * silently discarding an unsaved edit — not just the editor page itself.
 * Deliberately doesn't cover the browser back/forward buttons: this app uses
 * a plain BrowserRouter/Routes tree, and react-router's useBlocker (which
 * would cover that) only works with a data router (createBrowserRouter),
 * which is a much bigger change than this warranted. beforeunload (wired up
 * in InstanceEditPage) covers an actual tab close/refresh instead.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  const setDirty = useCallback((dirty: boolean) => setIsDirty(dirty), []);
  const confirmDiscard = useCallback(() => !isDirtyRef.current || window.confirm(DISCARD_MESSAGE), []);

  const value = useMemo(() => ({ isDirty, setDirty, confirmDiscard }), [isDirty, setDirty, confirmDiscard]);

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}

export function useUnsavedChanges(): UnsavedChangesContextValue {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) throw new Error("useUnsavedChanges must be used within an UnsavedChangesProvider");
  return ctx;
}
