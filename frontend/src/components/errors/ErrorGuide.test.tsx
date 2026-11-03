import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ERROR_GUIDE } from "../../lib/error-guide.js";
import { ErrorGuide } from "./ErrorGuide.js";

const icecast = ERROR_GUIDE.find((e) => e.id === "icecast")!;

describe("ErrorGuide", () => {
  it("starts collapsed, and expands an entry on click", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<ErrorGuide counts={new Map()} jump={null} />);
    expect(screen.queryByText(icecast.title)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Common errors and how to fix them/ }));
    const entry = screen.getByRole("button", { name: new RegExp(icecast.title) });
    expect(entry).toHaveAttribute("aria-expanded", "false");
    await user.click(entry);
    expect(screen.getByText(icecast.fixes[1]!)).toBeInTheDocument();
  });

  it("shows how often each kind is in the log", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<ErrorGuide counts={new Map([["icecast", 3]])} jump={null} />);
    expect(screen.getByText("1 kind in the loaded log")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Common errors and how to fix them/ }));
    expect(screen.getByText("3 in log")).toBeInTheDocument();
  });

  it("opens itself and the entry on a jump", async () => {
    localStorage.clear();
    // jsdom doesn't lay out, so it has no scrollIntoView.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { rerender } = render(<ErrorGuide counts={new Map()} jump={null} />);
    rerender(<ErrorGuide counts={new Map()} jump={{ id: "icecast", n: 1 }} />);
    await waitFor(() => expect(screen.getByText(icecast.fixes[1]!)).toBeInTheDocument());
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(document.getElementById("guide-icecast"));
  });
});
