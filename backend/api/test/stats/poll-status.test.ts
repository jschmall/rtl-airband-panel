import { describe, expect, it } from "vitest";
import { PollStatusTracker } from "../../src/stats/poll-status.js";

describe("PollStatusTracker", () => {
  it("returns an empty status for an instance that's never been recorded", () => {
    const tracker = new PollStatusTracker();
    expect(tracker.get("rtl_x")).toEqual({});
  });

  it("records a success", () => {
    const tracker = new PollStatusTracker();
    tracker.recordSuccess("rtl_x", 1000);
    expect(tracker.get("rtl_x")).toEqual({ lastSuccessMs: 1000 });
  });

  it("records an error, with no prior success", () => {
    const tracker = new PollStatusTracker();
    tracker.recordError("rtl_x", 1000, "boom");
    expect(tracker.get("rtl_x")).toEqual({ lastErrorMs: 1000, lastError: "boom" });
  });

  it("keeps the last known success timestamp across a later error", () => {
    const tracker = new PollStatusTracker();
    tracker.recordSuccess("rtl_x", 1000);
    tracker.recordError("rtl_x", 2000, "boom");
    expect(tracker.get("rtl_x")).toEqual({ lastSuccessMs: 1000, lastErrorMs: 2000, lastError: "boom" });
  });

  it("clears the error state once a poll succeeds again", () => {
    const tracker = new PollStatusTracker();
    tracker.recordError("rtl_x", 1000, "boom");
    tracker.recordSuccess("rtl_x", 2000);
    expect(tracker.get("rtl_x")).toEqual({ lastSuccessMs: 2000 });
  });

  it("tracks each instance independently", () => {
    const tracker = new PollStatusTracker();
    tracker.recordSuccess("rtl_good", 1000);
    tracker.recordError("rtl_bad", 1000, "boom");
    expect(tracker.get("rtl_good")).toEqual({ lastSuccessMs: 1000 });
    expect(tracker.get("rtl_bad")).toEqual({ lastErrorMs: 1000, lastError: "boom" });
  });
});
