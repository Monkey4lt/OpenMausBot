export type Rect = { x: number; y: number; w: number; h: number };

/** A dot grid in the theme's hairline color; `local` makes it scroll with the map. */
export const DOT_GRID_STYLE = {
  backgroundImage: "radial-gradient(circle at 1px 1px, var(--color-hairline) 1px, transparent 1.5px)",
  backgroundSize: "22px 22px",
  backgroundAttachment: "local",
} as const;

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

/** The zoom that shows all of `content` inside `view` with `pad` around it, never enlarging past `max`. */
export function fitZoom(content: Rect | null, view: { w: number; h: number }, opts = { pad: 48, min: 0.3, max: 1 }): number {
  if (!content || content.w <= 0 || content.h <= 0 || view.w <= 0 || view.h <= 0) return opts.max;
  const z = Math.min((view.w - 2 * opts.pad) / content.w, (view.h - 2 * opts.pad) / content.h);
  return +Math.min(opts.max, Math.max(opts.min, z)).toFixed(2);
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
