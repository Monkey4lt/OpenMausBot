import { clampScale, fitRects, zoomAt, type Point, type Rect, type View } from "./geometry";

export type Tool = "select" | "hand" | "pencil" | "sticky" | "shape" | "text";
export type WheelInput = { deltaX: number; deltaY: number; deltaMode?: number; ctrlKey: boolean; metaKey: boolean; clientX: number; clientY: number };

export const PAN_STEP = 60;
export const ZOOM_STEP = 1.2;
/** Pixels per wheel "line" (deltaMode 1) and per "page" (deltaMode 2). */
const LINE_PX = 16;
const PAGE_PX = 400;
/** exp(-deltaY * k): a 100 px mouse notch is about ×1.65, a trackpad pinch step of 8 px about ×1.04. */
const ZOOM_SPEED = 0.005;
/** One event never zooms more than ×2 or less than ×½, whatever the device sends. */
const MAX_EVENT_FACTOR = 2;

/** Elements a press must reach unhindered: never the start of a pan with the select tool. */
export const INTERACTIVE = "button, input, textarea, select, a, [contenteditable], [data-canvas-node], [data-canvas-edge]";

export function wheelToView(view: View, e: WheelInput, origin: Point): View {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
  const dx = (Number.isFinite(e.deltaX) ? e.deltaX : 0) * unit;
  const dy = (Number.isFinite(e.deltaY) ? e.deltaY : 0) * unit;
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.min(MAX_EVENT_FACTOR, Math.max(1 / MAX_EVENT_FACTOR, Math.exp(-dy * ZOOM_SPEED)));
    return zoomAt(view, factor, { x: e.clientX - origin.x, y: e.clientY - origin.y });
  }
  return { x: view.x - dx, y: view.y - dy, scale: view.scale };
}

export function keyToView(view: View, key: string, viewport: { w: number; h: number }, rects: Rect[] = []): View | null {
  const centre = { x: viewport.w / 2, y: viewport.h / 2 };
  switch (key) {
    case "ArrowLeft": return { ...view, x: view.x + PAN_STEP };
    case "ArrowRight": return { ...view, x: view.x - PAN_STEP };
    case "ArrowUp": return { ...view, y: view.y + PAN_STEP };
    case "ArrowDown": return { ...view, y: view.y - PAN_STEP };
    case "+": case "=": return zoomAt(view, ZOOM_STEP, centre);
    case "-": case "_": return zoomAt(view, 1 / ZOOM_STEP, centre);
    case "0": return fitRects(rects, viewport);
    default: return null;
  }
}

/** Whether a press on `target` drags the view. Middle button and space always pan; the hand tool pans from anywhere;
 * the select tool pans only from the background; drawing tools never pan from a primary press. */
export function startsPan(target: { closest(sel: string): unknown } | null, tool: Tool, button: number, spaceHeld: boolean): boolean {
  if (button === 1) return true;
  if (button !== 0) return false;
  if (spaceHeld || tool === "hand") return true;
  if (tool !== "select") return false;
  return !target?.closest(INTERACTIVE);
}

export function passedThreshold(start: Point, now: Point, px = 5): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= px;
}

/** A view saved in localStorage, or null when it is missing or not a finite view. */
export function parseStoredView(raw: string | null | undefined): View | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { x, y, scale } = value as Record<string, unknown>;
  if (![x, y, scale].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if ((scale as number) <= 0) return null;
  return { x: x as number, y: y as number, scale: clampScale(scale as number) };
}

