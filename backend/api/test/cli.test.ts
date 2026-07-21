import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/cli.js";

describe("parseCliArgs", () => {
  it("returns no overrides and help=false for an empty argv", () => {
    expect(parseCliArgs([])).toEqual({ help: false, envFile: undefined, overrides: {} });
  });

  it("maps each flag to the matching config field with correct types", () => {
    const result = parseCliArgs([
      "--instances-dir",
      "/tmp/instances",
      "--unit-dir",
      "/tmp/units",
      "--rtl-airband-bin",
      "/usr/bin/rtl_airband",
      "--systemd-mode",
      "sudo",
      "--sudo-unit-prefix",
      "rtl_",
      "--port",
      "4000",
      "--host",
      "0.0.0.0",
      "--stats-db-path",
      "/tmp/stats.db",
      "--stats-poll-interval-ms",
      "5000",
      "--stats-retention-days",
      "3",
      "--frontend-dist",
      "/tmp/dist",
    ]);
    expect(result.overrides).toEqual({
      instancesDir: "/tmp/instances",
      unitDir: "/tmp/units",
      rtlAirbandBinary: "/usr/bin/rtl_airband",
      systemdMode: "sudo",
      sudoUnitNamePrefix: "rtl_",
      port: 4000,
      host: "0.0.0.0",
      statsDbPath: "/tmp/stats.db",
      statsPollIntervalMs: 5000,
      statsRetentionDays: 3,
      frontendDistPath: "/tmp/dist",
    });
  });

  it("treats any --systemd-mode value other than 'sudo' as mock, matching env var behavior", () => {
    expect(parseCliArgs(["--systemd-mode", "bogus"]).overrides.systemdMode).toBe("mock");
  });

  it("detects --help and its -h short alias", () => {
    expect(parseCliArgs(["--help"]).help).toBe(true);
    expect(parseCliArgs(["-h"]).help).toBe(true);
  });

  it("captures --env-file separately from the config overrides", () => {
    const result = parseCliArgs(["--env-file", "/tmp/.env.custom"]);
    expect(result.envFile).toBe("/tmp/.env.custom");
    expect(result.overrides).toEqual({});
  });

  it("throws on an unrecognized flag", () => {
    expect(() => parseCliArgs(["--bogus-flag", "x"])).toThrow();
  });
});
