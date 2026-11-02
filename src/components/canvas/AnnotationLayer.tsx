import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Circle, Diamond, Square, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Point } from "@/lib/canvas/geometry";
import { passedThreshold, type Tool } from "@/lib/canvas/gestures";
import {
  SHAPES, STICKY_COLORS, TEXT_FONT_PX, TEXT_SIZES, annotationBounds, cleanNoteText, moveAnnotation, newAnnotationId, placeSticky, placeText, shapeBetween,
  strokeFrom, type Annotation,
} from "@/lib/canvas/model";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useCanvas } from "./Canvas";

const DRAWING: readonly Tool[] = ["sticky", "text", "shape", "pencil"];
/** Half the side of the surface laid over the world while drawing: wide enough to cover the screen at the smallest scale. */
const REACH = 100_000;

const SHAPE_ICONS = { rect: Square, ellipse: Circle, diamond: Diamond } as const;
const SHAPE_LABELS: Record<(typeof SHAPES)[number], LocaleKey> = { rect: "atelier.shape.rect", ellipse: "atelier.shape.ellipse", diamond: "atelier.shape.diamond" };
const SIZE_PREVIEW_PX = { s: 10, m: 13, l: 17 } as const;
const SIZE_LABELS: Record<(typeof TEXT_SIZES)[number], LocaleKey> = { s: "atelier.text.size.s", m: "atelier.text.size.m", l: "atelier.text.size.l" };

const tone = (color: string) => `var(--color-${color})`;
const stickyStyle = (color: string): CSSProperties => ({
  background: `color-mix(in srgb, ${tone(color)} 16%, var(--color-card))`,
  borderColor: `color-mix(in srgb, ${tone(color)} 45%, transparent)`,
});
const LINE = "color-mix(in srgb, var(--color-ink-secondary) 75%, transparent)";

export function shapePath(a: Extract<Annotation, { kind: "shape" }>): string {
  const { x, y, w, h } = a;
  if (a.shape === "diamond") return `M${x + w / 2} ${y} L${x + w} ${y + h / 2} L${x + w / 2} ${y + h} L${x} ${y + h / 2} Z`;
  return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
}

export const inkPath = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join(" ");

type Draft = { id: number; start: Point; now: Point; points: Point[]; moved: boolean };
type Move = { id: number; item: string; start: Point; scale: number; moved: boolean; dx: number; dy: number };

