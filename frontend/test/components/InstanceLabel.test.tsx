import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { formatCenterMHz, InstanceLabel, instanceDescription } from "../../src/components/layout/InstanceLabel.js";
import type { DeviceSummary } from "../../src/api/client.js";

// Which parts fit is layout, checked in a browser; this covers what's there to fit.
const text = (devices: DeviceSummary[]) => render(<InstanceLabel name="rtl_151" devices={devices} />).container.textContent;

describe("InstanceLabel", () => {
  it("is name - serial - center frequency", () => {
    expect(text([{ serial: "11", centerFreqHz: 151_752_500 }])).toBe("rtl_151 - 11 - 151.7525");
  });

  it("leaves out what the config doesn't have", () => {
    expect(text([])).toBe("rtl_151");
    expect(text([{ serial: "11" }])).toBe("rtl_151 - 11");
    expect(text([{ centerFreqHz: 42_430_000 }])).toBe("rtl_151 - 42.430");
    expect(text([{}])).toBe("rtl_151");
  });

  it("shows the first of several SDRs and how many more", () => {
    expect(text([{ serial: "11", centerFreqHz: 151e6 }, { serial: "12" }])).toBe("rtl_151 - 11 +1 - 151.000");
    expect(text([{}, {}, {}])).toBe("rtl_151 - +2");
  });

  it("formats and describes", () => {
    expect([42_430_000, 151_752_500, 169_618_750].map(formatCenterMHz)).toEqual(["42.430", "151.7525", "169.6188"]);
    expect(instanceDescription("a", [{ serial: "1", centerFreqHz: 42_430_000 }, { serial: "2" }, {}])).toBe("a\nSN 1, center 42.430 MHz\nSN 2");
  });
});
