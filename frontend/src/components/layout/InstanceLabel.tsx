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

/** The label's pieces, for the label and for what measures it. */
function labelParts(name: string, devices: readonly DeviceSummary[]) {
  const first = devices[0];
  const more = devices.length > 1 ? `+${devices.length - 1}` : "";
  const serial = [first?.serial, more].filter(Boolean).join(" ");
  return {
    nameMin: Math.min(name.length, NAME_MIN_CHARS),
    serialText: serial && ` - ${serial}`,
    centerText: first?.centerFreqHz !== undefined ? ` - ${formatCenterMHz(first.centerFreqHz)}` : "",
  };
}

/**
 * "name - serial - center frequency" on one line. The side panel grows to fit
 * it (see RailSizer); once it can't, the name is cut short so the serial and
 * frequency still show. Only when that would leave less than a few characters
 * of it does the frequency go instead.
 *
 * That's one wrapping flex line with the rest clipped: the frequency wraps out
 * of sight when it doesn't fit beside the first part's basis (the least name
 * plus the serial), and max-w-max keeps a short name from claiming more room
 * than it needs. Only a serial too long for the row by itself is cut: its
 * limit is in terms of the row (cqi), not of the part it's in, which is only as
 * wide as its text. There, a name narrower than its minimum left the serial a
 * rounding error short, and the browser put "…" in its place.
 *
 * An instance with several SDRs shows its first and how many more there are.
 */
export function InstanceLabel({ name, devices }: { name: string; devices: readonly DeviceSummary[] }) {
  const { nameMin, serialText, centerText } = labelParts(name, devices);
  return (
    <span className="flex h-5 min-w-0 flex-1 flex-wrap overflow-hidden leading-5 [container-type:inline-size]">
      <span className="flex min-w-0 max-w-max flex-1 whitespace-pre" style={{ flexBasis: `${nameMin + serialText.length}ch` }}>
        <span className="truncate" style={{ minWidth: `${nameMin}ch` }}>
          {name}
        </span>
        {serialText && (
          <span className="flex-shrink-0 truncate whitespace-pre tabular-nums text-slate-400" style={{ maxWidth: `calc(100cqi - ${nameMin}ch)` }}>
            {serialText}
          </span>
        )}
      </span>
      {centerText && <span className="flex-shrink-0 whitespace-pre tabular-nums text-slate-400">{centerText}</span>}
    </span>
  );
}

/**
 * The width InstanceLabel needs to show everything. Plain inline pieces: the
 * label's own wrapping flex line has no intrinsic width browsers agree on. The
 * name's minimum has to be the same, as it can be wider than a short name; the
 * spare pixels cover rounding.
 */
export function InstanceLabelSizer({ name, devices }: { name: string; devices: readonly DeviceSummary[] }) {
  const { nameMin, serialText, centerText } = labelParts(name, devices);
  return (
    <span className="flex-shrink-0 whitespace-pre pr-0.5 leading-5">
      <span className="inline-block" style={{ minWidth: `${nameMin}ch` }}>
        {name}
      </span>
      <span className="inline-block tabular-nums">{serialText}</span>
      <span className="inline-block tabular-nums">{centerText}</span>
    </span>
  );
}
