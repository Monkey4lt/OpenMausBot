import { Fragment, useRef, type ButtonHTMLAttributes, type Ref, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Check, Copy, Lock, LockKeyhole, Play, Trash2, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { portPoint, type PortAnchor, type Point, type Rect, type Side } from "@/lib/canvas/geometry";
import { passedThreshold } from "@/lib/canvas/gestures";
import { t } from "@/lib/i18n";
import { useCanvas } from "./Canvas";

export type NodePort = { side: Side; id: string; kind?: "text" | "yes" | "no" };
export type NodeActions = { onDuplicate?: () => void; onToggleLock?: () => void; onDelete?: () => void };

/** Port badges sit just outside the card: their centre is this far from the edge. */
export const PORT_SIZE = 26;
export const PORT_OFFSET = 20;
const OUT: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

/** Where a link meets port `index` of `count` on `side` of a block: the centre of its badge. */
export function portAnchor(rect: Rect, side: Side, index = 0, count = 1): PortAnchor {
  const p = portPoint(rect, side, index, count);
  return { x: p.x + OUT[side].x * PORT_OFFSET, y: p.y + OUT[side].y * PORT_OFFSET, side };
}

/** Anchors of every port of a block, by port id, laid out the way NodeFrame draws them. */
export function portAnchors(rect: Rect, ports: NodePort[]): Record<string, PortAnchor> {
  const out: Record<string, PortAnchor> = {};
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const onSide = ports.filter((port) => port.side === side);
    onSide.forEach((port, index) => { out[port.id] = portAnchor(rect, side, index, onSide.length); });
  }
  return out;
}

const PORT_GLYPH: Record<NonNullable<NodePort["kind"]>, { icon: LucideIcon | null; label: "atelier.canvas.port.text" | "atelier.canvas.port.yes" | "atelier.canvas.port.no" }> = {
  text: { icon: null, label: "atelier.canvas.port.text" },
  yes: { icon: Check, label: "atelier.canvas.port.yes" },
  no: { icon: X, label: "atelier.canvas.port.no" },
};

/** Presses here belong to the control, never to a block drag. */
const OWN_PRESS = "button, input, textarea, select, a, [contenteditable], [data-canvas-port], [data-node-actions], [data-canvas-scroll]";

type Drag = { id: number; start: Point; origin: Point; scale: number; moved: boolean; last: Point };

