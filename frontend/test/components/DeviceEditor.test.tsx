import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Device } from "@rtl-airband-panel/parser";
import { DeviceEditor } from "../../src/components/DeviceEditor.js";
import { defaultDevice } from "../../src/lib/defaults.js";

/** DeviceEditor is controlled, same as OutputEditor -- see that test file. */
function Harness() {
  const [device, setDevice] = useState<Device>(defaultDevice());
  return (
    <DeviceEditor
      device={device}
      deviceIndex={0}
      onChange={(_key, next) => setDevice(next)}
      onRemove={() => {}}
      onDuplicate={() => {}}
      pathPrefix="$.test"
      channelTargets={[]}
      onCopyOutputToChannel={() => {}}
    />
  );
}

describe("DeviceEditor type-switch value memory", () => {
  it("restores a type-specific field's value when switching back to a previously-visited type", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /Device — rtlsdr/ }));

    const serialInput = screen.getByLabelText(/Serial \(optional/);
    await user.type(serialInput, "00000042");
    expect(serialInput).toHaveValue("00000042");

    // soapysdr has no Serial field -- it uses a device string instead.
    await user.selectOptions(screen.getByLabelText(/^Type/), "soapysdr");
    expect(screen.queryByLabelText(/Serial \(optional/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^Type/), "rtlsdr");
    expect(screen.getByLabelText(/Serial \(optional/)).toHaveValue("00000042");
  });

  it("hides tuner bandwidth for non-rtlsdr types and restores its value when switching back to rtlsdr", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /Device — rtlsdr/ }));

    const bandwidthInput = screen.getByLabelText(/Tuner bandwidth/);
    await user.type(bandwidthInput, "8000000");
    expect(bandwidthInput).toHaveValue(8000000);

    // Neither mirisdr nor soapysdr support device-level tuner bandwidth (rtlsdr-only feature).
    await user.selectOptions(screen.getByLabelText(/^Type/), "mirisdr");
    expect(screen.queryByLabelText(/Tuner bandwidth/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^Type/), "rtlsdr");
    expect(screen.getByLabelText(/Tuner bandwidth/)).toHaveValue(8000000);
  });

  it("restores previously entered channels when switching mode back to multichannel", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /Device — rtlsdr/ }));

    // The default device starts with one multichannel channel at 0 Hz; give it a
    // distinguishing frequency so we can tell it survived the round trip.
    await user.click(screen.getByRole("button", { name: /^Channel 0\.0000 MHz$/ }));
    const freqInput = screen.getByLabelText(/^Frequency \(Hz\)/);
    await user.clear(freqInput);
    await user.type(freqInput, "151160000");
    expect(freqInput).toHaveValue(151160000);

    await user.selectOptions(screen.getByLabelText(/Mode/), "scan");
    expect(screen.queryByText(/Channel 151\.1600 MHz/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Mode/), "multichannel");
    expect(screen.getByText("Channel 151.1600 MHz")).toBeInTheDocument();
  });
});

describe("DeviceEditor reserve_channels field", () => {
  it("accepts a value on a multichannel device, and hides the field in scan mode", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /Device — rtlsdr/ }));

    const reserveInput = screen.getByLabelText(/Reserve channels/);
    await user.type(reserveInput, "4");
    expect(reserveInput).toHaveValue(4);

    await user.selectOptions(screen.getByLabelText(/Mode/), "scan");
    expect(screen.queryByLabelText(/Reserve channels/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Mode/), "multichannel");
    expect(screen.getByLabelText(/Reserve channels/)).toHaveValue(4);
  });
});
