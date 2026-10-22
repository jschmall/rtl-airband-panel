import { afterEach, describe, expect, it } from "vitest";
import { applyThemePreference, loadThemePreference } from "../../src/lib/theme.js";

describe("theme preference", () => {
  afterEach(() => applyThemePreference("system"));

  it("defaults to following the system", () => {
    expect(loadThemePreference()).toBe("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("forces and remembers a theme", () => {
    applyThemePreference("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(loadThemePreference()).toBe("light");
    applyThemePreference("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(loadThemePreference()).toBe("system");
  });
});