/** Notes, texts, shapes and pencil strokes, in world coordinates; put it in the canvas `overlay`. */
export function AnnotationLayer({ items, tool, selectedId, onChange, onSelect, onTool, readOnly = false }: {
  items: Annotation[];
  tool: Tool;
  selectedId: string | null;
  onChange: (items: Annotation[]) => void;
  onSelect: (id: string | null) => void;
  /** Called to go back to the select tool once a note, a text or a shape is placed. */
  onTool?: (tool: Tool) => void;
  readOnly?: boolean;
}) {
  const canvas = useCanvas();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [moving, setMoving] = useState<Move | null>(null);
  const move = useRef<Move | null>(null);
  const elements = useRef(new Map<string, HTMLElement | SVGElement>());
  const live = !readOnly && tool === "select";

  useEffect(() => {
    if (!selectedId || editing === selectedId) return;
    elements.current.get(selectedId)?.focus({ preventScroll: true });
  }, [selectedId, editing]);

  const replace = (next: Annotation) => onChange(items.map((item) => (item.id === next.id ? next : item)));
  const remove = (id: string) => { onChange(items.filter((item) => item.id !== id)); onSelect(null); setEditing(null); };
  const add = (item: Annotation, edit: boolean) => {
    onChange([...items, item]);
    onSelect(item.id);
    if (edit) setEditing(item.id);
  };

  const worldPoint = (event: ReactPointerEvent<HTMLElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) / canvas.view.scale - REACH, y: (event.clientY - box.top) / canvas.view.scale - REACH };
  };
  const drawDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || canvas.spaceHeld()) return;
    event.stopPropagation();
    const p = worldPoint(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraft({ id: event.pointerId, start: p, now: p, points: [p], moved: false });
  };
  const drawMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft || draft.id !== event.pointerId) return;
    const p = worldPoint(event);
    const moved = draft.moved || passedThreshold({ x: draft.start.x * canvas.view.scale, y: draft.start.y * canvas.view.scale }, { x: p.x * canvas.view.scale, y: p.y * canvas.view.scale });
    const last = draft.points[draft.points.length - 1]!;
    const far = Math.hypot(p.x - last.x, p.y - last.y) * canvas.view.scale >= 1;
    setDraft({ ...draft, now: p, moved, points: tool === "pencil" && far ? [...draft.points, p] : draft.points });
  };
  const drawUp = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!draft || draft.id !== event.pointerId) return;
    setDraft(null);
    if (cancelled) return;
    const id = newAnnotationId();
    if (tool === "sticky" && !draft.moved) { add(placeSticky(id, draft.start), true); onTool?.("select"); }
    if (tool === "text" && !draft.moved) { add(placeText(id, draft.start), true); onTool?.("select"); }
    if (tool === "shape") {
      const shape = shapeBetween(id, draft.start, draft.now);
      if (shape) { add(shape, false); onTool?.("select"); }
    }
    if (tool === "pencil") {
      const stroke = strokeFrom(id, draft.points);
      if (stroke) onChange([...items, stroke]);
    }
  };

  const pressItem = (event: ReactPointerEvent<Element>, item: Annotation) => {
    if (!live || event.button !== 0 || !event.isPrimary || canvas.spaceHeld() || editing === item.id) return;
    onSelect(item.id);
    move.current = { id: event.pointerId, item: item.id, start: { x: event.clientX, y: event.clientY }, scale: canvas.view.scale, moved: false, dx: 0, dy: 0 };
  };
  const dragItem = (event: ReactPointerEvent<Element>) => {
    const active = move.current;
    if (!active || active.id !== event.pointerId) return;
    const now = { x: event.clientX, y: event.clientY };
    if (!active.moved && !passedThreshold(active.start, now)) return;
    if (!active.moved) { active.moved = true; event.currentTarget.setPointerCapture?.(event.pointerId); }
    active.dx = (now.x - active.start.x) / active.scale;
    active.dy = (now.y - active.start.y) / active.scale;
    setMoving({ ...active });
  };
  const dropItem = (event: ReactPointerEvent<Element>, cancelled = false) => {
    const active = move.current;
    if (!active || active.id !== event.pointerId) return;
    move.current = null;
    setMoving(null);
    if (event.currentTarget.hasPointerCapture?.(active.id)) event.currentTarget.releasePointerCapture(active.id);
    if (!active.moved || cancelled) return;
    const item = items.find((i) => i.id === active.item);
    if (item) replace(moveAnnotation(item, Math.round(active.dx), Math.round(active.dy)));
  };
  const keyItem = (event: ReactKeyboardEvent<Element>, item: Annotation) => {
    if (!live || editing === item.id) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); remove(item.id); }
    if (event.key === "Enter" && (item.kind === "sticky" || item.kind === "text")) { event.preventDefault(); setEditing(item.id); }
    if (event.key === "Escape") onSelect(null);
  };
  const handlers = (item: Annotation) => ({
    "data-canvas-annotation": item.id,
    "data-selected": selectedId === item.id ? "true" : undefined,
    tabIndex: live ? 0 : undefined,
    ref: (el: HTMLElement | SVGElement | null) => { if (el) elements.current.set(item.id, el); else elements.current.delete(item.id); },
    onPointerDown: (event: ReactPointerEvent<Element>) => pressItem(event, item),
    onPointerMove: dragItem,
    onPointerUp: (event: ReactPointerEvent<Element>) => dropItem(event),
    onPointerCancel: (event: ReactPointerEvent<Element>) => dropItem(event, true),
    onKeyDown: (event: ReactKeyboardEvent<Element>) => keyItem(event, item),
    onDoubleClick: () => { if (live && (item.kind === "sticky" || item.kind === "text")) setEditing(item.id); },
  });

  const shown = (item: Annotation) => (moving?.item === item.id ? moveAnnotation(item, moving.dx, moving.dy) : item);
  const vectors = items.filter((item) => item.kind === "shape" || item.kind === "ink");
  const boxes = items.filter((item) => item.kind === "sticky" || item.kind === "text");
  const selected = items.find((item) => item.id === selectedId);
  const draftShape = draft && tool === "shape" ? shapeBetween("draft", draft.start, draft.now) : null;

  return <>
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
      {vectors.map((raw) => {
        const item = shown(raw);
        const isSelected = selectedId === item.id;
        const stroke = isSelected ? "var(--color-accent)" : item.kind === "ink" ? "var(--color-ink)" : LINE;
        const d = item.kind === "ink" ? inkPath(item.points) : item.shape === "ellipse" ? null : shapePath(item as Extract<Annotation, { kind: "shape" }>);
        const hit = live ? { stroke: "transparent", strokeWidth: 14, style: { pointerEvents: "stroke" as const }, className: "cursor-pointer" } : null;
        return <g key={item.id} {...handlers(item)} role={live ? "button" : undefined} aria-label={live ? t(item.kind === "ink" ? "atelier.annotation.ink" : SHAPE_LABELS[(item as Extract<Annotation, { kind: "shape" }>).shape]) : undefined}
          className="outline-none">
          {item.kind === "shape" && item.shape === "ellipse"
            ? <>
              <ellipse cx={item.x + item.w / 2} cy={item.y + item.h / 2} rx={item.w / 2} ry={item.h / 2} fill="none" strokeWidth={1.5} style={{ stroke }} />
              {hit && <ellipse cx={item.x + item.w / 2} cy={item.y + item.h / 2} rx={item.w / 2} ry={item.h / 2} fill="none" {...hit} />}
            </>
            : <>
              <path d={d!} fill="none" strokeWidth={item.kind === "ink" ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke }} />
              {hit && <path d={d!} fill="none" {...hit} />}
            </>}
        </g>;
      })}
      {draftShape && draftShape.kind === "shape" && <path d={shapePath(draftShape)} fill="none" strokeWidth={1.5} strokeDasharray="4 4" style={{ stroke: "var(--color-accent)" }} />}
      {draft && tool === "pencil" && draft.points.length > 1 && <path d={inkPath(draft.points)} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--color-ink)" }} />}
    </svg>

    {boxes.map((raw) => {
      const item = shown(raw);
      const isSelected = selectedId === item.id;
      const isEditing = editing === item.id;
      const write = (value: string) => replace({ ...item, text: cleanNoteText(value) } as Annotation);
      const done = () => { setEditing(null); if (item.kind === "text" && !item.text.trim()) remove(item.id); };
      if (item.kind === "sticky") {
        return <div key={item.id} {...handlers(item)} role={live ? "button" : undefined} aria-label={live ? t("atelier.annotation.note") : undefined}
          className={cn("absolute flex rounded-[10px] border p-2.5 text-[13px] leading-[18px] text-ink outline-none",
            live ? "pointer-events-auto cursor-grab" : "pointer-events-none", isSelected && "ring-2 ring-focus/60")}
          style={{ left: item.x, top: item.y, width: item.w, height: item.h, ...stickyStyle(item.color) }}>
          {isEditing
            ? <textarea autoFocus value={item.text} maxLength={2000} placeholder={t("atelier.note.placeholder")} onChange={(event) => write(event.target.value)} onBlur={done}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); done(); } }}
              className="h-full w-full resize-none bg-transparent text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-tertiary" />
            : <p className={cn("min-h-0 w-full overflow-hidden whitespace-pre-wrap break-words", !item.text && "text-ink-tertiary")}>{item.text || t("atelier.note.placeholder")}</p>}
        </div>;
      }
      const font = TEXT_FONT_PX[item.size];
      const lines = item.text.split("\n");
      return <div key={item.id} {...handlers(item)} role={live ? "button" : undefined} aria-label={live ? t("atelier.annotation.text") : undefined}
        className={cn("absolute rounded-md font-semibold text-ink outline-none", live ? "pointer-events-auto cursor-grab" : "pointer-events-none", isSelected && "ring-2 ring-focus/60")}
        style={{ left: item.x, top: item.y, fontSize: font, lineHeight: 1.3 }}>
        {isEditing
          ? <textarea autoFocus value={item.text} maxLength={2000} placeholder={t("atelier.text.placeholder")} rows={lines.length} onChange={(event) => write(event.target.value)} onBlur={done}
            onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); done(); } }}
            style={{ width: `${Math.max(6, ...lines.map((line) => line.length)) + 1}ch` }}
            className="block resize-none overflow-hidden bg-transparent font-semibold text-ink outline-none placeholder:text-ink-tertiary" />
          : <p className="whitespace-pre">{item.text}</p>}
      </div>;
    })}

    {live && selected && !moving && <SelectionBar item={selected} onChange={replace} onRemove={() => remove(selected.id)} />}

    {!readOnly && DRAWING.includes(tool) && <div data-annotation-capture aria-hidden className="pointer-events-auto absolute cursor-crosshair touch-none"
      style={{ left: -REACH, top: -REACH, width: 2 * REACH, height: 2 * REACH }}
      onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={(event) => drawUp(event)} onPointerCancel={(event) => drawUp(event, true)} />}
  </>;
}

