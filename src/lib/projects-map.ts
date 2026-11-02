import { clampScale, facingAnchors, fitRects, type View } from "./canvas/geometry";
import type { CanvasEdge } from "../components/canvas/EdgeLayer";

export type Rect = { x: number; y: number; w: number; h: number };

export const BLOCK_W = 320;
const DEFAULT_BLOCK_H = 120;
/** A card not measured yet is taken to be as tall as a closed card, so the first frame is close to the measured one. */
export const UNMEASURED_BLOCK_H = 200;

export function edgePoint(from: Rect, to: Rect, gap = 8): [number, number] {
  const ax = from.x + from.w / 2, ay = from.y + from.h / 2, dx = to.x + to.w / 2 - ax, dy = to.y + to.h / 2 - ay;
  if (!dx && !dy) return [ax, ay];
  const k = Math.min(dx ? (from.w / 2 + gap) / Math.abs(dx) : Infinity, dy ? (from.h / 2 + gap) / Math.abs(dy) : Infinity);
  return [ax + dx * k, ay + dy * k];
}

export function groupZone(rects: Rect[], pad = { x: 22, top: 52, bottom: 22 }): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x)) - pad.x, y = Math.min(...rects.map((r) => r.y)) - pad.top;
  const x2 = Math.max(...rects.map((r) => r.x + r.w)) + pad.x, y2 = Math.max(...rects.map((r) => r.y + r.h)) + pad.bottom;
  return { x, y, w: x2 - x, h: y2 - y };
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

export function arrangeByGroup(
  buckets: { id: string; h: number }[][],
  opts = { perRow: 4, step: 380, rowGap: 36, groupGap: 150, x0: 60, y0: 90 },
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  let y = opts.y0;
  for (const list of buckets) {
    if (!list.length) continue;
    let x = opts.x0, h = 0;
    list.forEach((block, i) => {
      if (i && i % opts.perRow === 0) { y += h + opts.rowGap; x = opts.x0; h = 0; }
      out[block.id] = { x, y };
      x += opts.step; h = Math.max(h, block.h);
    });
    y += h + opts.groupGap;
  }
  return out;
}

/** Where block `index` sits: its saved position, or a spot in a grid; its size once measured. */
export function blockRect(pos: Record<string, { x: number; y: number }>, id: string, index: number, size: { w: number; h: number } | undefined): Rect {
  const at = Object.hasOwn(pos, id) ? pos[id]! : { x: 50 + (index % 4) * 380, y: 50 + Math.floor(index / 4) * 400 };
  return { x: at.x, y: at.y, w: size?.w ?? BLOCK_W, h: size?.h ?? DEFAULT_BLOCK_H };
}

/**
 * Every block's rectangle: a saved position stays; the others fill a 4-column grid whose rows are as tall as their tallest block
 * plus what hangs under it (`below`, e.g. the workflows under a project), so nothing overlaps the next row.
 */
export function blockRects(pos: Record<string, { x: number; y: number }>, ids: readonly string[], sizes: Record<string, { w: number; h: number } | undefined>,
  below: Readonly<Record<string, number>> = {}): Map<string, Rect> {
  const free = ids.filter((id) => !Object.hasOwn(pos, id));
  const grid = arrangeByGroup([free.map((id) => ({ id, h: (sizes[id]?.h ?? UNMEASURED_BLOCK_H) + (below[id] ?? 0) }))], { perRow: 4, step: 380, rowGap: 40, groupGap: 0, x0: 50, y0: 50 });
  return new Map(ids.map((id, index) => [id, blockRect(Object.hasOwn(pos, id) ? pos : grid, id, index, sizes[id])]));
}

/** The first view of the map: the one this device remembers, else the saved zoom from the top-left corner,
 * as the map used to open; fitted instead when some block would be off screen that way. */
export function openingView(stored: View | null, zoom: number, rects: Rect[], viewport: { w: number; h: number }): View {
  if (stored) return stored;
  const view = { x: 0, y: 0, scale: clampScale(zoom) };
  const seen = (r: Rect) => r.x * view.scale >= 0 && r.y * view.scale >= 0 && (r.x + r.w) * view.scale <= viewport.w && (r.y + r.h) * view.scale <= viewport.h;
  if (!rects.length || !(viewport.w > 0) || rects.every(seen)) return view;
  return fitRects(rects, viewport);
}

export function placeBlock<S extends { pos: Record<string, { x: number; y: number }> }>(state: S, id: string, x: number, y: number): S {
  return { ...state, pos: { ...state.pos, [id]: { x: Math.round(x), y: Math.round(y) } } };
}

/** The map's links as canvas edges, keyed by their index in `links`; a link to a block that is gone is left out. */
export function linkEdges(links: readonly { a: string; b: string; label: string }[], rects: ReadonlyMap<string, Rect>): CanvasEdge[] {
  return links.flatMap((link, index) => {
    const a = rects.get(link.a), b = rects.get(link.b);
    if (!a || !b) return [];
    const [from, to] = facingAnchors(a, b);
    return [{ id: String(index), from, to, label: link.label || undefined, arrow: "end" as const }];
  });
}

