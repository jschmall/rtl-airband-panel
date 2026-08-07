import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Mirrors RTLSDR-Airband's own startup check (config.cpp): a `mixer_remote`
 * output's stream_id must not be negative, or config parsing calls error()
 * (_Exit(1)). Checked across both device-channel outputs and mixer outputs
 * -- unlike local `type: "mixer"` outputs, `mixer_remote` is legal nested
 * inside a mixer's own outputs too.
 */
export function checkMixerRemoteOutputStreamId(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const checkOutputs = (outputs: RtlAirbandConfig["devices"][number]["channels"][number]["outputs"], pathPrefix: string) => {
    outputs.forEach((output, oi) => {
      if (output.type !== "mixer_remote") return;
      if (output.stream_id < 0) {
        issues.push({
          severity: "error",
          code: "mixer-remote-output-stream-id-negative",
          path: `${pathPrefix}.outputs[${oi}]`,
          message: `stream_id ${output.stream_id} must not be negative`,
        });
      }
    });
  };

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      checkOutputs(channel.outputs, `$.devices[${di}].channels[${ci}]`);
    });
  });

  (config.mixers ?? []).forEach((mixer, mi) => {
    checkOutputs(mixer.outputs, `$.mixers[${mi}]`);
  });

  return issues;
}

/**
 * Mirrors RTLSDR-Airband's own startup checks (config.cpp) on a mixer's
 * `remote_inputs` block: listen_path must not be empty, stream_id must not
 * be negative, balance (if set) must be in [-1.0, 1.0], and a (listen_path,
 * stream_id) pair must not repeat. That last check is deliberately GLOBAL
 * across every mixer in the config, not scoped to one mixer -- verified
 * against the fork's config.cpp: mixer_remote_get_or_create_listener(
 * listen_path) returns one shared listener/route registry reused across
 * every mixer's remote_inputs block in the same parse_mixers() pass, so two
 * different mixers sharing a listen_path with the same stream_id hit the
 * same startup error C++ raises, not two independent per-mixer namespaces.
 */
export function checkMixerRemoteInputs(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenByListenPath = new Map<string, Set<number>>();

  (config.mixers ?? []).forEach((mixer, mi) => {
    (mixer.remote_inputs ?? []).forEach((input, ri) => {
      const path = `$.mixers[${mi}].remote_inputs[${ri}]`;

      if (input.listen_path.trim() === "") {
        issues.push({
          severity: "error",
          code: "mixer-remote-input-listen-path-empty",
          path,
          message: "listen_path must not be empty",
        });
      }

      if (input.stream_id < 0) {
        issues.push({
          severity: "error",
          code: "mixer-remote-input-stream-id-negative",
          path,
          message: `stream_id ${input.stream_id} must not be negative`,
        });
      }

      if (input.balance !== undefined && (input.balance < -1.0 || input.balance > 1.0)) {
        issues.push({
          severity: "error",
          code: "mixer-remote-input-balance-out-of-range",
          path,
          message: `balance ${input.balance} is out of allowed range <-1.0;1.0>`,
        });
      }

      let seenStreamIds = seenByListenPath.get(input.listen_path);
      if (!seenStreamIds) {
        seenStreamIds = new Set();
        seenByListenPath.set(input.listen_path, seenStreamIds);
      }
      if (seenStreamIds.has(input.stream_id)) {
        issues.push({
          severity: "error",
          code: "mixer-remote-input-duplicate-stream-id",
          path,
          message: `duplicate stream_id ${input.stream_id} for listen_path ${input.listen_path}`,
        });
      } else {
        seenStreamIds.add(input.stream_id);
      }
    });
  });

  return issues;
}
