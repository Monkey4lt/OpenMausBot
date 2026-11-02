export type Point = { x: number; y: number };
export type View = { x: number; y: number; scale: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Side = "left" | "right" | "top" | "bottom";
export type PortAnchor = Point & { side: Side };

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2.5;
export const DEFAULT_VIEW: View = { x: 0, y: 0, scale: 1 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToWorld(view: View, p: Point): Point {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
}

export function worldToScreen(view: View, p: Point): Point {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y };
}

export function zoomAt(view: View, factor: number, at: Point): View {
  const scale = clampScale(view.scale * factor);
  const world = screenToWorld(view, at);
  return { x: at.x - world.x * scale, y: at.y - world.y * scale, scale };
}

export function centerOn(view: View, point: Point, viewport: { w: number; h: number }): View {
  return { x: viewport.w / 2 - point.x * view.scale, y: viewport.h / 2 - point.y * view.scale, scale: view.scale };
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.x); top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.w); bottom = Math.max(bottom, r.y + r.h);
  }
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function fitRects(rects: Rect[], viewport: { w: number; h: number }, padding = 48): View {
  const b = boundsOf(rects);
  if (!b || !(viewport.w > 0) || !(viewport.h > 0)) return DEFAULT_VIEW;
  const room = (size: number) => Math.max(1, size - 2 * padding);
  const fit = Math.min(1, b.w > 0 ? room(viewport.w) / b.w : 1, b.h > 0 ? room(viewport.h) / b.h : 1);
  const scale = clampScale(fit);
  return { x: (viewport.w - b.w * scale) / 2 - b.x * scale, y: (viewport.h - b.h * scale) / 2 - b.y * scale, scale };
}

export function portPoint(rect: Rect, side: Side, index = 0, count = 1): Point {
  const along = (index + 1) / (Math.max(1, count) + 1);
  switch (side) {
    case "left": return { x: rect.x, y: rect.y + rect.h * along };
    case "right": return { x: rect.x + rect.w, y: rect.y + rect.h * along };
    case "top": return { x: rect.x + rect.w * along, y: rect.y };
    case "bottom": return { x: rect.x + rect.w * along, y: rect.y + rect.h };
  }
}

const OUTWARD: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

function controlPoints(from: PortAnchor, to: PortAnchor): [Point, Point] {
  const reach = Math.min(200, Math.max(30, Math.hypot(to.x - from.x, to.y - from.y) / 2));
  const a = OUTWARD[from.side], b = OUTWARD[to.side];
  return [{ x: from.x + a.x * reach, y: from.y + a.y * reach }, { x: to.x + b.x * reach, y: to.y + b.y * reach }];
}

const num = (n: number) => String(Math.round(n * 10) / 10);

export function bezierPath(from: PortAnchor, to: PortAnchor): string {
  const [c1, c2] = controlPoints(from, to);
  return `M${num(from.x)} ${num(from.y)} C${num(c1.x)} ${num(c1.y)}, ${num(c2.x)} ${num(c2.y)}, ${num(to.x)} ${num(to.y)}`;
}

export function edgeLabelPoint(from: PortAnchor, to: PortAnchor): Point {
  const [c1, c2] = controlPoints(from, to);
  return { x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8, y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8 };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker, iterative so a long stroke cannot overflow the stack. */
export function simplifyStroke(points: Point[], tolerance = 1.5): Point[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let farthest = -1, distance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[i], points[first], points[last]);
      if (d > distance) { distance = d; farthest = i; }
    }
    if (farthest >= 0) { keep[farthest] = 1; stack.push([first, farthest], [farthest, last]); }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ x: p.x, y: p.y }));
}
