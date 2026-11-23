import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigEditor } from "./ConfigEditor.js";
import type { RtlAirbandConfig } from "../types/config.js";

const base: RtlAirbandConfig = {
  multiple_demod_threads: true,
  multiple_output_threads: true,
  stats_filepath: "/tmp/stats.txt",
  localtime: true,
  devices: [],
};

function renderSelect(config: RtlAirbandConfig) {
  const onChange = vi.fn();
  render(<ConfigEditor config={config} onChange={onChange} />);
  return { onChange, select: screen.getByLabelText<HTMLSelectElement>(/^FM demodulator/) };
}

const shown = (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent;

describe("FM demodulator select", () => {
  it("shows the default when the key is absent and sets a chosen value", async () => {
    const { onChange, select } = renderSelect(base);
    expect(shown(select)).toBe("(default: fast_atan2)");
    expect([...select.options].map((o) => o.textContent)).toEqual(["(default: fast_atan2)", "fast_atan2", "atan2", "quadri"]);
    await userEvent.selectOptions(select, "atan2");
    expect(onChange).toHaveBeenCalledWith({ ...base, fm_demod: "atan2" });
  });

  it("drops the key when set back to the default", async () => {
    const { onChange, select } = renderSelect({ ...base, fm_demod: "atan2" });
    expect(shown(select)).toBe("atan2");
    await userEvent.selectOptions(select, "(default: fast_atan2)");
    expect(JSON.parse(JSON.stringify(onChange.mock.calls[0]?.[0]))).toEqual(base);
  });

  it.each(["ATAN2", "", "default"])("keeps showing the invalid value %j", (value) => {
    const { select } = renderSelect({ ...base, fm_demod: value });
    expect(shown(select)).toBe(`"${value}" (invalid)`);
  });
});
