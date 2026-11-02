import { boundsOf, simplifyStroke, type Point, type Rect } from "./geometry";

export const MAX_ANNOTATIONS = 500;
export const MAX_NOTE_CHARS = 2000;
export const MAX_INK_POINTS = 2000;
export const MAX_ANNOTATION_ID_CHARS = 64;

/** Theme colour tokens a sticky note may use; the first is the default. */
export const STICKY_COLORS = ["warning", "accent", "success", "danger", "ink"] as const;
export const SHAPES = ["rect", "ellipse", "diamond"] as const;
export const TEXT_SIZES = ["s", "m", "l"] as const;

export type Annotation =
  | { id: string; kind: "sticky"; x: number; y: number; w: number; h: number; text: string; color: string }
  | { id: string; kind: "text"; x: number; y: number; text: string; size: "s" | "m" | "l" }
  | { id: string; kind: "shape"; shape: "rect" | "ellipse" | "diamond"; x: number; y: number; w: number; h: number }
  | { id: string; kind: "ink"; points: Point[] };

const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;

/** Notes are read by the Cartographe, so bidi overrides are removed along with control characters. */
export function cleanNoteText(text: string, max = MAX_NOTE_CHARS): string {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(CONTROL, "");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

function capPoints(points: Point[]): Point[] {
  if (points.length <= MAX_INK_POINTS) return points;
  const step = (points.length - 1) / (MAX_INK_POINTS - 1);
  return Array.from({ length: MAX_INK_POINTS }, (_, i) => points[Math.round(i * step)]);
}

export function cleanAnnotation(a: unknown): Annotation | null {
  if (!isRecord(a)) return null;
  const { id } = a;
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_ANNOTATION_ID_CHARS) return null;
  switch (a.kind) {
    case "sticky":
      if (!finite(a.x) || !finite(a.y) || !positive(a.w) || !positive(a.h) || typeof a.text !== "string") return null;
      return { id, kind: "sticky", x: a.x, y: a.y, w: a.w, h: a.h, text: cleanNoteText(a.text), color: oneOf(STICKY_COLORS, a.color) ? a.color : STICKY_COLORS[0] };
    case "text":
      if (!finite(a.x) || !finite(a.y) || typeof a.text !== "string") return null;
      return { id, kind: "text", x: a.x, y: a.y, text: cleanNoteText(a.text), size: oneOf(TEXT_SIZES, a.size) ? a.size : "m" };
    case "shape":
      if (!oneOf(SHAPES, a.shape) || !finite(a.x) || !finite(a.y) || !positive(a.w) || !positive(a.h)) return null;
      return { id, kind: "shape", shape: a.shape, x: a.x, y: a.y, w: a.w, h: a.h };
    case "ink": {
      if (!Array.isArray(a.points)) return null;
      const points = a.points.filter((p): p is Point => isRecord(p) && finite(p.x) && finite(p.y)).map((p) => ({ x: p.x, y: p.y }));
      if (points.length < 2) return null;
      return { id, kind: "ink", points: capPoints(simplifyStroke(points)) };
    }
    default:
      return null;
  }
}

export function cleanAnnotations(list: unknown): Annotation[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Annotation[] = [];
  for (const item of list) {
    if (out.length >= MAX_ANNOTATIONS) break;
    const clean = cleanAnnotation(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
  }
  return out;
}

export const TEXT_FONT_PX: Record<"s" | "m" | "l", number> = { s: 14, m: 18, l: 28 };

export function annotationBounds(a: Annotation): Rect {
  switch (a.kind) {
    case "sticky":
    case "shape":
      return { x: a.x, y: a.y, w: a.w, h: a.h };
    case "text": {
      const font = TEXT_FONT_PX[a.size];
      const lines = a.text.split("\n");
      const longest = Math.max(1, ...lines.map((line) => line.length));
      return { x: a.x, y: a.y, w: longest * font * 0.6, h: lines.length * font * 1.3 };
    }
    case "ink":
      return boundsOf(a.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))) ?? { x: 0, y: 0, w: 0, h: 0 };
  }
}
