/** RTLSDR-Airband's built-in default when no top-level `fft_size` is configured (DEFAULT_FFT_SIZE_LOG = 9). */
export const DEFAULT_FFT_SIZE = 512;

/**
 * FFT bin a channel's carrier lands on, replicating RTLSDR-Airband's own
 * formula (config.cpp, parse_channels()):
 *
 *   bin = ceil((freq + sample_rate - centerfreq) / (sample_rate / fft_size) - 1) % fft_size
 *
 * Deliberately does not factor in `correction` — that's applied at the
 * tuner/driver level and doesn't shift this software-side bin math.
 */
export function computeBin(freqHz: number, centerfreqHz: number, sampleRateHz: number, fftSize: number): number {
  const binWidthHz = sampleRateHz / fftSize;
  const raw = Math.ceil((freqHz + sampleRateHz - centerfreqHz) / binWidthHz - 1);
  return ((raw % fftSize) + fftSize) % fftSize;
}
