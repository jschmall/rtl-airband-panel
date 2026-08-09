import { describe, expect, it } from "vitest";
import { tokenize } from "../src/tokenizer.js";

// Targeted at the switch from source.slice(i) + non-sticky regex to a sticky
// (`y`-flag) regex with a manually managed lastIndex -- that kind of change
// is easy to get subtly wrong at boundaries (end of string, no separating
// whitespace), so these exercise exactly those spots rather than relying
// only on the fixture-based round-trip tests to catch it indirectly.

function raws(source: string): string[] {
  return tokenize(source)
    .filter((t) => t.type !== "eof")
    .map((t) => t.raw);
}

describe("tokenize numbers", () => {
  it("reads a plain integer at end of string with nothing following it", () => {
    expect(raws("42")).toEqual(["42"]);
  });

  it("reads a decimal immediately followed by punctuation with no whitespace", () => {
    expect(raws("freq=100.5;")).toEqual(["freq", "=", "100.5", ";"]);
  });

  it("reads adjacent numeric tokens separated only by punctuation", () => {
    expect(raws("[1,2,3]")).toEqual(["[", "1", ",", "2", ",", "3", "]"]);
  });

  it("reads a negative exponent number at end of string", () => {
    expect(raws("-1.5e-10")).toEqual(["-1.5e-10"]);
  });

  it("reads a hex literal at end of string", () => {
    expect(raws("0xFF")).toEqual(["0xFF"]);
  });

  it("reads an L-suffixed long literal followed immediately by a semicolon", () => {
    expect(raws("100L;")).toEqual(["100L", ";"]);
  });
});

describe("tokenize identifiers", () => {
  it("reads a bare identifier at end of string with nothing following it", () => {
    expect(raws("devices")).toEqual(["devices"]);
  });

  it("reads an identifier immediately followed by punctuation with no whitespace", () => {
    expect(raws("devices:(true)")).toEqual(["devices", ":", "(", "true", ")"]);
  });

  it("reads consecutive identifiers separated only by whitespace", () => {
    expect(raws("true false TRUE FALSE")).toEqual(["true", "false", "TRUE", "FALSE"]);
  });
});

describe("tokenize whole-file consistency", () => {
  it("produces the same tokens whether or not other tokens precede a given one in the file", () => {
    // Regression guard for a slice-based implementation subtly depending on
    // the current scan position: re-tokenizing just the tail should match
    // the tail of tokenizing the whole thing.
    const head = "a=1; b=2; c=3; ".repeat(200);
    const tail = 'stats_filepath = "/tmp/x.txt";';
    const whole = raws(head + tail);
    const tailOnly = raws(tail);
    expect(whole.slice(-tailOnly.length)).toEqual(tailOnly);
  });
});
