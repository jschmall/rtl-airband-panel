import { describe, expect, it } from "vitest";
import {
  assertValidInstanceName,
  confFilePath,
  instanceNameFromConfFilename,
  InvalidInstanceNameError,
  unitFileName,
  unitFilePath,
} from "../src/instance-name.js";

describe("assertValidInstanceName", () => {
  it("accepts a normal name", () => {
    expect(() => assertValidInstanceName("rtl_151719")).not.toThrow();
  });

  it("accepts names using every allowed character class", () => {
    expect(() => assertValidInstanceName("Az09_-")).not.toThrow();
  });

  it("accepts a name at exactly the 64-character limit", () => {
    expect(() => assertValidInstanceName("a".repeat(64))).not.toThrow();
  });

  it("rejects a name over the 64-character limit", () => {
    expect(() => assertValidInstanceName("a".repeat(65))).toThrow(InvalidInstanceNameError);
  });

  it("rejects an empty name", () => {
    expect(() => assertValidInstanceName("")).toThrow(InvalidInstanceNameError);
  });

  it("rejects path traversal via '..'", () => {
    expect(() => assertValidInstanceName("..")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("../etc/passwd")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("..%2F..%2Fetc%2Fpasswd")).toThrow(InvalidInstanceNameError);
  });

  it("rejects an embedded path separator", () => {
    expect(() => assertValidInstanceName("foo/bar")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("foo\\bar")).toThrow(InvalidInstanceNameError);
  });

  it("rejects a name that's just a dot or absolute-path-looking", () => {
    expect(() => assertValidInstanceName(".")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("/etc/passwd")).toThrow(InvalidInstanceNameError);
  });

  it("rejects shell-metacharacter-bearing names (never reach a shell, but reject anyway)", () => {
    expect(() => assertValidInstanceName("foo; rm -rf /")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("foo$(whoami)")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("foo`whoami`")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("foo && whoami")).toThrow(InvalidInstanceNameError);
  });

  it("rejects unicode/non-ASCII names", () => {
    expect(() => assertValidInstanceName("rtl_日本語")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("café")).toThrow(InvalidInstanceNameError);
  });

  it("rejects a name with embedded whitespace or a null byte", () => {
    expect(() => assertValidInstanceName("rtl 151719")).toThrow(InvalidInstanceNameError);
    expect(() => assertValidInstanceName("rtl\x00151719")).toThrow(InvalidInstanceNameError);
  });

  it.each(["export", "import", "restart-pending"])("rejects the reserved name '%s' (would be shadowed by a static sibling route)", (name) => {
    expect(() => assertValidInstanceName(name)).toThrow(InvalidInstanceNameError);
  });

  it("reserved-name rejection is exact, not a prefix/substring match", () => {
    expect(() => assertValidInstanceName("export_1")).not.toThrow();
    expect(() => assertValidInstanceName("my-import")).not.toThrow();
  });
});

describe("instanceNameFromConfFilename", () => {
  it("extracts the name from a well-formed .conf filename", () => {
    expect(instanceNameFromConfFilename("rtl_151719.conf")).toBe("rtl_151719");
  });

  it("returns undefined for a file not ending in .conf", () => {
    expect(instanceNameFromConfFilename("rtl_151719.txt")).toBeUndefined();
    expect(instanceNameFromConfFilename(".pending-restarts.json")).toBeUndefined();
    expect(instanceNameFromConfFilename("rtl_151719.conf.tmp-123-456")).toBeUndefined();
  });

  it("returns undefined for a .backups directory entry", () => {
    expect(instanceNameFromConfFilename(".backups")).toBeUndefined();
  });

  it("returns undefined when the part before .conf isn't a safe name", () => {
    expect(instanceNameFromConfFilename("../etc/passwd.conf")).toBeUndefined();
    expect(instanceNameFromConfFilename(".conf")).toBeUndefined(); // empty name before the extension
  });

  it("round-trips with confFilePath/unitFileName's naming convention", () => {
    const name = "rtl_151719";
    expect(instanceNameFromConfFilename(`${name}.conf`)).toBe(name);
  });
});

describe("confFilePath", () => {
  it("joins the instances dir and name into a .conf path", () => {
    expect(confFilePath("/etc/rtl-panel/instances", "rtl_x")).toBe("/etc/rtl-panel/instances/rtl_x.conf");
  });

  it("throws (doesn't silently sanitize) for an invalid name, so a bad name can never reach the filesystem", () => {
    expect(() => confFilePath("/etc/rtl-panel/instances", "../../etc/passwd")).toThrow(InvalidInstanceNameError);
  });
});

describe("unitFileName / unitFilePath", () => {
  it("appends .service to the name", () => {
    expect(unitFileName("rtl_x")).toBe("rtl_x.service");
  });

  it("joins the unit dir and unit filename", () => {
    expect(unitFilePath("/etc/systemd/system", "rtl_x")).toBe("/etc/systemd/system/rtl_x.service");
  });

  it("throws for an invalid name in both functions", () => {
    expect(() => unitFileName("../evil")).toThrow(InvalidInstanceNameError);
    expect(() => unitFilePath("/etc/systemd/system", "../evil")).toThrow(InvalidInstanceNameError);
  });
});
