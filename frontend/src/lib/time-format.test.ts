import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateTime, formatUptime } from "./time-format.js";

const NOW = new Date("2026-07-31T14:03:11.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatUptime", () => {
  it("returns an em dash for an undefined timestamp", () => {
    expect(formatUptime(undefined)).toBe("—");
  });

  it("returns an em dash for an unparseable timestamp", () => {
    expect(formatUptime("not a date")).toBe("—");
  });

  it("returns an em dash for a timestamp in the future", () => {
    expect(formatUptime(new Date(NOW.getTime() + 60_000).toISOString())).toBe("—");
  });

  it("formats under a minute as <1m", () => {
    expect(formatUptime(new Date(NOW.getTime() - 30_000).toISOString())).toBe("<1m");
  });

  it("formats minutes only", () => {
    expect(formatUptime(new Date(NOW.getTime() - 22 * 60_000).toISOString())).toBe("22m");
  });

  it("formats hours and minutes", () => {
    expect(formatUptime(new Date(NOW.getTime() - (3 * 3600 + 22 * 60) * 1000).toISOString())).toBe("3h 22m");
  });

  it("formats days and hours, dropping minutes", () => {
    expect(formatUptime(new Date(NOW.getTime() - (5 * 86400 + 3600) * 1000).toISOString())).toBe("5d 1h");
  });
});

describe("formatDateTime", () => {
  it("returns 'Never' for an undefined timestamp", () => {
    expect(formatDateTime(undefined)).toBe("Never");
  });

  it("returns 'Never' for an unparseable timestamp", () => {
    expect(formatDateTime("not a date")).toBe("Never");
  });

  it("formats an ISO timestamp as YYYY-MM-DD HH:MM in local time", () => {
    const local = new Date(Date.parse("2026-07-31T14:03:11.000Z"));
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`;
    expect(formatDateTime("2026-07-31T14:03:11.000Z")).toBe(expected);
  });
});
