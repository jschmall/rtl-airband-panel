import { describe, expect, it } from "vitest";
import {
  SudoSystemctlAdapter,
  UnitOutOfScopeError,
  InvalidUnitNamePrefixError,
  buildScopedUnitPattern,
} from "../src/systemd/sudo-adapter.js";

describe("buildScopedUnitPattern", () => {
  it("with no prefix, matches any unit in the existing safe-name charset", () => {
    const pattern = buildScopedUnitPattern("");
    expect(pattern.test("rtl_100000.service")).toBe(true);
    expect(pattern.test("office-scanner.service")).toBe(true);
    expect(pattern.test("151780.service")).toBe(true);
    expect(pattern.test("sshd.service")).toBe(true); // no scoping configured -- nothing to distinguish it
  });

  it("with a prefix, only matches units starting with it", () => {
    const pattern = buildScopedUnitPattern("rtl_");
    expect(pattern.test("rtl_100000.service")).toBe(true);
    expect(pattern.test("sshd.service")).toBe(false);
    expect(pattern.test("office-scanner.service")).toBe(false);
    expect(pattern.test("rtl_.service")).toBe(false); // nothing after the prefix
  });

  it("rejects a prefix containing characters outside the safe-name charset", () => {
    expect(() => buildScopedUnitPattern("rtl.")).toThrow(InvalidUnitNamePrefixError);
    expect(() => buildScopedUnitPattern("rtl*")).toThrow(InvalidUnitNamePrefixError);
    expect(() => buildScopedUnitPattern("../")).toThrow(InvalidUnitNamePrefixError);
  });
});

// These only exercise the in-process scoping guard, not real systemctl calls
// (see README's "Testing" section: sudo mode isn't covered by real systemd
// interaction in the test suite). A rejected unit throws before any command
// is spawned, so no sudo/systemctl binary needs to be present to run these.
describe("SudoSystemctlAdapter unit scoping", () => {
  it("with a configured prefix, rejects out-of-scope units across every unit-taking method", async () => {
    const adapter = new SudoSystemctlAdapter("/etc/systemd/system", "rtl_");
    const unit = "sshd.service";

    await expect(adapter.restart(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.start(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.stop(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.enable(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.disable(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.status(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.installUnitFile(unit, "contents")).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.removeUnitFile(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
  });

  it("constructing with an invalid prefix fails fast instead of silently misscoping", () => {
    expect(() => new SudoSystemctlAdapter("/etc/systemd/system", "rtl*")).toThrow(InvalidUnitNamePrefixError);
  });
});
