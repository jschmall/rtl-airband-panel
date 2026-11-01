import { describe, expect, it } from "vitest";
import type { ErrorLogEvent } from "../api/client.js";
import { mergeEvents, unseenProblems } from "./error-log.js";

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

  it("counts unseen problems, not restart markers", () => {
    const events = [ev(6, "restart", "info"), ev(5, "log", "error"), ev(4, "counter"), ev(3), ev(2)];
    expect(unseenProblems({ events, hasMore: false, seenId: 3, error: null })).toEqual({ count: 2, anyError: true });
    expect(unseenProblems({ events, hasMore: false, seenId: 5, error: null })).toEqual({ count: 0, anyError: false });
    expect(unseenProblems({ events: [ev(9, "unexpected-restart")], hasMore: false, seenId: 0, error: null }).count).toBe(0);
    expect(unseenProblems({ events: null, hasMore: false, seenId: 0, error: null }).count).toBe(0);
  });
});
