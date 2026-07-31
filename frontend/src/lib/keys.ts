import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";

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

/**
 * A plain (non-symbol) field, unlike UI_KEY -- it has to survive
 * JSON.stringify to reach the backend, since backend/api/src/secrets.ts
 * uses it to restore a still-redacted secret onto the right on-disk
 * output/mixer even when an earlier item in the same list was
 * duplicated/removed in this editing session. See stampOutputMatchIndices
 * below.
 */
const MATCH_INDEX = "_matchIndex";

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

/**
 * Carries a slot's identity key over onto a differently-shaped replacement
 * value -- for a field whose editor swaps its whole value in place (e.g.
 * OutputEditor's type dropdown, switching between a `default*Output()` or a
 * remembered same-session value of the new type: both are fresh objects with
 * their own, different identity key). Without this, the surrounding list's
 * `key={uiKeyOf(...)}` would change too, and React would tear down and
 * remount that slot's component -- silently resetting its own local state,
 * including any "remember values per type" cache living inside it, which is
 * exactly the feature this is usually called to protect.
 */
export function withSameUiKey<T extends object>(next: T, previousSlotValue: object): T {
  (next as Record<symbol, unknown>)[UI_KEY] = (previousSlotValue as Record<symbol, unknown>)[UI_KEY] ?? `k${++counter}`;
  return next;
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

/** Set on a copy's `_matchIndex` instead of leaving the original's value in place -- see markCopiedMatchIndicesDeep. Must match backend/api/src/secrets.ts's NO_MATCH. */
const NO_MATCH = -1;

/**
 * A duplicate/copy has no on-disk counterpart, so its `_matchIndex` (if the
 * original had one) must not be left pointing at the original's load-time
 * position -- restoring a secret from whatever output happens to occupy
 * that position now would silently steal an unrelated output's password/
 * api_key. NO_MATCH marks it as "known non-match" instead of just omitting
 * the field, since an omitted field falls back to positional pairing in
 * secrets.ts (for callers that never stamp `_matchIndex` at all), which is
 * exactly the unsafe behavior this needs to avoid for an actual copy.
 */
function markCopiedMatchIndicesDeep(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) markCopiedMatchIndicesDeep(item);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (MATCH_INDEX in record) record[MATCH_INDEX] = NO_MATCH;
    for (const v of Object.values(record)) markCopiedMatchIndicesDeep(v);
  }
}

/**
 * Deep-copies an item for a "Duplicate" button, with fresh identity keys
 * throughout (including any nested objects/arrays, e.g. an output's
 * rdio_scanner block) — a duplicate is a distinct item going forward, not an
 * alias sharing the original's UI state. JSON round-tripping is enough for a
 * deep copy here since config data is always plain JSON-shaped values, and
 * it naturally drops the original's symbol-keyed identity (symbols aren't
 * serialized), leaving `assignUiKeysDeep` to assign all-new ones.
 *
 * Also marks any `_matchIndex` found anywhere in the copy as NO_MATCH
 * (unlike UI_KEY, it's a plain field the JSON round-trip would otherwise
 * faithfully carry over) — see markCopiedMatchIndicesDeep.
 */
export function cloneWithNewUiKeys<T>(item: T): T {
  const cloned = JSON.parse(JSON.stringify(item)) as T;
  markCopiedMatchIndicesDeep(cloned);
  return assignUiKeysDeep(cloned);
}

/**
 * Stamps every output (on a channel or a mixer) with its array position at
 * load time, so that later duplicating/removing/copying an output elsewhere
 * in the same list doesn't cause backend/api/src/secrets.ts to restore a
 * still-redacted secret onto the wrong on-disk output. Called once, right
 * after a config is fetched -- alongside assignUiKeysDeep, since nothing
 * server-side knows about these indices either. The value is ordinary data
 * (unlike UI_KEY), so it survives the `{...item, field}` edit pattern used
 * throughout the editors; cloneWithNewUiKeys strips it from every copy.
 */
export function stampOutputMatchIndices(config: RtlAirbandConfig): RtlAirbandConfig {
  for (const device of config.devices) {
    for (const channel of device.channels) {
      channel.outputs.forEach((output, i) => {
        (output as unknown as Record<string, unknown>)[MATCH_INDEX] = i;
      });
    }
  }
  for (const mixer of config.mixers ?? []) {
    mixer.outputs.forEach((output, i) => {
      (output as unknown as Record<string, unknown>)[MATCH_INDEX] = i;
    });
  }
  return config;
}
