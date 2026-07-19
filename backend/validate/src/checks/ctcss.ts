import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { ValidationIssue } from "../types.js";
import { STANDARD_CTCSS_TONES } from "../ctcss-tones.js";

/** Flag a ctcss value this close to (but not exactly on) a standard tone as a likely typo. */
const NEAR_MISS_EPSILON_HZ = 2.0;

export function checkCtcssTones(config: RtlAirbandConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  config.devices.forEach((device, di) => {
    device.channels.forEach((channel, ci) => {
      if (channel.ctcss === undefined) return;
      const path = `$.devices[${di}].channels[${ci}]`;

      if (channel.ctcss <= 0) {
        issues.push({
          severity: "warning",
          code: "ctcss-non-positive",
          path,
          message: `ctcss value ${channel.ctcss} Hz is not positive; RTLSDR-Airband ignores it and CTCSS squelch is disabled for this channel`,
        });
        return;
      }

      const nearest = nearestStandardTone(channel.ctcss);
      const distance = Math.abs(nearest - channel.ctcss);
      if (distance > 0 && distance <= NEAR_MISS_EPSILON_HZ) {
        issues.push({
          severity: "warning",
          code: "ctcss-near-standard-tone",
          path,
          message: `ctcss value ${channel.ctcss} Hz is close to but not exactly the standard tone ${nearest} Hz — likely a typo`,
        });
      }
    });
  });

  return issues;
}

function nearestStandardTone(freq: number): number {
  let best = STANDARD_CTCSS_TONES[0]!;
  let bestDist = Math.abs(best - freq);
  for (const tone of STANDARD_CTCSS_TONES) {
    const dist = Math.abs(tone - freq);
    if (dist < bestDist) {
      bestDist = dist;
      best = tone;
    }
  }
  return best;
}
