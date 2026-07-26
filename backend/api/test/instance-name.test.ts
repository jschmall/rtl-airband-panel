import { describe, expect, it } from "vitest";
import { assertValidInstanceName, InvalidInstanceNameError } from "../src/instance-name.js";

describe("assertValidInstanceName", () => {
  it("accepts a normal name", () => {
    expect(() => assertValidInstanceName("rtl_151719")).not.toThrow();
  });

  it.each(["export", "import", "restart-pending"])("rejects the reserved name '%s' (would be shadowed by a static sibling route)", (name) => {
    expect(() => assertValidInstanceName(name)).toThrow(InvalidInstanceNameError);
  });

  it("rejects names with characters outside the safe slug", () => {
    expect(() => assertValidInstanceName("../etc/passwd")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("")).toThrow(InvalidInstanceNameError);
  });
});
