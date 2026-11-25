import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { loadSidePanelWidth, saveSidePanelWidth } from "../../src/lib/side-panel-width.js";

// The panel's own behavior; what the rail shows and how wide that is gets checked in a browser.
vi.mock("../../src/components/layout/Rail.js", () => ({ Rail: () => <p>rail</p>, RailSizer: () => <p>sizer</p> }));
const { SidePanel } = await import("../../src/components/layout/SidePanel.js");

const START = 300;
const handle = () => screen.getByRole("separator", { name: "Resize the side panel" });
const panel = () => screen.getByRole("complementary");

/** jsdom has no PointerEvent: a plain event with the fields set. */
function pointer(type: "pointerDown" | "pointerMove" | "pointerUp" | "lostPointerCapture", clientX: number, pointerId = 1, button = 0) {
  const event = createEvent[type](handle());
  Object.defineProperties(event, { clientX: { value: clientX }, pointerId: { value: pointerId }, button: { value: button } });
  fireEvent(handle(), event);
}

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1440;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { width: parseFloat(this.style.width) || START } as DOMRect;
  });
});

describe("SidePanel", () => {
  it("fits its content until it's dragged, and remembers the drag on release", () => {
    render(<SidePanel />);
    expect(screen.getByText("sizer")).toBeInTheDocument();
    pointer("pointerDown", 300);
    pointer("pointerMove", 400);
    expect(panel().style.width).toBe("400px");
    expect(screen.queryByText("sizer")).toBeNull();
    expect(loadSidePanelWidth()).toBeNull();
    pointer("pointerUp", 400);
    expect(loadSidePanelWidth()).toBe(400);
    pointer("pointerMove", 500);
    expect(panel().style.width).toBe("400px");
  });

  it("stays between the limits", () => {
    render(<SidePanel />);
    pointer("pointerDown", 300);
    pointer("pointerMove", 2000);
    expect(panel().style.width).toBe("720px");
    pointer("pointerMove", 5);
    expect(panel().style.width).toBe("192px");
  });

  it("keeps what a drag the browser cut off had reached", () => {
    render(<SidePanel />);
    pointer("pointerDown", 300);
    pointer("pointerMove", 350);
    pointer("lostPointerCapture", 350);
    expect(loadSidePanelWidth()).toBe(350);
  });

  it("ignores a click, another button and a second finger", () => {
    render(<SidePanel />);
    pointer("pointerDown", 300);
    pointer("pointerMove", 302);
    pointer("pointerMove", 500, 2);
    pointer("pointerUp", 302);
    pointer("pointerDown", 300, 1, 2);
    pointer("pointerMove", 500);
    expect(panel().style.width).toBe("");
    expect(loadSidePanelWidth()).toBeNull();
  });

  it("goes back to fitting on a double-click or Enter", () => {
    saveSidePanelWidth(420);
    render(<SidePanel />);
    expect(panel().style.width).toBe("420px");
    fireEvent.doubleClick(handle());
    expect(panel().style.width).toBe("");
    expect(loadSidePanelWidth()).toBeNull();
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(loadSidePanelWidth()).toBe(316);
    fireEvent.keyDown(handle(), { key: "Enter" });
    expect(loadSidePanelWidth()).toBeNull();
  });

  it("resizes from the keyboard", () => {
    render(<SidePanel />);
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(loadSidePanelWidth()).toBe(284);
    fireEvent.keyDown(handle(), { key: "End" });
    expect(loadSidePanelWidth()).toBe(720);
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(loadSidePanelWidth()).toBe(192);
    fireEvent.keyDown(handle(), { key: "Tab" });
    expect(loadSidePanelWidth()).toBe(192);
  });
});
