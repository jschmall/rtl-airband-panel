/**
 * React needs a stable `key` per list item to keep each item's own component
 * state (a Collapsible's open/closed state, OutputEditor/DeviceEditor's
 * "remember last value per type" caches) attached to *that* item, not to
 * whatever array position it happens to occupy. Keying by array index (the
 * previous approach) breaks this the moment an item before it is added or
 * removed: the remaining items shift position and inherit whatever UI state
 * belonged to that index before.
 *
 * Devices/channels/outputs/mixers have no natural unique field (two "file"
 * outputs are common; two channels can even share a frequency with different
 * CTCSS tones), so this assigns a synthetic one instead, as a symbol-keyed
 * property: symbols survive `{...item, field: value}` (the edit pattern used
 * throughout the editors, since spread copies symbol-keyed properties same as
 * string-keyed ones) but are invisible to `JSON.stringify` (so they never
 * appear in a saved .conf or an API request body) and to `Object.keys`/
 * `for...in` (so they never trip config-shape.ts's "unexpected field" checks
 * either, though that's moot given they're never serialized in the first
 * place).
 */
const UI_KEY = Symbol("uiKey");

let counter = 0;

/** Assigns a fresh identity key to a newly-created item (from lib/defaults.ts) if it doesn't already have one. */
export function withUiKey<T extends object>(item: T): T {
  if (!(UI_KEY in item)) {
    (item as Record<symbol, unknown>)[UI_KEY] = `k${++counter}`;
  }
  return item;
}

/** React `key` for a list item — its identity key if assigned, or the array index as a last resort (e.g. data freshly loaded before normalization has run). */
export function uiKeyOf(item: object, fallbackIndex: number): string | number {
  return (item as Record<symbol, unknown>)[UI_KEY] as string | undefined ?? fallbackIndex;
}

/** Walks a value assigning identity keys to every plain object it finds (arrays and nested objects alike) that doesn't already have one -- used once, right after a config is fetched from the API, since nothing server-side knows about these keys. */
export function assignUiKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) assignUiKeysDeep(item);
  } else if (value !== null && typeof value === "object") {
    withUiKey(value as object);
    for (const v of Object.values(value)) assignUiKeysDeep(v);
  }
  return value;
}

/**
 * Deep-copies an item for a "Duplicate" button, with fresh identity keys
 * throughout (including any nested objects/arrays, e.g. an output's
 * rdio_scanner block) — a duplicate is a distinct item going forward, not an
 * alias sharing the original's UI state. JSON round-tripping is enough for a
 * deep copy here since config data is always plain JSON-shaped values, and
 * it naturally drops the original's symbol-keyed identity (symbols aren't
 * serialized), leaving `assignUiKeysDeep` to assign all-new ones.
 */
export function cloneWithNewUiKeys<T>(item: T): T {
  return assignUiKeysDeep(JSON.parse(JSON.stringify(item)) as T);
}
