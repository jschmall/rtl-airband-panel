import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";
import { MAX_FFT_SIZE, MIN_FFT_SIZE } from "../fft.js";

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Mirrors RTLSDR-Airband's own startup check (rtl_airband.cpp): fft_size
 * must be a power of two in [256, 8192], or config parsing calls error()
 * (_Exit(1)).
 */
export function checkFftSize(config: RtlAirbandConfig): ValidationIssue[] {
  if (config.fft_size === undefined) return [];
  const { fft_size: fftSize } = config;

  if (!isPowerOfTwo(fftSize) || fftSize < MIN_FFT_SIZE || fftSize > MAX_FFT_SIZE) {
    return [
      {
        severity: "error",
        code: "fft-size-invalid",
        path: "$.fft_size",
        message: `fft_size ${fftSize} is invalid (must be a power of two in range ${MIN_FFT_SIZE}-${MAX_FFT_SIZE})`,
      },
    ];
  }

  return [];
}
