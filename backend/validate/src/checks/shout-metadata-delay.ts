import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";

const MAX_SHOUT_METADATA_DELAY = 32;

/**
 * Mirrors RTLSDR-Airband's own startup check (rtl_airband.cpp): shout_metadata_delay
 * must be in [0, 32] (0 to 2*TAG_QUEUE_LEN, TAG_QUEUE_LEN=16), or config parsing
 * calls error() (_Exit(1)).
 */
export function checkShoutMetadataDelay(config: RtlAirbandConfig): ValidationIssue[] {
  if (config.shout_metadata_delay === undefined) return [];
  const { shout_metadata_delay: delay } = config;

  if (delay < 0 || delay > MAX_SHOUT_METADATA_DELAY) {
    return [
      {
        severity: "error",
        code: "shout-metadata-delay-out-of-range",
        path: "$.shout_metadata_delay",
        message: `shout_metadata_delay ${delay} is out of allowed range (0-${MAX_SHOUT_METADATA_DELAY})`,
      },
    ];
  }

  return [];
}
