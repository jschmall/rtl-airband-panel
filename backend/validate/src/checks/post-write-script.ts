import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * post_write_script isn't a mistake to flag as invalid — it's a documented,
 * legitimate RTLSDR-Airband feature (upload/transcode/notify hooks) — but
 * RTLSDR-Airband runs whatever it names as an arbitrary command after every
 * file write. This panel has no authentication layer, so anyone who can save
 * a config through the API can already do most things; a script hook is
 * worth a standing reminder each time it's present, since it's the one field
 * that turns "can edit this instance's config" into "can run arbitrary
 * commands as the process user" most directly.
 */
export function checkPostWriteScript(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const checkOutputs = (outputs: RtlAirbandConfig["devices"][number]["channels"][number]["outputs"], pathPrefix: string) => {
    outputs.forEach((output, oi) => {
      if (output.type === "file" && output.post_write_script !== undefined) {
        issues.push({
          severity: "warning",
          code: "post-write-script-runs-arbitrary-command",
          path: `${pathPrefix}.outputs[${oi}].post_write_script`,
          message: "post_write_script runs an arbitrary command after every write; make sure this instance's config can't be edited by anyone you wouldn't trust to run commands as the rtl_airband process user",
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
