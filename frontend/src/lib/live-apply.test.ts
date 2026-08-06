import { describe, expect, it } from "vitest";
import { classifySkippedRequiresRestart } from "./live-apply.js";

describe("classifySkippedRequiresRestart", () => {
  it("returns everything empty for an empty list", () => {
    expect(classifySkippedRequiresRestart([])).toEqual({ needsRestart: [], retryable: [] });
  });

  it("treats a plain restart-required message as needsRestart", () => {
    const items = ["dev0: centerfreq changed but retune request was rejected"];
    expect(classifySkippedRequiresRestart(items)).toEqual({ needsRestart: items, retryable: [] });
  });

  it("treats a transient-failure message as retryable", () => {
    const items = [
      "dev0: centerfreq change failed (transient hardware error, device still on its previous centerfreq, see logs) - no restart needed, retry reload_diff",
    ];
    expect(classifySkippedRequiresRestart(items)).toEqual({ needsRestart: [], retryable: items });
  });

  it("splits a mix of both kinds", () => {
    const restart = "dev1: sample_rate changed";
    const retry = "dev0: centerfreq change failed (transient hardware error) - no restart needed, retry reload_diff";
    expect(classifySkippedRequiresRestart([restart, retry])).toEqual({
      needsRestart: [restart],
      retryable: [retry],
    });
  });
});
