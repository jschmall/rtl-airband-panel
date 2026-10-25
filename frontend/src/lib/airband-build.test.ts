import { describe, expect, it } from "vitest";
import type { AirbandBuild } from "../api/client.js";
import { buildLabel, hasFeature } from "./airband-build.js";

const build = (overrides: Partial<AirbandBuild>): AirbandBuild => ({
  kind: "fork",
  version: "v6.5.0",
  features: ["fork", "control_socket"],
  binary: "/usr/local/bin/rtl_airband",
  basis: "features-line",
  ...overrides,
});

describe("hasFeature", () => {
  it("follows the fork's feature list", () => {
    expect(hasFeature(build({}), "control_socket")).toBe(true);
    expect(hasFeature(build({}), "rdio_scanner")).toBe(false);
  });

  it("locks fork features on a stock build", () => {
    expect(hasFeature(build({ kind: "stock", features: [] }), "control_socket")).toBe(false);
  });

  it("locks nothing while loading or when the build is unknown", () => {
    expect(hasFeature(null, "control_socket")).toBe(true);
    expect(hasFeature(build({ kind: "unknown", features: [] }), "control_socket")).toBe(true);
  });
});

describe("buildLabel", () => {
  it("names the version and kind", () => {
    expect(buildLabel(build({}))).toBe("rtl_airband v6.5.0 (fork)");
    expect(buildLabel(build({ kind: "stock", version: "v6.2.0" }))).toBe("rtl_airband v6.2.0 (stock)");
    expect(buildLabel(build({ kind: "unknown", version: null }))).toBe("rtl_airband");
  });
});
