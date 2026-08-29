import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StatSample } from "../../src/api/client.js";
import { isOutputCounterSample, OutputStats } from "../../src/components/stats/OutputStats.js";
import type { MixerLookups } from "../../src/lib/stats-mixer-labels.js";

const EMPTY_LOOKUPS: MixerLookups = { mixerNames: new Map(), inputChannels: new Map(), deviceChannels: new Map() };

function sample(metric: string, labels: Record<string, string>, value: number): StatSample {
  return { metric, labels, value };
}

/** The outer "Output stats" section defaults to collapsed, so group cards aren't in the DOM until it's opened. */
async function openOutputStats(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Output stats" }));
}

/**
 * A card's collapsed summary line (headerActions, the button's sibling) has
 * nested elements (e.g. an amber count inside "N output failures"), so RTL's
 * getByText -- which only inspects an element's own direct text-node
 * children, not descendant elements' text -- can't find it. Read the whole
 * summary span's textContent instead and match against that directly.
 */
function summaryText(groupButton: HTMLElement): string {
  return groupButton.parentElement!.querySelector(".shrink-0")?.textContent ?? "";
}

describe("isOutputCounterSample", () => {
  it("claims mixer-labeled samples", () => {
    expect(isOutputCounterSample(sample("output_overrun_count", { mixer: "0" }, 1))).toBe(true);
    expect(isOutputCounterSample(sample("icecast_disconnect_count", { mixer: "0", output: "0" }, 1))).toBe(true);
  });

  it("claims device+channel+output-labeled failure/health counters", () => {
    expect(isOutputCounterSample(sample("icecast_disconnect_count", { device: "0", channel: "0", output: "0" }, 1))).toBe(true);
    expect(isOutputCounterSample(sample("pulse_underflow_count", { device: "0", channel: "0", output: "0" }, 1))).toBe(true);
  });

  it("claims label-less rdio_scanner counters via the failure-metric set", () => {
    expect(isOutputCounterSample(sample("rdio_scanner_queue_drop_count", {}, 1))).toBe(true);
    expect(isOutputCounterSample(sample("rdio_scanner_upload_failure_count", {}, 1))).toBe(true);
  });

  it("does not claim buffer health, device-level output overruns, or process-wide cpu seconds", () => {
    expect(isOutputCounterSample(sample("buffer_overflow_count", { device: "0" }, 1))).toBe(false);
    expect(isOutputCounterSample(sample("buffer_underrun_count", { device: "0" }, 1))).toBe(false);
    expect(isOutputCounterSample(sample("output_overrun_count", { device: "0" }, 1))).toBe(false);
    expect(isOutputCounterSample(sample("process_cpu_seconds_total", {}, 1))).toBe(false);
  });
});

describe("OutputStats", () => {
  it("renders nothing when there are no output-labeled samples", () => {
    const { container } = render(<OutputStats samples={[sample("buffer_overflow_count", { device: "0" }, 1)]} mixerLookups={EMPTY_LOOKUPS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still groups mixer-labeled samples exactly as before (rename regression guard)", async () => {
    const user = userEvent.setup();
    render(
      <OutputStats
        samples={[
          sample("output_overrun_count", { mixer: "0" }, 3),
          sample("input_overrun_count", { mixer: "0", input: "0" }, 0),
          sample("input_overrun_count", { mixer: "0", input: "1" }, 5),
        ]}
        mixerLookups={EMPTY_LOOKUPS}
      />
    );
    await openOutputStats(user);

    const button = screen.getByRole("button", { name: /Mixer 0/ });
    expect(summaryText(button)).toMatch(/Output overruns:/);
    expect(summaryText(button)).toMatch(/1.*of 2 inputs dropping/);

    await user.click(button);
    expect(screen.getByText("Input 1")).toBeInTheDocument();
  });

  it("collapses multiple device+channel output-failure metrics for the same channel into one card", async () => {
    const user = userEvent.setup();
    render(
      <OutputStats
        samples={[
          sample("icecast_disconnect_count", { device: "0", channel: "0", output: "0" }, 2),
          sample("lame_encode_failure_count", { device: "0", channel: "0", output: "0" }, 1),
        ]}
        mixerLookups={EMPTY_LOOKUPS}
      />
    );
    await openOutputStats(user);

    // One card, not two flat tiles.
    expect(screen.getAllByText("Device 0, Channel 0")).toHaveLength(1);
    const button = screen.getByRole("button", { name: /Device 0, Channel 0/ });
    expect(summaryText(button)).toMatch(/3 output failures/);
  });

  it("gives a distinct card to a different channel on the same device", async () => {
    const user = userEvent.setup();
    render(
      <OutputStats
        samples={[
          sample("icecast_disconnect_count", { device: "0", channel: "0", output: "0" }, 1),
          sample("file_write_failure_count", { device: "0", channel: "1", output: "0" }, 1),
        ]}
        mixerLookups={EMPTY_LOOKUPS}
      />
    );
    await openOutputStats(user);

    expect(screen.getByText("Device 0, Channel 0")).toBeInTheDocument();
    expect(screen.getByText("Device 0, Channel 1")).toBeInTheDocument();
  });

  it("groups label-less rdio_scanner samples into a single Process-wide card without throwing", async () => {
    const user = userEvent.setup();
    render(
      <OutputStats
        samples={[sample("rdio_scanner_queue_drop_count", {}, 6), sample("rdio_scanner_upload_failure_count", {}, 7)]}
        mixerLookups={EMPTY_LOOKUPS}
      />
    );
    await openOutputStats(user);

    expect(screen.getAllByText("Process-wide")).toHaveLength(1);
    const button = screen.getByRole("button", { name: /Process-wide/ });
    expect(summaryText(button)).toMatch(/13 output failures/);
  });

  it("displays non-failure health counters (backlog exceeded, pulse under/overflow) in the device-channel card without counting them as failures", async () => {
    const user = userEvent.setup();
    render(
      <OutputStats
        samples={[
          sample("icecast_backlog_exceeded_count", { device: "0", channel: "0", output: "0" }, 10),
          sample("pulse_underflow_count", { device: "0", channel: "0", output: "0" }, 20),
          sample("pulse_overflow_count", { device: "0", channel: "0", output: "0" }, 30),
        ]}
        mixerLookups={EMPTY_LOOKUPS}
      />
    );
    await openOutputStats(user);

    // None of these three count toward the failure total.
    const button = screen.getByRole("button", { name: /Device 0, Channel 0/ });
    expect(summaryText(button)).toMatch(/0 output failures/);

    await user.click(button);
    expect(screen.getByText("Icecast Backlog Exceeded")).toBeInTheDocument();
    expect(screen.getByText("Pulse Underflow")).toBeInTheDocument();
    expect(screen.getByText("Pulse Overflow")).toBeInTheDocument();
  });
});
