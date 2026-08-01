import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHarness, seedFixture, teardownHarness, type TestHarness } from "./helpers.js";

let h: TestHarness;

beforeEach(async () => {
  h = await buildHarness();
});

afterEach(async () => {
  await teardownHarness(h);
});

describe("StatsService.latestSummaries", () => {
  it("returns an all-zero summary for an instance with no polled samples yet", async () => {
    await seedFixture(h.instancesDir);
    expect(await h.statsService.latestSummaries()).toEqual({
      rtl_151719: { bufferOverflowTotal: 0, outputOverrunTotal: 0, inputsDroppingCount: 0, outputFailureTotal: 0 },
    });
  });

  it("sums buffer_overflow_count across multiple devices, and output_overrun_count across both device- and mixer-labeled series", async () => {
    await seedFixture(h.instancesDir);
    h.statsStore.insertBatch(
      "rtl_151719",
      [
        { metric: "buffer_overflow_count", labels: { device: "0" }, value: 2 },
        { metric: "buffer_overflow_count", labels: { device: "1" }, value: 5 },
        // output_overrun_count can be labeled by device (no mixer feeding it)
        // or by mixer -- both must count toward the same total.
        { metric: "output_overrun_count", labels: { device: "0" }, value: 1 },
        { metric: "output_overrun_count", labels: { mixer: "0" }, value: 4 },
      ],
      Date.now()
    );

    const summaries = await h.statsService.latestSummaries();
    expect(summaries["rtl_151719"]).toEqual({ bufferOverflowTotal: 7, outputOverrunTotal: 5, inputsDroppingCount: 0, outputFailureTotal: 0 });
  });

  it("counts input_overrun_count series with a nonzero value, not their sum", async () => {
    await seedFixture(h.instancesDir);
    h.statsStore.insertBatch(
      "rtl_151719",
      [
        { metric: "input_overrun_count", labels: { mixer: "0", input: "0" }, value: 0 },
        { metric: "input_overrun_count", labels: { mixer: "0", input: "1" }, value: 3 },
        { metric: "input_overrun_count", labels: { mixer: "1", input: "0" }, value: 12 },
      ],
      Date.now()
    );

    const summaries = await h.statsService.latestSummaries();
    expect(summaries["rtl_151719"]).toEqual({ bufferOverflowTotal: 0, outputOverrunTotal: 0, inputsDroppingCount: 2, outputFailureTotal: 0 });
  });

  it("reports each instance independently, keyed by name", async () => {
    await seedFixture(h.instancesDir, "rtl_a");
    await seedFixture(h.instancesDir, "rtl_b");
    h.statsStore.insertBatch("rtl_a", [{ metric: "buffer_overflow_count", labels: { device: "0" }, value: 9 }], Date.now());

    const summaries = await h.statsService.latestSummaries();
    expect(summaries["rtl_a"]).toEqual({ bufferOverflowTotal: 9, outputOverrunTotal: 0, inputsDroppingCount: 0, outputFailureTotal: 0 });
    expect(summaries["rtl_b"]).toEqual({ bufferOverflowTotal: 0, outputOverrunTotal: 0, inputsDroppingCount: 0, outputFailureTotal: 0 });
  });

  it("ignores metrics that aren't one of the rollup targets", async () => {
    await seedFixture(h.instancesDir);
    h.statsStore.insertBatch(
      "rtl_151719",
      [{ metric: "channel_signal_level", labels: { freq: "151.160" }, value: 3.5 }],
      Date.now()
    );

    const summaries = await h.statsService.latestSummaries();
    expect(summaries["rtl_151719"]).toEqual({ bufferOverflowTotal: 0, outputOverrunTotal: 0, inputsDroppingCount: 0, outputFailureTotal: 0 });
  });

  it("sums every output-failure metric across device- and mixer-labeled series into outputFailureTotal", async () => {
    await seedFixture(h.instancesDir);
    h.statsStore.insertBatch(
      "rtl_151719",
      [
        { metric: "icecast_disconnect_count", labels: { device: "0", channel: "0", output: "0" }, value: 2 },
        { metric: "lame_encode_failure_count", labels: { device: "0", channel: "0", output: "0" }, value: 1 },
        { metric: "file_write_failure_count", labels: { device: "0", channel: "1", output: "0" }, value: 3 },
        { metric: "udp_stream_dropped_packet_count", labels: { mixer: "0", output: "0" }, value: 4 },
        { metric: "pulse_disconnect_count", labels: { mixer: "0", output: "1" }, value: 5 },
        { metric: "rdio_scanner_queue_drop_count", labels: {}, value: 6 },
        { metric: "rdio_scanner_upload_failure_count", labels: {}, value: 7 },
      ],
      Date.now()
    );

    const summaries = await h.statsService.latestSummaries();
    expect(summaries["rtl_151719"]).toEqual({
      bufferOverflowTotal: 0,
      outputOverrunTotal: 0,
      inputsDroppingCount: 0,
      outputFailureTotal: 28,
    });
  });

  it("excludes icecast_backlog_exceeded_count and pulse underflow/overflow from outputFailureTotal", async () => {
    await seedFixture(h.instancesDir);
    h.statsStore.insertBatch(
      "rtl_151719",
      [
        { metric: "icecast_backlog_exceeded_count", labels: { device: "0", channel: "0", output: "0" }, value: 10 },
        { metric: "pulse_underflow_count", labels: { device: "0", channel: "0", output: "0" }, value: 20 },
        { metric: "pulse_overflow_count", labels: { device: "0", channel: "0", output: "0" }, value: 30 },
      ],
      Date.now()
    );

    const summaries = await h.statsService.latestSummaries();
    expect(summaries["rtl_151719"]).toEqual({
      bufferOverflowTotal: 0,
      outputOverrunTotal: 0,
      inputsDroppingCount: 0,
      outputFailureTotal: 0,
    });
  });

  it("reports process_cpu_seconds_total verbatim, and leaves it undefined when unreported", async () => {
    await seedFixture(h.instancesDir, "rtl_a");
    await seedFixture(h.instancesDir, "rtl_b");
    h.statsStore.insertBatch("rtl_a", [{ metric: "process_cpu_seconds_total", labels: {}, value: 187.652341 }], Date.now());

    const summaries = await h.statsService.latestSummaries();
    expect(summaries["rtl_a"].processCpuSeconds).toBe(187.652341);
    expect(summaries["rtl_b"].processCpuSeconds).toBeUndefined();
  });
});
