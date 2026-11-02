import { boundsOf, screenToWorld, type Point, type Rect, type View } from "./geometry";

export type MinimapTransform = { scale: number; dx: number; dy: number };

/** Scales `world` into `box`, proportions kept, centred: minimap = world * scale + d. */
export function minimapTransform(world: Rect, box: { w: number; h: number }): MinimapTransform {
  const w = Math.max(1, world.w), h = Math.max(1, world.h);
  const scale = Math.max(1e-6, Math.min(box.w / w, box.h / h));
  return { scale, dx: (box.w - w * scale) / 2 - world.x * scale, dy: (box.h - h * scale) / 2 - world.y * scale };
}

export function minimapToWorld({ scale, dx, dy }: MinimapTransform, p: Point): Point {
  return { x: (p.x - dx) / scale, y: (p.y - dy) / scale };
}

/** The part of the world on screen. */
export function visibleRect(view: View, viewport: { w: number; h: number }): Rect | null {
  if (!(viewport.w > 0) || !(viewport.h > 0)) return null;
  const a = screenToWorld(view, { x: 0, y: 0 });
  return { x: a.x, y: a.y, w: viewport.w / view.scale, h: viewport.h / view.scale };
}

/** What the minimap shows: every block and the part on screen, so the frame never leaves it. */
export function minimapWorld(rects: Rect[], view: View, viewport: { w: number; h: number }): Rect | null {
  const visible = visibleRect(view, viewport);
  return boundsOf(visible ? [...rects, visible] : rects);
}
