import { describe, expect, it } from "vitest";
import { SudoSystemctlAdapter, UnitOutOfScopeError, assertScopedUnit } from "../src/systemd/sudo-adapter.js";

describe("assertScopedUnit", () => {
  const outOfScopeUnits = [
    "sshd.service",
    "rtl_100000.timer",
    "rtl_.service",
    "airband.service",
    "../rtl_100000.service",
    "rtl_100000.service; rm -rf /",
  ];

  for (const unit of outOfScopeUnits) {
    it(`rejects ${JSON.stringify(unit)}`, () => {
      expect(() => assertScopedUnit(unit)).toThrow(UnitOutOfScopeError);
    });
  }

  it("accepts units in the rtl_<name>.service namespace", () => {
    for (const unit of ["rtl_100000.service", "rtl_151780.service", "rtl_my-instance_2.service"]) {
      expect(() => assertScopedUnit(unit)).not.toThrow();
    }
  });
});

// These only exercise the in-process scoping guard, not real systemctl calls
// (see README's "Testing" section: sudo mode isn't covered by real systemd
// interaction in the test suite). A rejected unit throws before any command
// is spawned, so no sudo/systemctl binary needs to be present to run these.
describe("SudoSystemctlAdapter unit scoping", () => {
  const adapter = new SudoSystemctlAdapter();
  const unit = "sshd.service";

  it("rejects out-of-scope units across every unit-taking method", async () => {
    await expect(adapter.restart(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.start(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.stop(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.enable(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.disable(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.status(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.installUnitFile(unit, "contents")).rejects.toBeInstanceOf(UnitOutOfScopeError);
    await expect(adapter.removeUnitFile(unit)).rejects.toBeInstanceOf(UnitOutOfScopeError);
  });
});
