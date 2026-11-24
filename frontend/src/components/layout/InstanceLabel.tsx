import type { DeviceSummary } from "../../api/client.js";

/** MHz with three decimals, or the fourth when it isn't zero (e.g. 12.5 kHz steps). */
export function formatCenterMHz(hz: number): string {
  return (hz / 1e6).toFixed(4).replace(/0$/, "");
}

/** The whole thing in words, every device included, for the row's hover text. */
export function instanceDescription(name: string, devices: readonly DeviceSummary[]): string {
  const lines = devices.map((d) =>
    [d.serial !== undefined ? `SN ${d.serial}` : "", d.centerFreqHz !== undefined ? `center ${formatCenterMHz(d.centerFreqHz)} MHz` : ""]
      .filter(Boolean)
      .join(", ")
  );
  return [name, ...lines.filter(Boolean)].join("\n");
}

/** How many characters of a long name are kept before the frequency gives way to it. */
const NAME_MIN_CHARS = 5;

/**
 * "name - serial - center frequency" on one line. A long name is cut short so
 * the serial and frequency still show; when that would leave less than a few
 * characters of it, the frequency goes instead.
 *
 * That's one wrapping flex line with the rest clipped: the frequency wraps out
 * of sight when it doesn't fit beside the first part's basis (the least name
 * plus the serial), and max-w-max keeps a short name from claiming more room
 * than it needs. Only a serial too long for the row by itself is cut.
 *
 * An instance with several SDRs shows its first and how many more there are.
 */
export function InstanceLabel({ name, devices }: { name: string; devices: readonly DeviceSummary[] }) {
  const first = devices[0];
  const more = devices.length > 1 ? `+${devices.length - 1}` : "";
  const serial = [first?.serial, more].filter(Boolean).join(" ");
  const serialText = serial && ` - ${serial}`;
  const nameMin = Math.min(name.length, NAME_MIN_CHARS);
  return (
    <span className="flex h-5 min-w-0 flex-1 flex-wrap overflow-hidden leading-5">
      <span className="flex min-w-0 max-w-max flex-1 whitespace-pre" style={{ flexBasis: `${nameMin + serialText.length}ch` }}>
        <span className="truncate" style={{ minWidth: `${nameMin}ch` }}>
          {name}
        </span>
        {serialText && (
          <span className="flex-shrink-0 truncate whitespace-pre tabular-nums text-slate-400" style={{ maxWidth: `calc(100% - ${nameMin}ch)` }}>
            {serialText}
          </span>
        )}
      </span>
      {first?.centerFreqHz !== undefined && (
        <span className="flex-shrink-0 whitespace-pre tabular-nums text-slate-400"> - {formatCenterMHz(first.centerFreqHz)}</span>
      )}
    </span>
  );
}
