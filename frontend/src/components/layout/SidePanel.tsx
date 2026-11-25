import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampSidePanelWidth, loadSidePanelWidth, saveSidePanelWidth, SIDE_PANEL_MIN_PX, sidePanelMax } from "../../lib/side-panel-width.js";
import { Rail, RailSizer } from "./Rail.js";

/** A press that moves less than this is a click (half of a double-click), not a drag. */
const DRAG_THRESHOLD_PX = 3;
const KEY_STEP_PX = 16;

/**
 * The wide layout's Rail, in a panel as wide as its widest row (up to a
 * quarter of the page), or as wide as the user dragged its edge.
 *
 * The automatic width is all CSS: the Rail is positioned absolutely, so only
 * RailSizer's hidden rows give the panel a width. A dragged width is clamped in
 * CSS too, so a smaller window limits it without forgetting it.
 */
export function SidePanel() {
  const [width, setWidth] = useState<number | null>(loadSidePanelWidth);
  const [dragging, setDragging] = useState(false);
  // What the panel really measures, for the separator's aria-valuenow.
  const [measured, setMeasured] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; width: number | null } | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setMeasured(Math.round(panel.getBoundingClientRect().width)));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const currentWidth = () => panelRef.current?.getBoundingClientRect().width ?? SIDE_PANEL_MIN_PX;

  function choose(next: number | null) {
    setWidth(next);
    saveSidePanelWidth(next);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || drag.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: currentWidth(), width: null };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    if (d.width === null && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    d.width = clampSidePanelWidth(d.startWidth + dx, window.innerWidth);
    setDragging(true);
    setWidth(d.width);
  }

  // Also the end of a drag the browser cancels: lostpointercapture follows pointerup and pointercancel.
  function endDrag(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (d.width !== null) saveSidePanelWidth(d.width);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const page = window.innerWidth;
    const next =
      e.key === "ArrowLeft"
        ? currentWidth() - KEY_STEP_PX
        : e.key === "ArrowRight"
          ? currentWidth() + KEY_STEP_PX
          : e.key === "Home"
            ? SIDE_PANEL_MIN_PX
            : e.key === "End"
              ? sidePanelMax(page)
              : e.key === "Enter"
                ? null
                : undefined;
    if (next === undefined) return;
    e.preventDefault();
    choose(next === null ? null : clampSidePanelWidth(next, page));
  }

  return (
    <aside
      ref={panelRef}
      className={`relative flex-shrink-0 border-r border-slate-800 ${width === null ? "w-max min-w-64 max-w-[25%]" : "min-w-48 max-w-[50%]"}`}
      style={width === null ? undefined : { width }}
    >
      <div className="absolute inset-0">
        <Rail />
      </div>
      {width === null && <RailSizer />}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the side panel"
        aria-valuenow={measured}
        aria-valuemin={SIDE_PANEL_MIN_PX}
        aria-valuemax={sidePanelMax(window.innerWidth)}
        tabIndex={0}
        title="Drag to resize; double-click to fit the content"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() => choose(null)}
        onKeyDown={onKeyDown}
        // Mostly outside the panel, so it doesn't cover the instance list's scrollbar.
        className={`absolute inset-y-0 left-full z-20 -ml-0.5 w-2 cursor-col-resize touch-none select-none outline-none hover:bg-sky-500/40 focus-visible:bg-sky-500/60 ${
          dragging ? "bg-sky-500/60" : ""
        }`}
      />
    </aside>
  );
}
