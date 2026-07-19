import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";
import { computeBin, DEFAULT_FFT_SIZE } from "../fft.js";
import { DEFAULT_SAMPLE_RATE_HZ } from "../rtlsdr-defaults.js";

/**
 * Errors when two channels on the same device with *different* configured
 * frequencies quantize to the same FFT bin — RTLSDR-Airband has no
 * detection for this itself, and the second channel would silently read
 * the wrong (or first channel's) audio.
 *
 * Channels sharing an *identical* frequency are never flagged: that's the
 * legitimate multi-CTCSS pattern (several logical channels demodulating
 * the same physical frequency, gated by different CTCSS tones).
 */
export function checkBinCollisions(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fftSize = config.fft_size ?? DEFAULT_FFT_SIZE;

  config.devices.forEach((device, di) => {
    const sampleRate = device.sample_rate ?? DEFAULT_SAMPLE_RATE_HZ;
    const binWidthHz = sampleRate / fftSize;
    // bin -> (freq -> index of the first channel seen at that freq/bin)
    const binAnchors = new Map<number, Map<number, number>>();

    device.channels.forEach((channel, ci) => {
      const bin = computeBin(channel.freq, device.centerfreq, sampleRate, fftSize);
      let anchorsForBin = binAnchors.get(bin);
      if (!anchorsForBin) {
        anchorsForBin = new Map();
        binAnchors.set(bin, anchorsForBin);
      }

      if (anchorsForBin.has(channel.freq)) return;

      if (anchorsForBin.size > 0) {
        const [anchorFreq, anchorCi] = [...anchorsForBin.entries()][0]!;
        issues.push({
          severity: "error",
          code: "fft-bin-collision",
          path: `$.devices[${di}].channels[${ci}]`,
          message:
            `channel frequency ${channel.freq} Hz collides with channels[${anchorCi}]'s ${anchorFreq} Hz — ` +
            `both quantize to FFT bin ${bin} (bin width ${binWidthHz} Hz), so only one will be demodulated correctly`,
        });
      }

      anchorsForBin.set(channel.freq, ci);
    });
  });

  return issues;
}
