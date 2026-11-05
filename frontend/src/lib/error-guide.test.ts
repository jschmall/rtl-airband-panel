import { describe, expect, it } from "vitest";
import type { ErrorLogEvent } from "../api/client.js";
import { ERROR_GUIDE, GUIDE_CATEGORIES, guideCounts, guideFor } from "./error-guide.js";

let nextId = 1;
const log = (message: string): ErrorLogEvent => ({ id: nextId++, instance: "a", ts: 0, kind: "log", severity: "warning", message });
const counter = (metric: string): ErrorLogEvent => ({
  id: nextId++,
  instance: "a",
  ts: 0,
  kind: "counter",
  severity: "warning",
  message: `${metric} +1`,
  detail: { metric, delta: 1, series: [] },
});
const ofKind = (kind: string, severity: ErrorLogEvent["severity"] = "warning"): ErrorLogEvent => ({
  id: nextId++,
  instance: "a",
  ts: 0,
  kind,
  severity,
  message: "x",
});

describe("error guide", () => {
  it("has unique ids, known categories, and something to say for each entry", () => {
    const ids = ERROR_GUIDE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ERROR_GUIDE) {
      expect(GUIDE_CATEGORIES).toContain(e.category);
      expect(e.causes.length).toBeGreaterThan(0);
      expect(e.fixes.length).toBeGreaterThan(0);
      expect(e.summary).not.toBe("");
    }
  });

  it("maps systemd state changes", () => {
    expect(guideFor(ofKind("unit-failed", "error"))?.id).toBe("unit-failed");
    expect(guideFor(ofKind("unit-stopped"))?.id).toBe("unit-stopped");
    expect(guideFor(ofKind("unexpected-restart"))?.id).toBe("unexpected-restart");
  });

  it("leaves the panel's own restart and live-apply markers alone", () => {
    expect(guideFor(ofKind("restart", "info"))).toBeNull();
    expect(guideFor(ofKind("live-apply", "info"))).toBeNull();
  });

  it("covers every counter the backend records (events.rs metric_title)", () => {
    const expected: Record<string, string> = {
      icecast_disconnect_count: "icecast",
      lame_encode_failure_count: "mp3-encode",
      file_write_failure_count: "file-write",
      udp_stream_dropped_packet_count: "udp-stream",
      pulse_disconnect_count: "pulse",
      rdio_scanner_queue_drop_count: "rdio-scanner",
      rdio_scanner_upload_failure_count: "rdio-scanner",
      buffer_overflow_count: "buffer-overflow",
      output_overrun_count: "output-overrun",
    };
    for (const [metric, id] of Object.entries(expected)) expect(guideFor(counter(metric))?.id, metric).toBe(id);
    expect(guideFor(counter("something_new_count"))).toBeNull();
  });

  // Lines as rtl_airband (the fork), librtlsdr and systemd write them, with
  // the journal's "ident[pid]: " prefix the backend keeps.
  it.each([
    ["rtl_airband[812]: Failed to open rtlsdr device #0.", "sdr-open-failed"],
    ["rtl_airband[812]: 1 device(s) failed to initialize - aborting", "sdr-open-failed"],
    ["rtl_airband[812]: All receivers failed, exiting", "sdr-open-failed"],
    ["rtl_airband[812]: usb_claim_interface error -6", "sdr-open-failed"],
    ["rtl_airband[812]: RTLSDR device #1: async read failed, disabling", "sdr-lost"],
    ["rtl_airband[812]: Device #0 failed, disconnecting stream ice.example:8000/tower", "sdr-lost"],
    ["rtl_airband[812]: Failed to set gain to 49.60 for device #0: error -1", "tuner-setting-failed"],
    ["rtl_airband[812]: Failed to set centerfreq for RTLSDR device #0: error -5", "tuner-setting-failed"],
    ["rtl_airband[812]: Failed to retune to 119100000 Hz during frequency scan, will retry on next hop", "tuner-setting-failed"],
    ["rtl_airband[812]: Device #0: auto_ppm disabled: error grew after 2 steps; restored correction to 3 ppm. Fix the cause, then reload_diff", "auto-ppm-disabled"],
    ["rtl_airband[812]: Device #0: auto_ppm failed to set correction 5 ppm", "auto-ppm-disabled"],
    ["rtl_airband[812]: Device #0: auto_ppm wants +12.3 ppm beyond the current 3 ppm, past the +/-10 ppm limit - holding", "auto-ppm-limit"],
    ["rtl_airband[812]: Warning: dev[0].channel[2]: frequency 136.975 MHz is outside of SDR operating bandwidth (118.0-120.4 MHz)", "outside-bandwidth"],
    ["rtl_airband[812]: Lost connection to ice.example:8000/tower", "icecast"],
    ["rtl_airband[812]: Could not connect to ice.example:8000/tower: Connection refused", "icecast"],
    ["rtl_airband[812]: Exceeded max backlog for ice.example:8000/tower, disconnecting", "icecast"],
    ["rtl_airband[812]: Icecast metadata for ice.example:8000/tower: Invalid parameter", "icecast"],
    ["rtl_airband[812]: Failed to set shout metadata for ice.example:8000/tower: Socket error", "icecast"],
    ["rtl_airband[812]: lame_encode_buffer_ieee_float: -1", "mp3-encode"],
    ["rtl_airband[812]: tag_queue_put: queue overrun", "output-overrun"],
    ["rtl_airband[812]: udp_stream: could not resolve recv.example:6000 - Name or service not known", "udp-stream"],
    ["rtl_airband[812]: pulse: default: connection failed: Connection refused", "pulse"],
    ["rtl_airband[812]: rdio_scanner: failed to upload /rec/a.mp3 after 3 attempt(s), http=401: Unauthorized", "rdio-scanner"],
    ["rtl_airband[812]: rdio_scanner: upload queue full (64), dropping oldest job for /rec/b.mp3", "rdio-scanner"],
    ["rtl_airband[812]: Cannot write to /srv/rec/tower.mp3 (Permission denied), output disabled", "file-write"],
    ["rtl_airband[812]: Could not create directory /srv/rec/2026/11: No such file or directory", "file-write"],
    ["rtl_airband[812]: Problem writing /srv/rec/tower.mp3 (No space left on device)", "file-write"],
    ["rtl_airband[812]: control_socket: bind(/run/rtl/a.sock) failed: Address already in use", "control-socket"],
    ["rtl_airband[812]: control_socket: rejected connection from a different uid", "control-socket"],
    ["rtl_airband[812]: stats_http: bind(0.0.0.0:9100) failed: Address already in use", "port-in-use"],
    ["rtl_airband[812]: mixer_remote: bind(/run/rtl/m.sock) failed: Address already in use", "port-in-use"],
    ["rtl_airband[812]: Out of memory. Try a smaller batch or increase GPU memory.", "crash"],
    ["systemd[1]: rtl_airband@tower.service: Main process exited, code=dumped, status=11/SEGV", "unit-failed"],
    ["systemd[1]: rtl_airband@tower.service: Failed with result 'exit-code'.", "unit-failed"],
  ])("%s", (message, id) => {
    expect(guideFor(log(message))?.id).toBe(id);
  });

  it("has no guide for lines it doesn't know", () => {
    expect(guideFor(log("rtl_airband[812]: something unusual happened, error 42"))).toBeNull();
  });

  it("counts events per entry", () => {
    const counts = guideCounts([counter("icecast_disconnect_count"), log("Lost connection to x:1/y"), ofKind("restart", "info"), log("??")]);
    expect(Object.fromEntries(counts)).toEqual({ icecast: 2 });
  });
});
