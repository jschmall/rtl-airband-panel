import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceSummary, InstanceSummary } from "../api/client.js";
import { loadInstanceSort, saveInstanceSort, sortInstances } from "./instance-sort.js";

const inst = (name: string, ...devices: DeviceSummary[]) => ({ name, devices }) as InstanceSummary;

const LIST = [
  inst("rtl_10", { serial: "9", centerFreqHz: 151e6 }),
  inst("scan", { serial: "02" }),
  inst("Rtl_9", { serial: "10", centerFreqHz: 42e6 }),
  inst("bare"),
  inst("noserial", { centerFreqHz: 151e6 }),
  // Sorts by the SDR the list shows, its first.
  inst("two", { serial: "30", centerFreqHz: 462e6 }, { serial: "1", centerFreqHz: 1e6 }),
];
const names = (sort: Parameters<typeof sortInstances>[1]) => sortInstances(LIST, sort).map((i) => i.name);

describe("instance sort", () => {
  beforeEach(() => localStorage.clear());

  it("sorts by name, numbers in order", () => {
    expect(names("name")).toEqual(["bare", "noserial", "Rtl_9", "rtl_10", "scan", "two"]);
  });

  it("sorts by serial, numbers in order, none last", () => {
    expect(names("serial")).toEqual(["scan", "rtl_10", "Rtl_9", "two", "bare", "noserial"]);
  });

  it("sorts by center frequency, ties by name, none last", () => {
    expect(names("center")).toEqual(["Rtl_9", "noserial", "rtl_10", "two", "bare", "scan"]);
  });

  it("doesn't reorder the list it's given, and copes with an older backend", () => {
    const before = LIST.map((i) => i.name);
    names("serial");
    expect(LIST.map((i) => i.name)).toEqual(before);
    const old = [{ name: "b" }, { name: "a" }] as InstanceSummary[];
    expect(sortInstances(old, "center").map((i) => i.name)).toEqual(["a", "b"]);
  });

  it("remembers the choice, falling back to name", () => {
    expect(loadInstanceSort()).toBe("name");
    saveInstanceSort("center");
    expect(loadInstanceSort()).toBe("center");
    localStorage.setItem("rtl-panel:instance-sort", "bogus");
    expect(loadInstanceSort()).toBe("name");
    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(loadInstanceSort()).toBe("name");
    blocked.mockRestore();
  });
});
