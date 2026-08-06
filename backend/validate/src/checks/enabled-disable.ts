import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * `enabled: false` (dynamic_reload's live-toggle keyword) is redundant when
 * `disable: true` (the pre-existing parse-time-permanent keyword) is also
 * set on the same channel/mixer -- `disable` already omits it from the
 * config entirely, so `enabled` never gets a chance to matter. Harmless,
 * not rejected -- a user may toggle these in either order while editing --
 * so this is a warning, not an error.
 */
export function checkEnabledDisableRedundant(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      if (channel.disable === true && channel.enabled === false) {
        issues.push({
          severity: "warning",
          code: "enabled-false-with-disable",
          path: `$.devices[${di}].channels[${ci}]`,
          message: "enabled: false has no effect here since disable: true already omits this channel from the config entirely",
        });
      }
    });
  });

  (config.mixers ?? []).forEach((mixer, mi) => {
    if (mixer.disable === true && mixer.enabled === false) {
      issues.push({
        severity: "warning",
        code: "enabled-false-with-disable",
        path: `$.mixers[${mi}]`,
        message: "enabled: false has no effect here since disable: true already omits this mixer from the config entirely",
      });
    }
  });

  return issues;
}
