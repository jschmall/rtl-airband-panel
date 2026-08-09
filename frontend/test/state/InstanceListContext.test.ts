import { describe, expect, it } from "vitest";
import { sameInstanceList } from "../../src/state/InstanceListContext.js";
import type { InstanceSummary } from "../../src/api/client.js";

function summary(overrides: Partial<InstanceSummary> = {}): InstanceSummary {
  return {
    name: "rtl_x",
    confPath: "/etc/rtl-airband-panel/instances/rtl_x.conf",
    unit: "rtl_x.service",
    pendingRestart: false,
    jsonLogging: false,
    status: { unit: "rtl_x.service", activeState: "active", subState: "running" },
    searchFields: ["nfm", "151.160"],
    ...overrides,
  };
}

describe("sameInstanceList", () => {
  it("treats null against a fresh list as different (first load)", () => {
    expect(sameInstanceList(null, [summary()])).toBe(false);
  });

  it("treats two lists with identical content as the same, even as distinct array/object instances", () => {
    const a = [summary()];
    const b = [summary()];
    expect(a).not.toBe(b);
    expect(sameInstanceList(a, b)).toBe(true);
  });

  it("detects a changed field on one instance (e.g. a status transition)", () => {
    const a = [summary({ status: { unit: "rtl_x.service", activeState: "active", subState: "running" } })];
    const b = [summary({ status: { unit: "rtl_x.service", activeState: "failed", subState: "failed" } })];
    expect(sameInstanceList(a, b)).toBe(false);
  });

  it("detects an added or removed instance", () => {
    const a = [summary({ name: "rtl_x" })];
    const b = [summary({ name: "rtl_x" }), summary({ name: "rtl_y" })];
    expect(sameInstanceList(a, b)).toBe(false);
  });

  it("treats two empty lists as the same", () => {
    expect(sameInstanceList([], [])).toBe(true);
  });
});
