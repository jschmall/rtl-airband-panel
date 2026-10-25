import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AirbandBuild, ApplyLiveResult, InstanceSummary, LiveApplyOutcome } from "../../src/api/client.js";
import type { RtlAirbandConfig } from "../../src/types/config.js";
import { defaultConfig } from "../../src/lib/defaults.js";
import { InstanceEditPage } from "../../src/pages/InstanceEditPage.js";
import { renderPage } from "./harness.js";

const api = vi.hoisted(() => ({
  listInstances: vi.fn(),
  getConfig: vi.fn(),
  getAirband: vi.fn(),
  planChange: vi.fn(),
  applyConfigLive: vi.fn(),
}));

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return { ...actual, api };
});

const NAME = "tower";

function summary(): InstanceSummary {
  return {
    name: NAME,
    confPath: `/etc/rtl-airband-panel/instances/${NAME}.conf`,
    unit: `${NAME}.service`,
    pendingRestart: false,
    jsonLogging: false,
    status: { unit: `${NAME}.service`, activeState: "active", subState: "running" },
    searchFields: [],
  };
}

const FORK: AirbandBuild = { kind: "fork", version: "v6.5.0", features: ["control_socket"], binary: "/usr/local/bin/rtl_airband", basis: "features-line" };
const STOCK: AirbandBuild = { kind: "stock", version: "v5.1.1", features: [], binary: "/usr/local/bin/rtl_airband", basis: "stock-release" };

function setup({ controlSocket = true, build = FORK }: { controlSocket?: boolean; build?: AirbandBuild } = {}) {
  const config: RtlAirbandConfig = { ...defaultConfig(), stats_filepath: "/tmp/stats.txt" };
  if (controlSocket) config.control_socket_path = "/run/rtl-airband/tower.sock";
  api.listInstances.mockResolvedValue([summary()]);
  api.getConfig.mockResolvedValue({ config, version: "v1" });
  api.getAirband.mockResolvedValue(build);
  api.planChange.mockResolvedValue(null);
  renderPage("/instances/:name", `/instances/${NAME}`, <InstanceEditPage />);
}

function applyResult(liveApply: LiveApplyOutcome): ApplyLiveResult {
  return { warnings: [], status: summary().status, version: "v2", liveApply };
}

async function clickApplyLive() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Apply live" }));
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("InstanceEditPage Apply live button", () => {
  it("is offered when the saved config has a control socket and the build supports one", async () => {
    setup();
    expect(await screen.findByRole("button", { name: "Apply live" })).toBeInTheDocument();
  });

  it("is hidden without control_socket_path", async () => {
    setup({ controlSocket: false });
    await screen.findByRole("button", { name: "Save and restart" });
    expect(screen.queryByRole("button", { name: "Apply live" })).not.toBeInTheDocument();
  });

  it("is hidden on a stock rtl_airband, which has no control socket", async () => {
    setup({ build: STOCK });
    await screen.findAllByText(/stock/);
    expect(screen.queryByRole("button", { name: "Apply live" })).not.toBeInTheDocument();
  });

  it("asks first, and does nothing if the user cancels", async () => {
    setup();
    vi.mocked(window.confirm).mockReturnValue(false);
    await clickApplyLive();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/^Apply changes to 'tower' live\?.*always require a restart/));
    expect(api.applyConfigLive).not.toHaveBeenCalled();
  });
});

describe("InstanceEditPage Apply live result", () => {
  it("reports a fully applied change", async () => {
    setup();
    api.applyConfigLive.mockResolvedValue(applyResult({ attempted: true, applied: ["device[0]: gain -> 33"], skippedRequiresRestart: [] }));
    await clickApplyLive();
    expect(await screen.findByText(`Applied live to ${NAME}.service — nothing left pending.`)).toBeInTheDocument();
    expect(api.applyConfigLive).toHaveBeenCalledWith(NAME, expect.objectContaining({ control_socket_path: expect.any(String) }), { ifMatch: "v1" });
  });

  it("lists what was applied and what still needs a restart", async () => {
    setup();
    api.applyConfigLive.mockResolvedValue(
      applyResult({ attempted: true, applied: ["device[0]: gain -> 33"], skippedRequiresRestart: ["device count changed (1 -> 2)"] })
    );
    await clickApplyLive();
    expect(await screen.findByText(`Applied 1 change live to ${NAME}.service.`)).toBeInTheDocument();
    expect(screen.getByText("1 still needs a restart:")).toBeInTheDocument();
    expect(screen.getByText("device count changed (1 -> 2)")).toBeInTheDocument();
    expect(screen.getByText("device[0]: gain -> 33")).toBeInTheDocument();
  });

  it.each([
    ["unreachable", "connect: connection refused"],
    ["protocol-error", "unexpected reply"],
  ] as const)("explains a %s reply", async (reason, detail) => {
    setup();
    api.applyConfigLive.mockResolvedValue(applyResult({ attempted: false, reason, detail }));
    await clickApplyLive();
    expect(await screen.findByText(`Couldn't apply live (${detail}). The config was saved to disk`, { exact: false })).toBeInTheDocument();
  });
});
