import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DraftInput } from "../../src/components/DraftInput.js";
import { formatNumberList, numberOrUndefined, parseNumberList } from "../../src/lib/number-utils.js";

const formatNumber = (n: number | undefined) => (n === undefined ? "" : String(n));

function NumberHarness({ initial }: { initial?: number }) {
  const [value, setValue] = useState<number | undefined>(initial);
  return (
    <>
      <DraftInput aria-label="n" value={value} parse={numberOrUndefined} format={formatNumber} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value ?? null)}</output>
      <button type="button" onClick={() => setValue(5)}>
        reset
      </button>
    </>
  );
}

function ListHarness() {
  const [value, setValue] = useState<number[]>([]);
  return (
    <>
      <DraftInput aria-label="list" value={value} parse={parseNumberList} format={formatNumberList} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe("DraftInput", () => {
  it("keeps a half-typed decimal while the number is still being typed", async () => {
    const user = userEvent.setup();
    render(<NumberHarness />);
    const input = screen.getByLabelText("n");
    await user.type(input, "37.");
    expect(input).toHaveValue("37.");
    expect(screen.getByTestId("value")).toHaveTextContent("37");
    await user.type(input, "25");
    expect(input).toHaveValue("37.25");
    expect(screen.getByTestId("value")).toHaveTextContent("37.25");
  });

  it("keeps trailing zeros and a lone minus sign", async () => {
    const user = userEvent.setup();
    render(<NumberHarness />);
    const input = screen.getByLabelText("n");
    await user.type(input, "0.0");
    expect(input).toHaveValue("0.0");
    await user.type(input, "5");
    expect(screen.getByTestId("value")).toHaveTextContent("0.05");
    await user.clear(input);
    await user.type(input, "-");
    expect(input).toHaveValue("-");
    expect(screen.getByTestId("value")).toHaveTextContent("null");
  });

  it("lets a list's separator be typed before the next entry", async () => {
    const user = userEvent.setup();
    render(<ListHarness />);
    const input = screen.getByLabelText("list");
    await user.type(input, "118000000, 1");
    expect(input).toHaveValue("118000000, 1");
    expect(screen.getByTestId("value")).toHaveTextContent("[118000000,1]");
  });

  it("shows the canonical text on blur and follows outside changes", async () => {
    const user = userEvent.setup();
    render(<NumberHarness initial={1} />);
    const input = screen.getByLabelText("n");
    await user.clear(input);
    await user.type(input, "2.50");
    expect(input).toHaveValue("2.50");
    await user.tab();
    expect(input).toHaveValue("2.5");

    await user.type(input, "0");
    await user.click(screen.getByRole("button", { name: "reset" }));
    expect(input).toHaveValue("5");
  });
});
