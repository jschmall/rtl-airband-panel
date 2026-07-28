import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

/**
 * Errors when a top-level mixer has zero channel outputs routing into it.
 * RTLSDR-Airband's mixer thread has nothing to write to a mixer with no
 * inbound routing and exits at startup. This is the reverse direction of
 * checkMixerReferences (which checks "does the mixer this output names
 * exist"); this checks "does anything route into this mixer".
 *
 * A mixer whose own outputs are all disabled is left to checkDisableCascade's
 * "no-active-mixer-outputs" -- a different, more specific root cause -- so
 * this check doesn't also flag it, to avoid two errors for the same mixer.
 */
export function checkMixerUnused(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const mixers = config.mixers ?? [];
  if (mixers.length === 0) return issues;

  const referencedMixerNames = new Set<string>();
  config.devices.forEach((device) => {
    device.channels.forEach((channel) => {
      channel.outputs.forEach((output) => {
        if (output.type === "mixer") referencedMixerNames.add(output.name);
      });
    });
  });

  mixers.forEach((mixer, mi) => {
    if (mixer.disable) return;
    if (referencedMixerNames.has(mixer.name)) return;
    const hasActiveOutputs = mixer.outputs.some((o) => !o.disable);
    if (!hasActiveOutputs) return; // checkDisableCascade already flags this mixer

    issues.push({
      severity: "error",
      code: "mixer-unused",
      path: `$.mixers[${mi}]`,
      message: `mixer '${mixer.name}' has no channel outputs routed into it; RTLSDR-Airband has nothing to write to this mixer and will exit at startup`,
    });
  });

  return issues;
}
