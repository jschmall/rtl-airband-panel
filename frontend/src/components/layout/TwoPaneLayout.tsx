import { useCallback, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { InstanceSidebar } from "../InstanceSidebar.js";

const STORAGE_KEY = "rtl-panel-sidebar-width";
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 220;
const MAX_WIDTH = 560;

function clamp(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function loadStoredWidth(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_WIDTH;
}

export function TwoPaneLayout() {
  const [width, setWidth] = useState(loadStoredWidth);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setWidth(clamp(e.clientX - rect.left));
  }, []);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setWidth((current) => {
      localStorage.setItem(STORAGE_KEY, String(current));
      return current;
    });
  }, []);

  return (
    <div ref={containerRef} className="flex h-full">
      <div style={{ width }} className="flex-shrink-0 overflow-y-auto border-r border-slate-800">
        <InstanceSidebar />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="w-1 flex-shrink-0 cursor-col-resize bg-slate-800 hover:bg-sky-600 active:bg-sky-600"
      />
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}
