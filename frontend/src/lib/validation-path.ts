import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";

interface IndexedCollection {
  [key: string]: unknown;
}

/**
 * True if `path` is `prefix` itself, or is nested under it. Plain `startsWith`
 * would wrongly match "$.devices[10]" against prefix "$.devices[1]" -- guard
 * against that by requiring the next character to be a segment boundary.
 */
export function pathStartsWith(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}

/**
 * Turns a validation issue's JSON path (e.g.
 * "$.devices[1].channels[3].outputs[0].post_write_script") into a breadcrumb
 * a user can actually recognize (e.g. "Device 2 (rtlsdr) → Channel 151.1750
 * MHz → Output 1 (file) → post_write_script"), by walking the real config
 * alongside the path so indices resolve to the frequency/type they actually
 * point at -- collapsed sections are otherwise indistinguishable by index
 * alone. Returns "" for the bare root path "$".
 */
export function describeValidationPath(path: string, config: RtlAirbandConfig): string {
  const body = path.replace(/^\$\.?/, "");
  if (!body) return "";

  const parts: string[] = [];
  let cursor: unknown = config;

  for (const segment of body.split(".")) {
    const match = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\[(\d+)\])?$/.exec(segment);
    if (!match) {
      parts.push(segment);
      continue;
    }
    const key = match[1]!;
    const index = match[2] !== undefined ? Number(match[2]) : undefined;
    const collection = cursor as IndexedCollection | null;

    if (index !== undefined && collection && Array.isArray(collection[key])) {
      const item = (collection[key] as unknown[])[index];
      parts.push(describeItem(key, item, index));
      cursor = item;
    } else {
      parts.push(index !== undefined ? `${key}[${index}]` : key);
      cursor = collection?.[key];
    }
  }

  return parts.join(" → ");
}

/**
 * Walks the same "$.devices[0].channels[3].outputs[0].password"-style path used
 * elsewhere in this file, but returns the raw value at that path instead of a
 * label -- used to pull a single revealed secret out of an unredacted config
 * fetched on demand (see PasswordInput/OutputEditor).
 */
export function getValueAtPath(config: RtlAirbandConfig, path: string): unknown {
  const body = path.replace(/^\$\.?/, "");
  if (!body) return config;

  let cursor: unknown = config;
  for (const segment of body.split(".")) {
    const match = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\[(\d+)\])?$/.exec(segment);
    if (!match || cursor == null) return undefined;
    const key = match[1]!;
    const index = match[2] !== undefined ? Number(match[2]) : undefined;
    const next = (cursor as Record<string, unknown>)[key];
    cursor = index !== undefined ? (Array.isArray(next) ? next[index] : undefined) : next;
  }
  return cursor;
}

function describeItem(collectionKey: string, item: unknown, index: number): string {
  const obj = item as Record<string, unknown> | undefined;
  if (!obj) return `${collectionKey}[${index}]`;

  switch (collectionKey) {
    case "devices": {
      const centerfreq = typeof obj.centerfreq === "number" ? `, ${(obj.centerfreq / 1e6).toFixed(3)} MHz` : "";
      return `Device ${index + 1} (${String(obj.type)}${centerfreq})`;
    }
    case "channels": {
      if (typeof obj.freq === "number") return `Channel ${(obj.freq / 1e6).toFixed(4)} MHz`;
      const freqs = Array.isArray(obj.freqs) ? obj.freqs.length : 0;
      return `Scan channel (${freqs} frequencies)`;
    }
    case "outputs":
      return `Output ${index + 1} (${String(obj.type)})`;
    case "mixers":
      return `Mixer "${obj.name || "(unnamed)"}"`;
    default:
      return `${collectionKey}[${index}]`;
  }
}
