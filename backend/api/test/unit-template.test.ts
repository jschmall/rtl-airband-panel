import { describe, expect, it } from "vitest";
import { renderUnitFile } from "../src/unit-template.js";

describe("renderUnitFile", () => {
  it("includes the given description, binary path, and conf path", () => {
    const unit = renderUnitFile({
      description: "RTLSDR-Airband instance: rtl_151719",
      binaryPath: "/usr/local/bin/rtl_airband",
      confPath: "/etc/rtl-panel/instances/rtl_151719.conf",
    });

    expect(unit).toContain("Description=RTLSDR-Airband instance: rtl_151719");
    expect(unit).toContain("ExecStart=/usr/local/bin/rtl_airband -F -e -c /etc/rtl-panel/instances/rtl_151719.conf");
  });

  it("always disables systemd's own restart, since explicit restarts go through the API instead", () => {
    const unit = renderUnitFile({ description: "d", binaryPath: "/bin/true", confPath: "/x.conf" });
    expect(unit).toContain("Restart=no");
  });

  it("is well-formed systemd unit syntax: one value per Key=Value line, correct section headers", () => {
    const unit = renderUnitFile({ description: "d", binaryPath: "/bin/true", confPath: "/x.conf" });
    const lines = unit.trim().split("\n");

    expect(lines[0]).toBe("[Unit]");
    expect(lines).toContain("[Service]");
    expect(lines).toContain("[Install]");
    expect(lines).toContain("Type=simple");
    expect(lines).toContain("WantedBy=multi-user.target");

    // Every non-section, non-blank line must be a single Key=Value pair with no embedded newline weirdness.
    for (const line of lines) {
      if (line.startsWith("[") || line === "") continue;
      expect(line).toMatch(/^[A-Za-z]+=.*$/);
    }
  });

  it("doesn't escape or reject a confPath/binaryPath containing spaces (caller's responsibility, not this template's)", () => {
    const unit = renderUnitFile({ description: "d", binaryPath: "/opt/my bin/rtl_airband", confPath: "/etc/my instances/x.conf" });
    expect(unit).toContain("ExecStart=/opt/my bin/rtl_airband -F -e -c /etc/my instances/x.conf");
  });

  it("omits -j when jsonLogging is unset or false", () => {
    const unset = renderUnitFile({ description: "d", binaryPath: "/bin/true", confPath: "/x.conf" });
    const explicitFalse = renderUnitFile({ description: "d", binaryPath: "/bin/true", confPath: "/x.conf", jsonLogging: false });
    expect(unset).toContain("ExecStart=/bin/true -F -e -c /x.conf");
    expect(explicitFalse).toContain("ExecStart=/bin/true -F -e -c /x.conf");
  });

  it("adds -j to ExecStart when jsonLogging is true", () => {
    const unit = renderUnitFile({ description: "d", binaryPath: "/bin/true", confPath: "/x.conf", jsonLogging: true });
    expect(unit).toContain("ExecStart=/bin/true -F -e -j -c /x.conf");
  });

  it("omits User=/Group= when serviceUser/serviceGroup are unset", () => {
    const unit = renderUnitFile({ description: "d", binaryPath: "/bin/true", confPath: "/x.conf" });
    expect(unit).not.toContain("User=");
    expect(unit).not.toContain("Group=");
  });

  it("adds User=/Group= to the [Service] section when set", () => {
    const unit = renderUnitFile({
      description: "d",
      binaryPath: "/bin/true",
      confPath: "/x.conf",
      serviceUser: "rtl-airband",
      serviceGroup: "rtl-airband",
    });
    const lines = unit.trim().split("\n");
    expect(lines).toContain("User=rtl-airband");
    expect(lines).toContain("Group=rtl-airband");
    expect(lines.indexOf("User=rtl-airband")).toBeGreaterThan(lines.indexOf("[Service]"));
    expect(lines.indexOf("User=rtl-airband")).toBeLessThan(lines.indexOf("ExecStart=/bin/true -F -e -c /x.conf"));
  });

  it("supports setting serviceUser without serviceGroup", () => {
    const unit = renderUnitFile({ description: "d", binaryPath: "/bin/true", confPath: "/x.conf", serviceUser: "rtl-airband" });
    expect(unit).toContain("User=rtl-airband");
    expect(unit).not.toContain("Group=");
  });
});
