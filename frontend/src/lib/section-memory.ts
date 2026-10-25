/**
 * Which collapsible sections are open, remembered per browser under a key
 * naming the section and the instance it belongs to (e.g.
 * "instance:tower:devices"), so each instance keeps its own layout.
 */
const PREFIX = "rtl-panel-open:";

export function loadSectionOpen(key: string): boolean | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === "1" ? true : raw === "0" ? false : undefined;
  } catch {
    return undefined;
  }
}

export function saveSectionOpen(key: string, open: boolean): void {
  try {
    localStorage.setItem(PREFIX + key, open ? "1" : "0");
  } catch {
    // Storage blocked (private window): the layout just won't persist.
  }
}
