import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RtlAirbandConfig } from "../../src/types/config.js";
import { ConfigEditor } from "../../src/components/ConfigEditor.js";
import { defaultConfig, defaultDevice } from "../../src/lib/defaults.js";

beforeAll(() => {
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

function Harness({ jumpPath }: { jumpPath: string }) {
  const [config, setConfig] = useState<RtlAirbandConfig>({ ...defaultConfig(), devices: [defaultDevice()] });
  const [jump, setJump] = useState<{ path: string; nonce: number } | null>(null);
  return (
    <>
      <button type="button" onClick={() => setJump({ path: jumpPath, nonce: Date.now() })}>
        jump
      </button>
      <ConfigEditor config={config} onChange={setConfig} jumpTarget={jump} before={<p>before slot</p>} after={<p>after slot</p>} />
    </>
  );
}

describe("ConfigEditor sections", () => {
  it("renders the slots around instance settings, devices and mixers, in that order", () => {
    render(<Harness jumpPath="$.fft_size" />);
    const order = ["before slot", "Instance settings", "Devices (1)", "Mixers (0)", "after slot"].map((t) => screen.getByText(t));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("opens a collapsed Devices group and the device a jump points into", async () => {
    const user = userEvent.setup();
    render(<Harness jumpPath="$.devices[0].correction" />);
    await user.click(screen.getByRole("button", { name: /^Devices/ }));
    expect(screen.queryByRole("button", { name: /Device — rtlsdr/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "jump" }));
    expect(screen.getByRole("button", { name: /^Devices/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Device — rtlsdr/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens collapsed instance settings for a top-level setting", async () => {
    const user = userEvent.setup();
    render(<Harness jumpPath="$.fft_size" />);
    await user.click(screen.getByRole("button", { name: /^Instance settings/ }));
    expect(screen.queryByLabelText(/^FFT size/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "jump" }));
    expect(screen.getByLabelText(/^FFT size/)).toBeInTheDocument();
  });
});