export function NodeFrame({ id, rect, selected, locked, ports = [], onMove, onMoveEnd, onSelect, actions, label, children, className, cardClassName, autoHeight = false, nodeRef }: {
  id: string;
  rect: Rect;
  selected: boolean;
  locked: boolean;
  ports?: NodePort[];
  onMove: (id: string, x: number, y: number) => void;
  /** Called once when a drag ends, with the final position (to save it). */
  onMoveEnd?: (id: string, x: number, y: number) => void;
  onSelect: (id: string) => void;
  actions?: NodeActions;
  /** The block's type, written above the card: a small icon, a word and, after it, a plain hint. */
  label?: { icon?: LucideIcon; text: string; hint?: string };
  children?: ReactNode;
  className?: string;
  cardClassName?: string;
  /** The card is as tall as its content (rect.h is then only used for links and fitting). */
  autoHeight?: boolean;
  nodeRef?: Ref<HTMLDivElement>;
}) {
  const canvas = useCanvas();
  const drag = useRef<Drag | null>(null);

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    if (canvas.tool !== "select" || canvas.spaceHeld()) return;
    if ((event.target as Element).closest(OWN_PRESS)) return;
    onSelect(id);
    if (locked || canvas.readOnly) return;
    const start = { x: event.clientX, y: event.clientY };
    drag.current = { id: event.pointerId, start, origin: { x: rect.x, y: rect.y }, scale: canvas.view.scale, moved: false, last: { x: rect.x, y: rect.y } };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const now = { x: event.clientX, y: event.clientY };
    if (!active.moved && !passedThreshold(active.start, now)) return;
    if (!active.moved) { active.moved = true; event.currentTarget.setPointerCapture?.(event.pointerId); }
    active.last = { x: active.origin.x + (now.x - active.start.x) / active.scale, y: active.origin.y + (now.y - active.start.y) / active.scale };
    onMove(id, active.last.x, active.last.y);
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(active.id)) event.currentTarget.releasePointerCapture(active.id);
    if (!active.moved) return;
    if (cancelled) { onMove(id, active.origin.x, active.origin.y); return; }
    onMoveEnd?.(id, active.last.x, active.last.y);
  };

  const anchors = portAnchors({ x: 0, y: 0, w: rect.w, h: rect.h }, ports);
  const LabelIcon = label?.icon;
  const bar = selected && actions && (actions.onDuplicate || actions.onToggleLock || actions.onDelete);
  const barButtons = actions ? [
    actions.onDuplicate && <button key="dup" type="button" aria-label={t("atelier.canvas.duplicate")} title={t("atelier.canvas.duplicate")} className={barButton} onClick={actions.onDuplicate}><Copy size={14} /></button>,
    actions.onToggleLock && <button key="lock" type="button" aria-pressed={locked} aria-label={t(locked ? "atelier.canvas.unlock" : "atelier.canvas.lock")} title={t(locked ? "atelier.canvas.unlock" : "atelier.canvas.lock")}
      className={cn(barButton, locked && "text-ink")} onClick={actions.onToggleLock}>{locked ? <LockKeyhole size={14} /> : <Lock size={14} />}</button>,
    actions.onDelete && <button key="del" type="button" aria-label={t("atelier.canvas.delete")} title={t("atelier.canvas.delete")} className={cn(barButton, "hover:text-danger")} onClick={actions.onDelete}><Trash2 size={14} /></button>,
  ].filter(Boolean) : [];

  return <div ref={nodeRef} data-canvas-node={id} data-selected={selected ? "true" : undefined} data-locked={locked ? "true" : undefined}
    className={cn("absolute", !locked && !canvas.readOnly && canvas.tool === "select" && "cursor-grab active:cursor-grabbing", className)}
    style={{ left: rect.x, top: rect.y, width: rect.w, height: autoHeight ? undefined : rect.h }}
    onPointerDown={down} onPointerMove={move} onPointerUp={(event) => up(event)} onPointerCancel={(event) => up(event, true)}>
    {label && <div className="pointer-events-none absolute bottom-full left-1 mb-1.5 flex max-w-full items-center gap-1 truncate text-[12px] font-medium text-ink-secondary">
      {LabelIcon && <LabelIcon size={12} strokeWidth={1.75} className="shrink-0" />}
      <span className={label.hint ? "shrink-0" : "truncate"}>{label.text}</span>
      {label.hint && <span className="truncate font-normal text-ink-tertiary">· {label.hint}</span>}
    </div>}
    <div className={cn("flex h-full flex-col gap-1.5 overflow-hidden rounded-[14px] border bg-card p-1.5 text-[13px] text-ink",
      selected ? "border-ink/45" : "border-hairline/80", cardClassName)}>
      {children}
    </div>
    {ports.map((port) => {
      const anchor = anchors[port.id];
      const glyph = PORT_GLYPH[port.kind ?? "text"];
      const Icon = port.kind && port.kind !== "text" ? glyph.icon : null;
      return <span key={port.id} role="img" data-canvas-port={port.id} data-port-side={port.side} aria-label={t(glyph.label)} title={t(glyph.label)}
        className="absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-hairline/80 bg-control text-ink-secondary"
        style={{ left: anchor.x, top: anchor.y, width: PORT_SIZE, height: PORT_SIZE }}>
        {Icon ? <Icon size={12} strokeWidth={2} /> : <span data-port-dot className="size-1.5 rounded-full bg-ink-tertiary" />}
      </span>;
    })}
    {bar && <div data-node-actions role="group" aria-label={t("atelier.canvas.nodeActions")}
      className="absolute left-1/2 top-full mt-3 flex -translate-x-1/2 items-center rounded-xl border border-hairline/80 bg-panel p-0.5">
      {barButtons.map((item, index) => <Fragment key={index}>{index > 0 && <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline" />}{item}</Fragment>)}
    </div>}
  </div>;
}

const barButton = "grid size-7 place-items-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-focus";

/** A rounded field nested in a block card. */
export function NodeField({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn("rounded-[10px] bg-control/70 px-3 py-2", className)} />;
}

/** The block's main action: a full-width light button with a small play icon. */
export function NodeAction({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={cn("mt-auto flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-ink text-[13px] font-medium text-app hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50", className)}>
    {children}<Play size={13} strokeWidth={2} />
  </button>;
}
