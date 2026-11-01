import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ValidationBanner } from "./ValidationBanner.js";
import { ISSUE_HINTS } from "../generated/issue-hints.js";
import type { RtlAirbandConfig, ValidationIssue } from "../types/config.js";

const config = { devices: [] } as unknown as RtlAirbandConfig;
const issue = (code: string, severity: ValidationIssue["severity"] = "error"): ValidationIssue => ({
  severity,
  code,
  message: `message for ${code}`,
  path: "$",
});

describe("ValidationBanner fix hints", () => {
  it("shows the summary on hover and expands the detail on click", async () => {
    const user = userEvent.setup();
    render(<ValidationBanner errors={[issue("fft-bin-collision")]} config={config} onJumpTo={() => {}} />);
    const hint = ISSUE_HINTS["fft-bin-collision"]!;

    const button = screen.getByRole("button", { name: "How to fix" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(hint.detail)).not.toBeInTheDocument();

    await user.hover(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent(hint.summary);
    expect(screen.getByRole("tooltip")).toBeVisible();

    await user.click(button);
    expect(screen.getByRole("button", { name: "Hide how to fix" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(hint.detail)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide how to fix" }));
    expect(screen.queryByText(hint.detail)).not.toBeInTheDocument();
  });

  it("gives warnings hints too, and each row expands on its own", async () => {
    const user = userEvent.setup();
    render(
      <ValidationBanner
        warnings={[issue("squelch-deprecated", "warning"), issue("scan-list-too-long", "warning")]}
        config={config}
        onJumpTo={() => {}}
      />
    );
    const [first] = screen.getAllByRole("button", { name: "How to fix" });
    await user.click(first!);
    expect(screen.getByText(ISSUE_HINTS["squelch-deprecated"]!.detail)).toBeInTheDocument();
    expect(screen.queryByText(ISSUE_HINTS["scan-list-too-long"]!.detail)).not.toBeInTheDocument();
  });

  it("adds nothing for codes without a hint", () => {
    render(
      <ValidationBanner errors={[issue("request-failed"), issue("constructor")]} config={config} onJumpTo={() => {}} />
    );
    expect(screen.getByText("message for request-failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "How to fix" })).not.toBeInTheDocument();
  });
});
