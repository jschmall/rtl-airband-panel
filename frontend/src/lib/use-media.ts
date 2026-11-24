import { useSyncExternalStore } from "react";

// Same boundaries as Tailwind's lg: and sm:, so hook-driven and class-driven layout switch together.
const COMPACT = "(max-width: 1023.98px)";
const NARROW = "(max-width: 639.98px)";

/** One shared MediaQueryList per query: every row of a long channel list asks. */
const lists = new Map<string, MediaQueryList | null>();

function listFor(query: string): MediaQueryList | null {
  let list = lists.get(query);
  if (list === undefined) {
    list = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
    lists.set(query, list);
  }
  return list;
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = listFor(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    () => listFor(query)?.matches ?? false
  );
}

/** Below lg: phones either way up and small tablets, which get the streamlined layout. */
export const useCompact = () => useMedia(COMPACT);

/** Below sm: too narrow for a table with more than a few columns (a phone held upright). */
export const useNarrow = () => useMedia(NARROW);
