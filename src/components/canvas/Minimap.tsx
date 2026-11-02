import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import type { Point, Rect, View } from "@/lib/canvas/geometry";
import { minimapToWorld, minimapTransform, minimapWorld, visibleRect } from "@/lib/canvas/minimap";
import { t } from "@/lib/i18n";

const BOX = { w: 184, h: 116 };
const INSET = 8;

/** Overview of the blocks with the part on screen framed; pressing or dragging in it moves the view there. */
export function Minimap({ rects, view, viewport, onJump }: { rects: Rect[]; view: View; viewport: { w: number; h: number }; onJump: (world: Point) => void }) {
  const dragging = useRef<number | null>(null);
  const world = minimapWorld(rects, view, viewport);
  const inner = { w: BOX.w - 2 * INSET, h: BOX.h - 2 * INSET };
  const transform = world ? minimapTransform(world, inner) : null;
  const visible = visibleRect(view, viewport);
  const toBox = (r: Rect) => transform && { x: INSET + r.x * transform.scale + transform.dx, y: INSET + r.y * transform.scale + transform.dy, w: r.w * transform.scale, h: r.h * transform.scale };
  const jump = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!transform) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onJump(minimapToWorld(transform, { x: event.clientX - bounds.left - INSET, y: event.clientY - bounds.top - INSET }));
  };
  const frame = visible && toBox(visible);
  return <div className="pointer-events-auto overflow-hidden rounded-xl border border-hairline/70 bg-panel">
    <svg role="img" aria-label={t("atelier.canvas.minimap")} width={BOX.w} height={BOX.h} className="block cursor-pointer touch-none"
      onPointerDown={(event) => { if (event.button !== 0) return; dragging.current = event.pointerId; event.currentTarget.setPointerCapture?.(event.pointerId); jump(event); }}
      onPointerMove={(event) => { if (dragging.current === event.pointerId) jump(event); }}
      onPointerUp={(event) => { if (dragging.current === event.pointerId) dragging.current = null; }}
      onPointerCancel={() => { dragging.current = null; }}>
      {rects.map((rect, index) => {
        const r = toBox(rect);
        return r && <rect key={index} x={r.x} y={r.y} width={Math.max(2, r.w)} height={Math.max(2, r.h)} rx={2}
          style={{ fill: "color-mix(in srgb, var(--color-ink-secondary) 30%, transparent)" }} />;
      })}
      {frame && <rect data-minimap-frame x={frame.x} y={frame.y} width={frame.w} height={frame.h} rx={3} fill="none" strokeWidth={1}
        style={{ stroke: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }} />}
    </svg>
  </div>;
}
