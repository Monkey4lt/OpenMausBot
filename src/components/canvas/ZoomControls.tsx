import { Compass, Maximize, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/cn";
import { fitRects, zoomAt, type Rect, type View } from "@/lib/canvas/geometry";
import { ZOOM_STEP } from "@/lib/canvas/gestures";
import { t } from "@/lib/i18n";

export const pillButton = "grid size-7 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40";

/** Bottom-left pill: − percentage + | fit | minimap. A click on the percentage also fits. */
export function ZoomControls({ view, onChange, viewport, rects, minimapOpen, onToggleMinimap }: {
  view: View;
  onChange: (view: View) => void;
  viewport: { w: number; h: number };
  rects: Rect[];
  minimapOpen?: boolean;
  onToggleMinimap?: () => void;
}) {
  const percent = Math.round(view.scale * 100);
  const centre = { x: viewport.w / 2, y: viewport.h / 2 };
  const fit = () => onChange(fitRects(rects, viewport));
  return <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-hairline/70 bg-panel p-1">
    <button type="button" className={pillButton} aria-label={t("atelier.canvas.zoomOut")} title={t("atelier.canvas.zoomOut")}
      onClick={() => onChange(zoomAt(view, 1 / ZOOM_STEP, centre))}><Minus size={14} /></button>
    <button type="button" className="h-7 min-w-11 rounded-lg px-1 text-[12px] font-medium tabular-nums text-ink hover:bg-control focus-visible:outline-2 focus-visible:outline-focus"
      aria-label={t("atelier.canvas.zoomLevel", { percent })} onClick={fit}>{percent}%</button>
    <button type="button" className={pillButton} aria-label={t("atelier.canvas.zoomIn")} title={t("atelier.canvas.zoomIn")}
      onClick={() => onChange(zoomAt(view, ZOOM_STEP, centre))}><Plus size={14} /></button>
    <span aria-hidden className="mx-1 h-4 w-px bg-hairline" />
    <button type="button" className={pillButton} aria-label={t("atelier.canvas.fit")} title={t("atelier.canvas.fit")} onClick={fit}><Maximize size={14} /></button>
    {onToggleMinimap && <button type="button" className={cn(pillButton, minimapOpen && "bg-control text-ink")} aria-pressed={minimapOpen ?? false}
      aria-label={t("atelier.canvas.showMinimap")} title={t("atelier.canvas.minimap")} onClick={onToggleMinimap}><Compass size={14} /></button>}
  </div>;
}
