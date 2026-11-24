import { describe, expect, it } from "vitest";
import type { ErrorLogEvent } from "../api/client.js";
import { errorLog, mergeEvents, unacknowledgedProblems } from "./error-log.js";

const ev = (id: number, kind = "log", severity: ErrorLogEvent["severity"] = "warning"): ErrorLogEvent => ({
  id,
  instance: "a",
  ts: id * 1000,
  kind,
  severity,
  message: `#${id}`,
});

describe("error log", () => {
  it("merges newest first without duplicates", () => {
    expect(mergeEvents([ev(3), ev(1)], [ev(2), ev(3), ev(4)]).map((e) => e.id)).toEqual([4, 3, 2, 1]);
  });

  it("counts unacknowledged problems, not restart markers, whatever this browser has seen", () => {
    const at = (ackId: number, events: ErrorLogEvent[] | null) =>
      unacknowledgedProblems({ events, hasMore: false, seenId: 99, ackId, error: null });
    const events = [ev(6, "restart", "info"), ev(5, "log", "error"), ev(4, "counter"), ev(3), ev(2)];
    expect(at(3, events)).toEqual({ count: 2, anyError: true });
    expect(at(5, events)).toEqual({ count: 0, anyError: false });
    expect(at(0, [ev(9, "unexpected-restart")]).count).toBe(0);
    expect(at(0, null).count).toBe(0);
  });

  it("never moves the acknowledgement back", () => {
    errorLog.setAcknowledged(7);
    errorLog.setAcknowledged(4);
    expect(errorLog.get().ackId).toBe(7);
  });
});
