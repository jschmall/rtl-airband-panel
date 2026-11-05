import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ErrorLogEvent } from "../../src/api/client.js";
import { ErrorsPage } from "../../src/pages/ErrorsPage.js";
import { renderPage } from "./harness.js";

const api = vi.hoisted(() => ({
  listInstances: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, api };
});

const LEVEL_KEY = "rtl-panel:errors-level";
const TS = new Date(2026, 10, 5, 12, 0, 0).getTime();

function event(id: number, kind: string, severity: ErrorLogEvent["severity"], message: string): ErrorLogEvent {
  return { id, instance: "tower", ts: TS - id * 1000, kind, severity, message };
}

// Messages that no guide entry or filter label also contains.
const ERROR = "fixture error row";
const WARNING = "fixture warning row";
const INFO = "fixture info row";
const RESTART = "fixture restart marker";
const UNEXPECTED = "fixture unexpected restart marker";

const EVENTS = [
  event(5, "log", "error", ERROR),
  event(4, "log", "warning", WARNING),
  event(3, "log", "info", INFO),
  event(2, "restart", "info", RESTART),
  event(1, "unexpected-restart", "warning", UNEXPECTED),
];

const showSelect = () => screen.getByRole<HTMLSelectElement>("combobox", { name: /^Show/ });

/** Renders the page and waits for the event log to appear. */
async function open() {
  const view = renderPage("/errors", "/errors", <ErrorsPage />);
  await screen.findByText(RESTART);
  return view;
}

/** Which of the non-marker fixture rows are on screen. */
function visibleRows() {
  return [ERROR, WARNING, INFO].filter((m) => screen.queryByText(m) !== null);
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("WebSocket", undefined);
  api.listInstances.mockResolvedValue([]);
  api.listEvents.mockResolvedValue(EVENTS);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ErrorsPage Show filter", () => {
  it("offers the three options, defaulting to errors and warnings", async () => {
    await open();
    expect(showSelect().value).toBe("all");
    expect([...showSelect().options].map((o) => o.text)).toEqual(["Errors and warnings", "Errors only", "Warnings only"]);
  });

  it.each([
    ["all", [ERROR, WARNING, INFO]],
    ["error", [ERROR]],
    ["warning", [WARNING]],
  ])("option %s shows only its rows, and the markers", async (level, expected) => {
    const user = userEvent.setup();
    await open();
    await user.selectOptions(showSelect(), level);
    expect(visibleRows()).toEqual(expected);
    expect(screen.getByText(RESTART)).toBeInTheDocument();
    expect(screen.getByText(UNEXPECTED)).toBeInTheDocument();
  });

  it("leaves markers to the checkbox under every option", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("checkbox", { name: "Restart markers" }));
    for (const level of ["all", "error", "warning"]) {
      await user.selectOptions(showSelect(), level);
      expect(screen.queryByText(RESTART)).not.toBeInTheDocument();
      expect(screen.queryByText(UNEXPECTED)).not.toBeInTheDocument();
    }
  });

  it.each([
    ["warning", [WARNING]],
    ["error", [ERROR]],
  ])("keeps %s across an unmount and remount", async (level, expected) => {
    const user = userEvent.setup();
    const first = await open();
    await user.selectOptions(showSelect(), level);
    first.unmount();

    await open();
    expect(showSelect().value).toBe(level);
    expect(visibleRows()).toEqual(expected);
  });

  it("does not remember the instance or the markers checkbox", async () => {
    const user = userEvent.setup();
    const first = await open();
    await user.selectOptions(screen.getByRole("combobox", { name: /^Instance/ }), "tower");
    await user.click(screen.getByRole("checkbox", { name: "Restart markers" }));
    first.unmount();

    renderPage("/errors", "/errors", <ErrorsPage />);
    expect(await screen.findByRole<HTMLSelectElement>("combobox", { name: /^Instance/ })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Restart markers" })).toBeChecked();
  });

  it("falls back to the default for a stored value it doesn't recognise", async () => {
    localStorage.setItem(LEVEL_KEY, "bogus");
    await open();
    expect(showSelect().value).toBe("all");
    expect(visibleRows()).toEqual([ERROR, WARNING, INFO]);
  });

  it("still works when storage is blocked", async () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    const user = userEvent.setup();
    await open();
    expect(showSelect().value).toBe("all");
    await user.selectOptions(showSelect(), "warning");
    expect(showSelect().value).toBe("warning");
    expect(visibleRows()).toEqual([WARNING]);
  });
});
