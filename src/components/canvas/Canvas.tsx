import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { centerOn, DEFAULT_VIEW, type Point, type Rect, type View } from "@/lib/canvas/geometry";
import { keyToView, passedThreshold, startsPan, wheelToView, type Tool } from "@/lib/canvas/gestures";
import { t } from "@/lib/i18n";
import { Minimap } from "./Minimap";
import { ZoomControls } from "./ZoomControls";

/** What a piece inside the canvas needs: the current view (to turn screen moves into world moves) and the gesture state. */
export type CanvasState = { view: View; tool: Tool; readOnly: boolean; spaceHeld: () => boolean };
const CanvasContext = createContext<CanvasState>({ view: DEFAULT_VIEW, tool: "select", readOnly: false, spaceHeld: () => false });
export const useCanvas = () => useContext(CanvasContext);

/** World-space grid step at scale 1; the dots double their spacing when they would get closer than 10 px. */
const DOT_STEP = 24;
export function dotGrid(view: View): CSSProperties {
  let step = DOT_STEP * view.scale;
  while (step < 10) step *= 2;
  return {
    backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--color-ink-secondary) 22%, transparent) 1px, transparent 1.25px)",
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };
}

/** The floating controls over the canvas: presses there never pan. */
const CHROME = "[data-canvas-chrome]";
const EDITABLE = "input, textarea, select, [contenteditable]";
/** Inner fields that scroll on their own keep the plain wheel. */
const SCROLLS = "textarea, [data-canvas-scroll]";

type Gesture = { id: number; start: Point; view: View; moved: boolean; background: boolean };

export function Canvas({ view: controlled, onViewChange, tool, readOnly = false, rects = [], underlay, overlay, children, toolbar, bottomLeft, bottomRight, minimap = false, onBackgroundClick, label, className }: {
  view?: View;
  onViewChange?: (view: View) => void;
  tool: Tool;
  onToolChange?: (tool: Tool) => void;
  readOnly?: boolean;
  /** World rectangles "fit" frames (key 0, the fit button). */
  rects?: Rect[];
  underlay?: ReactNode;
  overlay?: ReactNode;
  children?: ReactNode;
  toolbar?: ReactNode;
  bottomLeft?: ReactNode;
  /** Bottom-right corner on a wide canvas; above the toolbar, on the right, on a narrow one. */
  bottomRight?: ReactNode;
  /** Adds a minimap toggle to the zoom pill. */
  minimap?: boolean;
  onBackgroundClick?: () => void;
  label?: string;
  className?: string;
}) {
  const [own, setOwn] = useState<View>(controlled ?? DEFAULT_VIEW);
  const view = controlled ?? own;
  const setView = (next: View) => { if (!controlled) setOwn(next); onViewChange?.(next); };
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  const [panning, setPanning] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const latest = useRef({ view, setView });
  latest.current = { view, setView };

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setViewport({ w: element.clientWidth, h: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const zooming = event.ctrlKey || event.metaKey;
      if (!zooming && (event.target as Element | null)?.closest?.(SCROLLS)) return;
      event.preventDefault();
      if (gesture.current?.moved) return;
      const bounds = element.getBoundingClientRect();
      latest.current.setView(wheelToView(latest.current.view, event, { x: bounds.left, y: bounds.top }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current || !event.isPrimary) return;
    const target = event.target as Element;
    if (target.closest(CHROME)) return;
    if (!startsPan(target, tool, event.button, space.current)) return;
    if (event.button === 1) event.preventDefault();
    gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, view, moved: false, background: !target.closest("[data-canvas-node], [data-canvas-edge], button") };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    const now = { x: event.clientX, y: event.clientY };
    if (!active.moved && !passedThreshold(active.start, now)) return;
    if (!active.moved) {
      active.moved = true;
      setPanning(true);
      // Capture only after the threshold: capturing earlier retargets a plain click to the canvas.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    setView({ ...active.view, x: active.view.x + now.x - active.start.x, y: active.view.y + now.y - active.start.y });
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    gesture.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture?.(active.id)) event.currentTarget.releasePointerCapture(active.id);
    if (cancelled && active.moved) setView(active.view);
    if (!cancelled && !active.moved && active.background) onBackgroundClick?.();
  };

  const key = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (target.closest(EDITABLE) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === " ") {
      if (target !== event.currentTarget) return;
      space.current = true;
      event.preventDefault();
      return;
    }
    if (event.key.startsWith("Arrow") && target !== event.currentTarget) return;
    const next = keyToView(view, event.key, viewport, rects);
    if (!next) return;
    event.preventDefault();
    setView(next);
  };

  const cursor = panning ? "cursor-grabbing" : tool === "hand" ? "cursor-grab" : tool === "select" ? "" : "cursor-crosshair";
  const context: CanvasState = { view, tool, readOnly, spaceHeld: () => space.current };

  return <CanvasContext.Provider value={context}>
    <div ref={root} role="region" aria-label={label ?? t("atelier.canvas.region")} tabIndex={0} data-canvas data-readonly={readOnly ? "true" : undefined}
      className={cn("relative h-full min-h-0 w-full flex-1 touch-none select-none overflow-clip bg-app outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/40", cursor, className)}
      style={dotGrid(view)}
      onPointerDown={down} onPointerMove={move} onPointerUp={(event) => up(event)} onPointerCancel={(event) => up(event, true)}
      onKeyDown={key} onKeyUp={(event) => { if (event.key === " ") space.current = false; }} onBlur={() => { space.current = false; }}>
      <div data-canvas-world className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {underlay}
        {children}
        {overlay}
      </div>
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-col-reverse gap-2 sm:inset-x-4 sm:bottom-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-end sm:gap-3">
        <div data-canvas-chrome className="flex min-w-0 flex-col items-start gap-2">
          {bottomLeft}
          {minimap && minimapOpen && <Minimap rects={rects} view={view} viewport={viewport} onJump={(point) => setView(centerOn(view, point, viewport))} />}
          <ZoomControls view={view} onChange={setView} viewport={viewport} rects={rects}
            minimapOpen={minimapOpen} onToggleMinimap={minimap ? () => setMinimapOpen((open) => !open) : undefined} />
        </div>
        <div data-canvas-chrome className="pointer-events-auto flex min-w-0 justify-center">{toolbar}</div>
        <div data-canvas-chrome="right" className="flex min-w-0 justify-end">{bottomRight}</div>
      </div>
    </div>
  </CanvasContext.Provider>;
}
