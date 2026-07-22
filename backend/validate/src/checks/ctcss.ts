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

      if (Array.isArray(channel.ctcss)) {
        channel.ctcss.forEach((value, vi) => {
          // 0.0 is the documented per-frequency sentinel for "CTCSS disabled
          // for this scanned frequency" — not a mistake, so it's exempt from
          // the non-positive warning that a scalar 0/negative value gets.
          checkCtcssValue(issues, value, `${path}.ctcss[${vi}]`, value !== 0);
        });
      } else {
        checkCtcssValue(issues, channel.ctcss, `${path}.ctcss`, true);
      }
    });
  });

  return issues;
}

function checkCtcssValue(issues: ValidationIssue[], value: number, path: string, warnOnNonPositive: boolean): void {
  if (value <= 0) {
    if (warnOnNonPositive) {
      issues.push({
        severity: "warning",
        code: "ctcss-non-positive",
        path,
        message: `ctcss value ${value} Hz is not positive; RTLSDR-Airband ignores it and CTCSS squelch is disabled`,
      });
    }
    return;
  }

  const nearest = nearestStandardTone(value);
  const distance = Math.abs(nearest - value);
  if (distance > 0 && distance <= NEAR_MISS_EPSILON_HZ) {
    issues.push({
      severity: "warning",
      code: "ctcss-near-standard-tone",
      path,
      message: `ctcss value ${value} Hz is close to but not exactly the standard tone ${nearest} Hz — likely a typo`,
    });
  }
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
