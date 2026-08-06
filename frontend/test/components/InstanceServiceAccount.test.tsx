import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstanceServiceAccount } from "../../src/components/InstanceServiceAccount.js";

describe("InstanceServiceAccount", () => {
  it("warns when control_socket_path is set but no account is configured", () => {
    render(<InstanceServiceAccount name="rtl_test" controlSocketPathSet pending={false} onSave={() => {}} />);
    expect(screen.getByText(/Apply live will fail with a permission error/)).toBeInTheDocument();
  });

  it("does not warn when control_socket_path is unset", () => {
    render(<InstanceServiceAccount name="rtl_test" controlSocketPathSet={false} pending={false} onSave={() => {}} />);
    expect(screen.queryByText(/Apply live will fail with a permission error/)).not.toBeInTheDocument();
  });

  it("does not warn once a service user is configured", () => {
    render(<InstanceServiceAccount name="rtl_test" serviceUser="rtl-airband" controlSocketPathSet pending={false} onSave={() => {}} />);
    expect(screen.queryByText(/Apply live will fail with a permission error/)).not.toBeInTheDocument();
  });

  it("disables Save until a field is edited, then calls onSave with both values", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InstanceServiceAccount name="rtl_test" controlSocketPathSet={false} pending={false} onSave={onSave} />);

    const saveButton = screen.getByRole("button", { name: /Save service account/ });
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByLabelText(/^Service user/), "rtl-airband");
    await user.type(screen.getByLabelText(/^Service group/), "rtl-airband");
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    expect(onSave).toHaveBeenCalledWith("rtl-airband", "rtl-airband");
  });
});
