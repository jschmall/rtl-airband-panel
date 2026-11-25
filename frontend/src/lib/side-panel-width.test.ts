import { beforeEach, describe, expect, it } from "vitest";
import { clampSidePanelWidth, loadSidePanelWidth, saveSidePanelWidth, sidePanelMax } from "./side-panel-width.js";

const KEY = "rtl-panel:side-panel-width";

describe("side panel width", () => {
  beforeEach(() => localStorage.clear());

  it("fits its content until a width is saved, and again once it's cleared", () => {
    expect(loadSidePanelWidth()).toBeNull();
    saveSidePanelWidth(420);
    expect(loadSidePanelWidth()).toBe(420);
    saveSidePanelWidth(null);
    expect(loadSidePanelWidth()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("ignores a stored value that isn't a usable width", () => {
    for (const bad of ["bogus", "", "-5", "10", "Infinity", "NaN"]) {
      localStorage.setItem(KEY, bad);
      expect(loadSidePanelWidth()).toBeNull();
    }
  });

  it("is limited to half the page", () => {
    expect(clampSidePanelWidth(50, 1440)).toBe(192);
    expect(clampSidePanelWidth(400.4, 1440)).toBe(400);
    expect(clampSidePanelWidth(5000, 1440)).toBe(720);
    expect(sidePanelMax(1025)).toBe(512);
    expect(sidePanelMax(100)).toBe(192);
  });
});
