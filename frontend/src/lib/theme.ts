/** Theme preference: follow the OS, or force dark/light. Stored per browser. */
export type ThemePreference = "system" | "dark" | "light";

const STORAGE_KEY = "rtl-panel-theme";

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "dark" || raw === "light" ? raw : "system";
  } catch {
    return "system";
  }
}

/** Applies a preference via `data-theme` on <html> (see index.css) and remembers it. */
export function applyThemePreference(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage blocked (private window): the choice just won't persist.
  }
}
