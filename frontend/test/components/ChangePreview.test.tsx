import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangePreview } from "../../src/components/ChangePreview.js";
import type { PlanReport } from "../../src/api/client.js";

function plan(overrides: Partial<PlanReport> = {}): PlanReport {
  return { method: "live", live: [], restart: [], interrupts: [], baselineKnown: true, ...overrides };
}

describe("ChangePreview", () => {
  it("summarizes a live-appliable change and lists it on demand", async () => {
    render(<ChangePreview plan={plan({ live: ["device[0]: gain -> 31"] })} />);
    expect(screen.getByText("Can be applied live, without a restart")).toBeInTheDocument();
    expect(screen.queryByText("device[0]: gain -> 31")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("device[0]: gain -> 31")).toBeInTheDocument();
  });

  it("flags restart-only changes and audio interruptions", async () => {
    render(
      <ChangePreview
        plan={plan({ method: "restart", restart: ["localtime changed"], interrupts: ["device[0]: channel[2] is torn down"] })}
      />
    );
    expect(screen.getByText("Needs a restart to take effect")).toBeInTheDocument();
    expect(screen.getByText(/briefly interrupts audio/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("localtime changed")).toBeInTheDocument();
    expect(screen.getByText("device[0]: channel[2] is torn down")).toBeInTheDocument();
  });

  it("has nothing to expand when the running process is already up to date", () => {
    render(<ChangePreview plan={plan({ method: "no_change" })} />);
    expect(screen.getByText("The running process already has this configuration")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("explains an assumed baseline", async () => {
    render(<ChangePreview plan={plan({ method: "no_change", baselineKnown: false })} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/wasn't started by the panel/)).toBeInTheDocument();
  });
});
