/** Narrowest and (as a share of the page) widest the side panel can be dragged. */
export const SIDE_PANEL_MIN_PX = 192;
export const SIDE_PANEL_MAX_SHARE = 0.5;

const WIDTH_KEY = "rtl-panel:side-panel-width";

/** The width the user dragged the side panel to, or null to fit its content. */
export function loadSidePanelWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(v) && v >= SIDE_PANEL_MIN_PX ? v : null;
  } catch {
    return null;
  }
}

export function saveSidePanelWidth(v: number | null) {
  try {
    if (v === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(v));
  } catch {
    // Storage blocked: the choice just won't be remembered.
  }
}

export function sidePanelMax(pageWidth: number): number {
  return Math.max(SIDE_PANEL_MIN_PX, Math.floor(pageWidth * SIDE_PANEL_MAX_SHARE));
}

export function clampSidePanelWidth(px: number, pageWidth: number): number {
  return Math.round(Math.min(Math.max(px, SIDE_PANEL_MIN_PX), sidePanelMax(pageWidth)));
}
