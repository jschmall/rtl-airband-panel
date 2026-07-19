import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationResult } from "./types.js";
import { checkFrequencyWindow } from "./checks/frequency-window.js";
import { checkBinCollisions } from "./checks/bin-collision.js";
import { checkCtcssTones } from "./checks/ctcss.js";

export function validateConfig(config: RtlAirbandConfig): ValidationResult {
  const issues = [...checkFrequencyWindow(config), ...checkBinCollisions(config), ...checkCtcssTones(config)];
  return {
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
  };
}

export type { ValidationIssue, ValidationResult, IssueSeverity } from "./types.js";
export { isValid } from "./types.js";
export { computeBin, DEFAULT_FFT_SIZE } from "./fft.js";
export { STANDARD_CTCSS_TONES } from "./ctcss-tones.js";
export { checkFrequencyWindow } from "./checks/frequency-window.js";
export { checkBinCollisions } from "./checks/bin-collision.js";
export { checkCtcssTones } from "./checks/ctcss.js";
