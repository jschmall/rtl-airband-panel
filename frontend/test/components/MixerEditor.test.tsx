import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mixer } from "@rtl-airband-panel/parser";
import { MixerEditor } from "../../src/components/MixerEditor.js";
import { defaultMixer } from "../../src/lib/defaults.js";

/** MixerEditor is controlled, same as DeviceEditor -- see that test file. */
function Harness() {
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

describe("MixerEditor reserve_inputs field", () => {
  it("accepts a value and reflects it back", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /Mixer — \(unnamed\)/ }));

    const reserveInput = screen.getByLabelText(/Reserve inputs/);
    await user.type(reserveInput, "2");
    expect(reserveInput).toHaveValue(2);
  });
});
