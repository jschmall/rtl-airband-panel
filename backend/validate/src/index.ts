import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationResult } from "./types.js";
import { checkFrequencyWindow } from "./checks/frequency-window.js";
import { checkBinCollisions } from "./checks/bin-collision.js";
import { checkCtcssTones } from "./checks/ctcss.js";
import { checkScanMode } from "./checks/scan-mode.js";
import { checkDeviceRequirements } from "./checks/device-requirements.js";
import { checkMixerReferences, checkMixerOutputBalance } from "./checks/mixers.js";
import { checkMixerUnused } from "./checks/mixer-unused.js";
import { checkDisableCascade } from "./checks/disable-cascade.js";
import { checkRdioScanner } from "./checks/rdio-scanner.js";
import { checkFftSize } from "./checks/fft-size.js";
import { checkShoutMetadataDelay } from "./checks/shout-metadata-delay.js";
import { checkFilterCutoffs } from "./checks/filter-cutoffs.js";
import { checkModulation } from "./checks/modulation.js";
import { checkAmpfactor, checkSquelchThreshold, checkSquelchSnrThreshold, checkSquelchMutualExclusion, checkNotchQ } from "./checks/channel-ranges.js";
import { checkFileOutputFlags } from "./checks/output-flags.js";
import { checkMixerNestedOutputs } from "./checks/mixer-nested-outputs.js";
import { checkPostWriteScript } from "./checks/post-write-script.js";
import { checkStatsHttp } from "./checks/stats-http.js";

export function validateConfig(config: RtlAirbandConfig): ValidationResult {
  const issues = [
    ...checkFrequencyWindow(config),
    ...checkBinCollisions(config),
    ...checkCtcssTones(config),
    ...checkScanMode(config),
    ...checkDeviceRequirements(config),
    ...checkMixerReferences(config),
    ...checkMixerUnused(config),
    ...checkDisableCascade(config),
    ...checkRdioScanner(config),
    ...checkFftSize(config),
    ...checkShoutMetadataDelay(config),
    ...checkFilterCutoffs(config),
    ...checkModulation(config),
    ...checkAmpfactor(config),
    ...checkSquelchThreshold(config),
    ...checkSquelchSnrThreshold(config),
    ...checkSquelchMutualExclusion(config),
    ...checkNotchQ(config),
    ...checkFileOutputFlags(config),
    ...checkMixerNestedOutputs(config),
    ...checkMixerOutputBalance(config),
    ...checkPostWriteScript(config),
    ...checkStatsHttp(config),
  ];
  return {
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
  };
}

export type { ValidationIssue, ValidationResult, IssueSeverity } from "./types.js";
export { isValid } from "./types.js";
export { computeBin, DEFAULT_FFT_SIZE, MIN_FFT_SIZE, MAX_FFT_SIZE } from "./fft.js";
export { DEFAULT_SAMPLE_RATE_HZ, MIN_SAMPLE_RATE_HZ } from "./rtlsdr-defaults.js";
export { STANDARD_CTCSS_TONES } from "./ctcss-tones.js";
export { checkFrequencyWindow } from "./checks/frequency-window.js";
export { checkBinCollisions } from "./checks/bin-collision.js";
export { checkCtcssTones } from "./checks/ctcss.js";
export { checkScanMode } from "./checks/scan-mode.js";
export { checkDeviceRequirements } from "./checks/device-requirements.js";
export { checkMixerReferences, checkMixerOutputBalance } from "./checks/mixers.js";
export { checkMixerUnused } from "./checks/mixer-unused.js";
export { checkDisableCascade } from "./checks/disable-cascade.js";
export { checkRdioScanner } from "./checks/rdio-scanner.js";
export { checkFftSize } from "./checks/fft-size.js";
export { checkShoutMetadataDelay } from "./checks/shout-metadata-delay.js";
export { checkFilterCutoffs } from "./checks/filter-cutoffs.js";
export { checkModulation } from "./checks/modulation.js";
export { checkAmpfactor, checkSquelchThreshold, checkSquelchSnrThreshold, checkSquelchMutualExclusion, checkNotchQ } from "./checks/channel-ranges.js";
export { checkFileOutputFlags } from "./checks/output-flags.js";
export { checkMixerNestedOutputs } from "./checks/mixer-nested-outputs.js";
export { checkPostWriteScript } from "./checks/post-write-script.js";
export { checkStatsHttp } from "./checks/stats-http.js";
