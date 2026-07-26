import { describe, expect, it } from "vitest";
import { gracefulShutdown } from "../src/shutdown.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("gracefulShutdown", () => {
  it("stops the poller, closes the stats DB, closes the app, then exits -- in that order", async () => {
    const order: string[] = [];
    const poller = {
      stop: async () => {
        order.push("poller.stop");
      },
    };
    const statsStore = {
      close: () => {
        order.push("statsStore.close");
      },
    };
    const app = {
      close: async () => {
        order.push("app.close");
      },
    };
    const exit = (code: number) => order.push(`exit(${code})`);

    await gracefulShutdown({ poller, statsStore, app, exit });

    expect(order).toEqual(["poller.stop", "statsStore.close", "app.close", "exit(0)"]);
  });

  it("waits for a slow poller.stop() (an in-flight poll cycle) before closing the stats DB", async () => {
    const order: string[] = [];
    const pollerStopGate = deferred<void>();

    const poller = {
      stop: async () => {
        order.push("poller.stop-called");
        await pollerStopGate.promise;
        order.push("poller.stop-resolved");
      },
    };
    const statsStore = {
      close: () => {
        order.push("statsStore.close");
      },
    };
    const app = { close: async () => order.push("app.close") };
    const exit = (code: number) => order.push(`exit(${code})`);

    const shutdown = gracefulShutdown({ poller, statsStore, app, exit });

    // statsStore.close() must not have run yet -- poller.stop() hasn't resolved.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["poller.stop-called"]);

    pollerStopGate.resolve();
    await shutdown;
    expect(order).toEqual(["poller.stop-called", "poller.stop-resolved", "statsStore.close", "app.close", "exit(0)"]);
  });

  it("exits 0 even if app.close() takes a moment, only after it resolves", async () => {
    const order: string[] = [];
    const appCloseGate = deferred<void>();
    const poller = { stop: async () => order.push("poller.stop") };
    const statsStore = { close: () => order.push("statsStore.close") };
    const app = {
      close: async () => {
        order.push("app.close-called");
        await appCloseGate.promise;
        order.push("app.close-resolved");
      },
    };
    const exit = (code: number) => order.push(`exit(${code})`);

    const shutdown = gracefulShutdown({ poller, statsStore, app, exit });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).not.toContain("exit(0)");

    appCloseGate.resolve();
    await shutdown;
    expect(order[order.length - 1]).toBe("exit(0)");
  });
});
