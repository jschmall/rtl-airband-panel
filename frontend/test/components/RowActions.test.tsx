import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let compact = false;
const listeners = new Set<() => void>();

function setCompact(next: boolean) {
  compact = next;
  for (const l of listeners) l();
}

beforeEach(() => {
  compact = false;
  listeners.clear();
  // use-media.ts keeps its MediaQueryLists, so each test gets its own copy of it.
  vi.resetModules();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return compact;
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
});

afterEach(() => vi.unstubAllGlobals());

async function setup(onRemove = () => {}) {
  const { RowActions, OffBadge } = await import("../../src/components/RowActions.js");
  return render(
    <>
      <p>
        Row
        <OffBadge disable />
        <OffBadge enabled={false} />
        <OffBadge enabled />
      </p>
      <RowActions label="channel 1">
        <label>
          <input type="checkbox" /> Disable
        </label>
        <button type="button" onClick={onRemove}>
          Remove
        </button>
      </RowActions>
    </>
  );
}

const menu = () => screen.getByRole("button", { name: "Actions for channel 1" });
const remove = () => screen.queryByRole("button", { name: "Remove" });

describe("RowActions", () => {
  it("shows the actions inline on a wide screen, without badges", async () => {
    await setup();
    expect(remove()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Actions/ })).not.toBeInTheDocument();
    expect(screen.queryByText("disabled")).not.toBeInTheDocument();
  });

  it("puts them behind a menu on a compact one, and says what's off", async () => {
    compact = true;
    const onRemove = vi.fn();
    const user = userEvent.setup();
    await setup(onRemove);
    expect(screen.getAllByText(/^(disabled|not enabled)$/).map((e) => e.textContent)).toEqual(["disabled", "not enabled"]);
    expect(remove()).not.toBeInTheDocument();

    await user.click(menu());
    await user.click(screen.getByRole("checkbox", { name: "Disable" }));
    expect(menu()).toHaveAttribute("aria-expanded", "true"); // a checkbox leaves it open
    await user.click(remove()!);
    expect(onRemove).toHaveBeenCalledOnce();
    expect(remove()).not.toBeInTheDocument();
    expect(menu()).toHaveFocus();
  });

  it("closes on Escape, returning focus, and on a press outside", async () => {
    compact = true;
    const user = userEvent.setup();
    await setup();
    await user.click(menu());
    await user.keyboard("{Escape}");
    expect(remove()).not.toBeInTheDocument();
    expect(menu()).toHaveFocus();
    await user.click(menu());
    await user.click(screen.getByText("Row"));
    expect(remove()).not.toBeInTheDocument();
  });

  it("follows the screen, and doesn't reopen on the way back", async () => {
    compact = true;
    const user = userEvent.setup();
    await setup();
    await user.click(menu());
    act(() => setCompact(false));
    expect(remove()).toBeInTheDocument();
    act(() => setCompact(true));
    expect(remove()).not.toBeInTheDocument();
  });
});
