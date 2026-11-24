import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ErrorLogEvent } from "../../src/api/client.js";
import { ErrorsPage } from "../../src/pages/ErrorsPage.js";
import { renderPage } from "./harness.js";

const api = vi.hoisted(() => ({
  listInstances: vi.fn(),
  listEvents: vi.fn(),
  acknowledgeEvents: vi.fn(),
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
  api.listEvents.mockResolvedValue({ events: EVENTS, acknowledgedId: 0 });
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

describe("ErrorsPage acknowledging", () => {
  // The error log is module state and an acknowledgement never moves back, so
  // each test loads its own copy, as a separate browser would.
  async function openFresh() {
    vi.resetModules();
    const { renderPage: renderFresh } = await import("./harness.js");
    const { ErrorsPage: Page } = await import("../../src/pages/ErrorsPage.js");
    const log = await import("../../src/lib/error-log.js");
    const view = renderFresh("/errors", "/errors", <Page />);
    await waitFor(() => expect(log.errorLog.get().events).not.toBeNull());
    return { view, log, badge: () => log.unacknowledgedProblems(log.errorLog.get()).count };
  }
  const button = () => screen.findByRole("button", { name: "Acknowledge all" });
  const toggle = () => screen.getByRole("checkbox", { name: "Show acknowledged" });

  beforeEach(() => {
    api.acknowledgeEvents.mockReset();
    api.acknowledgeEvents.mockImplementation((through: number) => Promise.resolve({ acknowledgedId: through }));
  });

  it("leaves the count alone when the page is only opened", async () => {
    const { badge } = await openFresh();
    await screen.findByText(ERROR);
    expect(badge()).toBe(2);
    expect(api.acknowledgeEvents).not.toHaveBeenCalled();
  });

  it("clears the list and the count, without asking when nothing is filtered", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    const { badge } = await openFresh();
    await user.click(await button());
    expect(api.acknowledgeEvents).toHaveBeenCalledExactlyOnceWith(5);
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByText(/^No new errors/)).toBeInTheDocument();
    expect(visibleRows()).toEqual([]);
    expect(screen.queryByText(RESTART)).not.toBeInTheDocument();
    expect(badge()).toBe(0);
    expect(await button()).toBeDisabled();
  });

  it("starts empty in another browser, and the toggle brings entries back", async () => {
    api.listEvents.mockResolvedValue({ events: EVENTS, acknowledgedId: 5 });
    const user = userEvent.setup();
    const { badge } = await openFresh();
    expect(await screen.findByText(/^No new errors/)).toBeInTheDocument();
    expect(badge()).toBe(0);
    expect(await button()).toBeDisabled();
    await user.click(toggle());
    expect(visibleRows()).toEqual([ERROR, WARNING, INFO]);
    expect(screen.getByText(RESTART)).toBeInTheDocument();
  });

  it("shows only what came after the acknowledgement", async () => {
    api.listEvents.mockResolvedValue({ events: EVENTS, acknowledgedId: 4 });
    const { badge } = await openFresh();
    await screen.findByText(ERROR);
    expect(visibleRows()).toEqual([ERROR]);
    expect(badge()).toBe(1);
  });

  it("follows an acknowledgement pushed from another browser", async () => {
    const { log } = await openFresh();
    await screen.findByText(ERROR);
    act(() => log.errorLog.setAcknowledged(5));
    expect(visibleRows()).toEqual([]);
  });

  it("asks first when a filter is hiding entries", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    await openFresh();
    await user.selectOptions(showSelect(), "warning");
    await user.click(await button());
    expect(confirm).toHaveBeenCalledOnce();
    expect(api.acknowledgeEvents).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(await button());
    expect(api.acknowledgeEvents).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("keeps the list and says why when the request fails", async () => {
    api.acknowledgeEvents.mockRejectedValue(new Error("disk is full"));
    const user = userEvent.setup();
    const { badge } = await openFresh();
    await user.click(await button());
    expect(await screen.findByText("disk is full")).toBeInTheDocument();
    expect(visibleRows()).toEqual([ERROR, WARNING, INFO]);
    expect(badge()).toBe(2);
    expect(await button()).toBeEnabled();
  });

  it("offers older pages only when they could have something to show", async () => {
    const page = Array.from({ length: 200 }, (_, i) => event(400 - i, "log", "error", `row ${400 - i}`));
    api.listEvents.mockResolvedValue({ events: page, acknowledgedId: 300 });
    const user = userEvent.setup();
    await openFresh();
    await screen.findByText("row 400");
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
    await user.click(toggle());
    expect(screen.getByRole("button", { name: "Load older" })).toBeInTheDocument();
  });
});
