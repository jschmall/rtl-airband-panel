import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Output } from "@rtl-airband-panel/parser";
import { OutputEditor } from "../../src/components/OutputEditor.js";
import { defaultPulseOutput } from "../../src/lib/defaults.js";
import type { ChannelTarget } from "../../src/lib/channel-targets.js";

/**
 * OutputEditor is a controlled component (the parent owns `output` state),
 * so exercising it needs a small stateful wrapper -- this mirrors how
 * ChannelEditor/MixerEditor actually use it in the app.
 */
function Harness() {
  const [output, setOutput] = useState<Output>(defaultPulseOutput());
  return (
    <OutputEditor
      output={output}
      outputIndex={0}
      onChange={(_key, next) => setOutput(next)}
      onRemove={() => {}}
      onDuplicate={() => {}}
      pathPrefix="$.test"
    />
  );
}

describe("OutputEditor type-switch value memory", () => {
  it("restores a field's value when switching back to a previously-visited type", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The output card starts collapsed.
    await user.click(screen.getByRole("button", { name: /Output — pulse/ }));

    const serverInput = screen.getByLabelText(/Server \(optional/);
    await user.type(serverInput, "pulse.example.com");
    expect(serverInput).toHaveValue("pulse.example.com");

    await user.selectOptions(screen.getByLabelText("Output type"), "icecast");
    expect(screen.queryByLabelText(/Server \(optional/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Server/)).toHaveValue("");

    await user.selectOptions(screen.getByLabelText("Output type"), "pulse");
    expect(screen.getByLabelText(/Server \(optional/)).toHaveValue("pulse.example.com");
  });

  it("does not carry a value over to a type that's never been visited before", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /Output — pulse/ }));
    await user.type(screen.getByLabelText(/Server \(optional/), "pulse.example.com");

    // First-ever visit to icecast should start from defaults, not from pulse's value.
    await user.selectOptions(screen.getByLabelText("Output type"), "icecast");
    expect(screen.getByLabelText(/Server/)).toHaveValue("");
  });

  it("keeps the same list identity across a type switch (regression: v0.4.19 remount bug)", async () => {
    // Switching type used to mint a fresh identity key for the replacement
    // value, which made the surrounding list re-key this slot and React
    // remount OutputEditor -- silently resetting the Collapsible's open state
    // and wiping the very type-memory cache this test suite covers. If that
    // regresses, the card collapses back to closed on every type switch.
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /Output — pulse/ }));
    await user.selectOptions(screen.getByLabelText("Output type"), "icecast");

    expect(screen.getByRole("button", { name: /Output — icecast/ })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("OutputEditor copy to channel", () => {
  it("does not render the action when there are no copy targets", () => {
    render(
      <OutputEditor output={defaultPulseOutput()} outputIndex={0} onChange={() => {}} onRemove={() => {}} onDuplicate={() => {}} pathPrefix="$.test" />
    );
    expect(screen.queryByRole("button", { name: /Copy to channel/ })).not.toBeInTheDocument();
  });

  it("lets the user pick a target and calls onCopyOutputToChannel with the output and target", async () => {
    const user = userEvent.setup();
    const output = defaultPulseOutput();
    const targets: ChannelTarget[] = [
      { deviceIndex: 0, channelIndex: 1, label: "100.1000 MHz (Device 0)" },
      { deviceIndex: 1, channelIndex: 0, label: "Scan channel (Device 1 — rtlsdr)" },
    ];
    const onCopyOutputToChannel = vi.fn();
    render(
      <OutputEditor
        output={output}
        outputIndex={0}
        onChange={() => {}}
        onRemove={() => {}}
        onDuplicate={() => {}}
        pathPrefix="$.test"
        channelTargets={targets}
        onCopyOutputToChannel={onCopyOutputToChannel}
      />
    );

    await user.click(screen.getByRole("button", { name: /Copy to channel/ }));
    await user.selectOptions(screen.getByRole("combobox"), "Scan channel (Device 1 — rtlsdr)");
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(onCopyOutputToChannel).toHaveBeenCalledTimes(1);
    expect(onCopyOutputToChannel).toHaveBeenCalledWith(output, targets[1]);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("closes the picker without copying on Cancel", async () => {
    const user = userEvent.setup();
    const targets: ChannelTarget[] = [{ deviceIndex: 0, channelIndex: 1, label: "100.1000 MHz (Device 0)" }];
    const onCopyOutputToChannel = vi.fn();
    render(
      <OutputEditor
        output={defaultPulseOutput()}
        outputIndex={0}
        onChange={() => {}}
        onRemove={() => {}}
        onDuplicate={() => {}}
        pathPrefix="$.test"
        channelTargets={targets}
        onCopyOutputToChannel={onCopyOutputToChannel}
      />
    );

    await user.click(screen.getByRole("button", { name: /Copy to channel/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCopyOutputToChannel).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
