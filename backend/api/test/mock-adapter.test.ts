import { describe, expect, it } from "vitest";
import { MockSystemdAdapter } from "../src/systemd/mock-adapter.js";

describe("MockSystemdAdapter.followLogs", () => {
  it("yields the seeded backlog, then live-pushed lines in order, and ends on end()", async () => {
    const adapter = new MockSystemdAdapter();
    const unit = "151719.service";
    adapter.logLines.set(unit, [
      { timestamp: "t1", message: "backlog 1" },
      { timestamp: "t2", message: "backlog 2" },
    ]);

    const controller = new AbortController();
    const collected: string[] = [];
    const iterationDone = (async () => {
      for await (const line of adapter.followLogs(unit, 200, controller.signal)) {
        collected.push(line.message);
      }
    })();

    const stream = await adapter.waitForLogStream(unit);
    stream.push({ timestamp: "t3", message: "live 1" });
    stream.push({ timestamp: "t4", message: "live 2" });
    stream.end();
    await iterationDone;

    expect(collected).toEqual(["backlog 1", "backlog 2", "live 1", "live 2"]);
    expect(stream.killed).toBe(false);
  });

  it("terminates the generator and marks the stream killed when the signal aborts", async () => {
    const adapter = new MockSystemdAdapter();
    const unit = "151719.service";
    const controller = new AbortController();
    const collected: string[] = [];

    const iterationDone = (async () => {
      for await (const line of adapter.followLogs(unit, 200, controller.signal)) {
        collected.push(line.message);
      }
    })();

    const stream = await adapter.waitForLogStream(unit);
    stream.push({ timestamp: "t1", message: "live" });
    controller.abort();
    await iterationDone;

    expect(collected).toEqual(["live"]);
    expect(stream.killed).toBe(true);
  });

  it("records the call with unit and requested line count", async () => {
    const adapter = new MockSystemdAdapter();
    const controller = new AbortController();
    const iterationDone = (async () => {
      for await (const _line of adapter.followLogs("x.service", 50, controller.signal)) {
        // drain nothing, just start the generator
      }
    })();
    // Ensures the generator has actually started (and registered its abort
    // listener) before aborting -- an AbortSignal's "abort" event only fires
    // to listeners registered before abort() is called, so aborting too
    // early here would hang the test instead of exercising the abort path.
    await adapter.waitForLogStream("x.service");
    controller.abort();
    await iterationDone;
    expect(adapter.calls).toContain("follow-logs x.service 50");
  });
});
