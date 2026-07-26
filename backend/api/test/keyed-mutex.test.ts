import { describe, expect, it } from "vitest";
import { KeyedMutex } from "../src/keyed-mutex.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("KeyedMutex", () => {
  it("serializes two operations on the same key, in call order", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    const first = deferred<void>();

    const a = mutex.run("x", async () => {
      order.push("a-start");
      await first.promise;
      order.push("a-end");
    });
    const b = mutex.run("x", async () => {
      order.push("b-start");
      order.push("b-end");
    });

    // b must not have started yet -- a is still awaiting `first`.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["a-start"]);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("runs operations on different keys fully concurrently", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    const blockA = deferred<void>();

    const a = mutex.run("a", async () => {
      order.push("a-start");
      await blockA.promise;
      order.push("a-end");
    });
    const b = mutex.run("b", async () => {
      order.push("b-start");
      order.push("b-end");
    });

    await b; // b (a different key) completes without waiting for a
    expect(order).toEqual(["a-start", "b-start", "b-end"]);

    blockA.resolve();
    await a;
    expect(order).toEqual(["a-start", "b-start", "b-end", "a-end"]);
  });

  it("returns each operation's own result, not some shared value", async () => {
    const mutex = new KeyedMutex();
    const results = await Promise.all([mutex.run("x", async () => 1), mutex.run("x", async () => 2), mutex.run("x", async () => 3)]);
    expect(results).toEqual([1, 2, 3]);
  });

  it("propagates one operation's rejection to its own caller only, without blocking the next queued operation", async () => {
    const mutex = new KeyedMutex();
    const a = mutex.run("x", async () => {
      throw new Error("boom");
    });
    const b = mutex.run("x", async () => "still runs");

    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe("still runs");
  });

  it("lets a later run() for a key that has since gone idle start immediately (no lingering queue)", async () => {
    const mutex = new KeyedMutex();
    await mutex.run("x", async () => undefined);

    const order: string[] = [];
    await mutex.run("x", async () => {
      order.push("ran");
    });
    expect(order).toEqual(["ran"]);
  });
});
