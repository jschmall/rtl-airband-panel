import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MultichannelChannel, Mixer } from "@rtl-airband-panel/parser";
import { ChannelEditor } from "../../src/components/ChannelEditor.js";
import { MixerEditor } from "../../src/components/MixerEditor.js";
import { defaultChannel, defaultMixer } from "../../src/lib/defaults.js";

/**
 * BoolField's visible label sits inside a Tooltip trigger span, with the
 * (CSS-only, not jsdom-hidden) tooltip content as a sibling span in the same
 * <label> -- so getByLabelText's aggregated-textContent match sees both
 * "Enabled" and the whole tooltip sentence concatenated, and never matches
 * exactly. Locate the trigger span by its own exact text instead, then walk
 * up to the checkbox it labels.
 */
function checkboxLabeled(text: string): HTMLInputElement {
  const trigger = screen.getByText(text, { selector: "span" });
  const label = trigger.closest("label");
  if (!label) throw new Error(`no <label> ancestor for trigger text '${text}'`);
  const input = label.querySelector("input[type=checkbox]");
  if (!input) throw new Error(`no checkbox inside <label> for trigger text '${text}'`);
  return input as HTMLInputElement;
}

/**
 * Covers the dynamic_reload `enabled` keyword's UI on channels/mixers --
 * distinct from the pre-existing `disable` field (see ChannelEditor.tsx/
 * MixerEditor.tsx headerActions and CHANNEL_TOOLTIPS.enabled/
 * MIXER_TOOLTIPS.enabled). Both BoolFields live in Collapsible's
 * headerActions, so they're visible without expanding the section --
 * unlike DeviceEditor's type-switch tests, which click to expand first.
 */
function ChannelHarness() {
  const [channel, setChannel] = useState<MultichannelChannel>(defaultChannel());
  return (
    <ChannelEditor
      channel={channel}
      deviceIndex={0}
      channelIndex={0}
      onChange={setChannel}
      onRemove={() => {}}
      onDuplicate={() => {}}
      pathPrefix="$.test"
      channelTargets={[]}
      onCopyOutputToChannel={() => {}}
    />
  );
}

function MixerHarness() {
  const [mixer, setMixer] = useState<Mixer>(defaultMixer());
  return (
    <MixerEditor
      mixer={mixer}
      onChange={setMixer}
      onRemove={() => {}}
      onDuplicate={() => {}}
      pathPrefix="$.test"
      channelTargets={[]}
      onCopyOutputToChannel={() => {}}
    />
  );
}

describe("channel Enabled field", () => {
  it("defaults to checked (enabled is absent, treated as true) and is independent of Disable", async () => {
    const user = userEvent.setup();
    render(<ChannelHarness />);

    const enabledCheckbox = checkboxLabeled("Enabled");
    const disableCheckbox = checkboxLabeled("Disable");
    expect(enabledCheckbox.checked).toBe(true);
    expect(disableCheckbox.checked).toBe(false);

    await user.click(enabledCheckbox);
    expect(enabledCheckbox.checked).toBe(false);
    // Toggling Enabled must never touch Disable, and vice versa.
    expect(disableCheckbox.checked).toBe(false);

    await user.click(disableCheckbox);
    expect(disableCheckbox.checked).toBe(true);
    expect(enabledCheckbox.checked).toBe(false);
  });
});

describe("mixer Enabled field", () => {
  it("defaults to checked and is independent of Disable", async () => {
    const user = userEvent.setup();
    render(<MixerHarness />);

    const enabledCheckbox = checkboxLabeled("Enabled");
    const disableCheckbox = checkboxLabeled("Disable");
    expect(enabledCheckbox.checked).toBe(true);
    expect(disableCheckbox.checked).toBe(false);

    await user.click(enabledCheckbox);
    expect(enabledCheckbox.checked).toBe(false);
    expect(disableCheckbox.checked).toBe(false);
  });
});