const barButton = "grid size-7 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-focus";

function SelectionBar({ item, onChange, onRemove }: { item: Annotation; onChange: (item: Annotation) => void; onRemove: () => void }) {
  const b = annotationBounds(item);
  return <div data-annotation-actions role="group" aria-label={t("atelier.annotation.actions")} onPointerDown={(event) => event.stopPropagation()}
    className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-xl border border-hairline/80 bg-panel p-0.5"
    style={{ left: b.x + b.w / 2, top: b.y - 10 }}>
    {item.kind === "sticky" && STICKY_COLORS.map((color, index) => (
      <button key={color} type="button" aria-pressed={item.color === color} aria-label={t("atelier.note.color", { n: index + 1 })} title={t("atelier.note.color", { n: index + 1 })}
        className={cn(barButton, item.color === color && "bg-control")} onClick={() => onChange({ ...item, color })}>
        <span className="size-3.5 rounded-full border" style={stickyStyle(color)} />
      </button>
    ))}
    {item.kind === "shape" && SHAPES.map((shape) => {
      const Icon = SHAPE_ICONS[shape];
      return <button key={shape} type="button" aria-pressed={item.shape === shape} aria-label={t(SHAPE_LABELS[shape])} title={t(SHAPE_LABELS[shape])}
        className={cn(barButton, item.shape === shape && "bg-control text-ink")} onClick={() => onChange({ ...item, shape })}><Icon size={14} /></button>;
    })}
    {item.kind === "text" && TEXT_SIZES.map((size) => (
      <button key={size} type="button" aria-pressed={item.size === size} aria-label={t(SIZE_LABELS[size])} title={t(SIZE_LABELS[size])}
        className={cn(barButton, "font-semibold", item.size === size && "bg-control text-ink")} onClick={() => onChange({ ...item, size })}>
        <span aria-hidden style={{ fontSize: SIZE_PREVIEW_PX[size] }}>A</span>
      </button>
    ))}
    {item.kind !== "ink" && <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline" />}
    <button type="button" aria-label={t("atelier.annotation.remove")} title={t("atelier.annotation.remove")} className={cn(barButton, "hover:text-danger")} onClick={onRemove}><Trash2 size={14} /></button>
  </div>;
}
