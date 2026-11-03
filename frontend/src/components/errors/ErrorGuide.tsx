import { useEffect, useMemo, useState } from "react";
import { ERROR_GUIDE, GUIDE_CATEGORIES, type GuideEntry } from "../../lib/error-guide.js";
import { Collapsible } from "../Collapsible.js";

/** Guide text, with `backticked` spans (commands, paths, settings) shown as code. */
export function GuideText({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded bg-slate-800/60 px-1 font-mono text-[0.95em] text-slate-200">
            {part}
          </code>
        ) : (
          part
        )
      )}
    </>
  );
}

/** Causes and fixes for one guide entry: under an event, and in the key. */
export function GuideDetail({ entry }: { entry: GuideEntry }) {
  return (
    <div className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
      <div>
        <p className="font-medium text-slate-300">Likely causes</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-slate-400">
          {entry.causes.map((c) => (
            <li key={c}>
              <GuideText text={c} />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-medium text-slate-300">How to fix</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-slate-400">
          {entry.fixes.map((f) => (
            <li key={f}>
              <GuideText text={f} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** A request to open the key at one entry; `n` changes on every request so the same entry can be jumped to twice. */
export interface GuideJump {
  id: string;
  n: number;
}

export const guideAnchor = (id: string) => `guide-${id}`;

function GuideItem({
  entry,
  count,
  open,
  flash,
  onToggle,
}: {
  entry: GuideEntry;
  count: number;
  open: boolean;
  flash: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      id={guideAnchor(entry.id)}
      style={{ scrollMarginTop: 16 }}
      className={`rounded-md border px-3 py-2 transition-colors duration-700 ${flash ? "border-sky-500/70 bg-sky-500/10" : "border-slate-800 bg-slate-950/40"}`}
    >
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 text-left">
        <span aria-hidden="true" className={`mt-0.5 inline-block text-[10px] text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="text-sm font-medium text-slate-200">{entry.title}</span>
            {count > 0 && (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-300">
                {count} in log
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-slate-400">{entry.summary}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2 pl-5">
          <GuideDetail entry={entry} />
        </div>
      )}
    </li>
  );
}

/**
 * The key: every kind of problem the Errors page knows, grouped, with
 * causes and fixes. Kinds seen in the loaded log come first in each group,
 * with a count.
 */
export function ErrorGuide({ counts, jump }: { counts: ReadonlyMap<string, number>; jump: GuideJump | null }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [flashId, setFlashId] = useState<string | null>(null);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // A jump opens the entry, then (once it has rendered) scrolls to it and highlights it briefly.
  useEffect(() => {
    if (!jump) return;
    setExpanded((prev) => (prev.has(jump.id) ? prev : new Set(prev).add(jump.id)));
    // The Collapsible opens itself from the same jump, so the entry may take
    // a frame or two to exist: look for it for a few frames.
    let frame = 0;
    let tries = 0;
    let done: ReturnType<typeof setTimeout> | undefined;
    const seek = () => {
      const el = document.getElementById(guideAnchor(jump.id));
      if (!el) {
        if (++tries < 10) frame = requestAnimationFrame(seek);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(jump.id);
      done = setTimeout(() => setFlashId(null), 1600);
    };
    frame = requestAnimationFrame(seek);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
  }, [jump]);

  const groups = useMemo(
    () =>
      GUIDE_CATEGORIES.map((category) => ({
        category,
        // Stable sort: catalog order within the seen and the unseen.
        entries: ERROR_GUIDE.filter((e) => e.category === category).sort((a, b) => Number((counts.get(b.id) ?? 0) > 0) - Number((counts.get(a.id) ?? 0) > 0)),
      })),
    [counts]
  );
  const seenKinds = [...counts.values()].filter((n) => n > 0).length;

  return (
    <Collapsible
      persistKey="errors:guide"
      openSignal={jump?.n}
      scrollOnSignal={false}
      className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 sm:px-4"
      title={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-slate-200">Common errors and how to fix them</span>
          <span className="text-xs text-slate-500">
            {seenKinds > 0 ? `${seenKinds} kind${seenKinds === 1 ? "" : "s"} in the loaded log` : `${ERROR_GUIDE.length} kinds`}
          </span>
        </span>
      }
    >
      <div className="space-y-4 pb-1">
        {groups.map(({ category, entries }) => (
          <section key={category}>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{category}</h3>
            <ul className="space-y-1.5">
              {entries.map((entry) => (
                <GuideItem
                  key={entry.id}
                  entry={entry}
                  count={counts.get(entry.id) ?? 0}
                  open={expanded.has(entry.id)}
                  flash={flashId === entry.id}
                  onToggle={() => toggle(entry.id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Collapsible>
  );
}
