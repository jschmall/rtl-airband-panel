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
});
