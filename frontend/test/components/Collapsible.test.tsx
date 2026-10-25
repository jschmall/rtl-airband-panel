import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Collapsible } from "../../src/components/Collapsible.js";

afterEach(() => localStorage.clear());

function Section({ persistKey, onOpenChange }: { persistKey: string; onOpenChange?: (open: boolean) => void }) {
  return (
    <Collapsible title="Devices" defaultOpen persistKey={persistKey} onOpenChange={onOpenChange}>
      <p>content</p>
    </Collapsible>
  );
}

describe("Collapsible persistKey", () => {
  it("remembers each key's state separately, and loads it when the key changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Section persistKey="instance:a:devices" />);
    expect(screen.getByText("content")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Devices" }));
    expect(screen.queryByText("content")).not.toBeInTheDocument();

    // Another instance on the same page: its own (default) state, not a's.
    rerender(<Section persistKey="instance:b:devices" />);
    expect(screen.getByText("content")).toBeInTheDocument();

    // Back to a: still collapsed.
    rerender(<Section persistKey="instance:a:devices" />);
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("starts from a remembered state on mount and reports it", () => {
    localStorage.setItem("rtl-panel-open:instance:a:devices", "0");
    const onOpenChange = vi.fn();
    render(<Section persistKey="instance:a:devices" onOpenChange={onOpenChange} />);
    expect(screen.queryByText("content")).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
