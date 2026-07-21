import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses built-in defaults when nothing is set", () => {
    const config = loadConfig({});
    expect(config.instancesDir).toBe("/etc/rtl-airband-panel/instances");
    expect(config.systemdMode).toBe("mock");
    expect(config.port).toBe(3000);
    expect(config.host).toBe("127.0.0.1");
    expect(config.sudoUnitNamePrefix).toBe("");
  });

  it("RTL_PANEL_SUDO_UNIT_PREFIX sets the sudo-mode unit scoping prefix", () => {
    const config = loadConfig({ RTL_PANEL_SUDO_UNIT_PREFIX: "rtl_" });
    expect(config.sudoUnitNamePrefix).toBe("rtl_");
  });

  it("env vars (standing in for a loaded .env file too, since dotenv just populates process.env) override defaults", () => {
    const config = loadConfig({ RTL_PANEL_PORT: "8080", RTL_PANEL_SYSTEMD_MODE: "sudo" });
    expect(config.port).toBe(8080);
    expect(config.systemdMode).toBe("sudo");
  });

  it("CLI overrides win over env vars", () => {
    const config = loadConfig({ RTL_PANEL_PORT: "8080" }, { port: 9090 });
    expect(config.port).toBe(9090);
  });

  it("a CLI override for one field doesn't clobber env-derived values for other fields", () => {
    const config = loadConfig({ RTL_PANEL_HOST: "0.0.0.0" }, { port: 9090 });
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9090);
  });
});
