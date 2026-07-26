/** Empty or unparseable (e.g. pasted non-numeric text) both become undefined, rather than letting a stray NaN into the saved config. */
export function numberOrUndefined(value: string): number | undefined {
  if (value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses a comma-separated field that RTLSDR-Airband's own grammar accepts
 * as either a single scalar (applied to every scanned frequency) or a list
 * with one entry per frequency, e.g. `squelch_threshold = ( -30, -25, 0 );`.
 * A single entry with no comma round-trips as a scalar, not a one-item list.
 * Entries that don't parse to a finite number (a typo, e.g. "100000, abc") are
 * dropped rather than saved as NaN, which would corrupt the written config.
 */
export function parseNumberOrList(text: string): number | number[] | undefined {
  const parts = text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const numbers = parts.map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return undefined;
  return numbers.length === 1 ? numbers[0] : numbers;
}

export function formatNumberOrList(value: number | number[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** Parses a required comma-separated list of numbers, e.g. scan-mode `freqs`. Unparseable entries are dropped rather than saved as NaN. */
export function parseNumberList(text: string): number[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(Number)
    .filter(Number.isFinite);
}

export function formatNumberList(values: number[]): string {
  return values.join(", ");
}

/** Parses an optional comma-separated list of strings, e.g. scan-mode `labels`/`modulations`. */
export function parseStringListOrUndefined(text: string): string[] | undefined {
  const parts = text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return parts.length === 0 ? undefined : parts;
}

export function formatStringList(values: string[] | undefined): string {
  return values ? values.join(", ") : "";
}
