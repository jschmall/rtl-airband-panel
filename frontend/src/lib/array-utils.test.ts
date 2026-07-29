import { describe, expect, it } from "vitest";
import { moveAt } from "./array-utils.js";

describe("moveAt", () => {
  it("moves an item forward, shifting the ones in between back", () => {
    expect(moveAt([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  });

  it("moves an item backward, shifting the ones in between forward", () => {
    expect(moveAt([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3]);
  });

  it("is a no-op when from === to", () => {
    expect(moveAt([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
  });

  it("is a no-op when either index is out of range", () => {
    expect(moveAt([1, 2, 3], 1, 5)).toEqual([1, 2, 3]);
    expect(moveAt([1, 2, 3], -1, 1)).toEqual([1, 2, 3]);
  });

  it("does not mutate the original array", () => {
    const original = [1, 2, 3];
    moveAt(original, 0, 2);
    expect(original).toEqual([1, 2, 3]);
  });
});
