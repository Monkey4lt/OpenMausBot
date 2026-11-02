import { edgePoint, type Rect } from "@/lib/projects-map";

import { FAMILY_ORDER, MAX_CODE_FILES } from "../../shared/projects-architecture";
import type { ArchOverrides, Architecture, Family } from "../../shared/projects-architecture";

export { FAMILY_ORDER, MAX_CODE_FILES as MAX_READ_FILES };
export type { ArchOverrides, Architecture, Family };

export const FAMILY_COLORS: Readonly<Record<Family, string>> = {
  ui: "#1084fe",
  server: "#38d591",
  data: "#ff9800",
  tests: "#b47cff",
  docs: "#facc15",
  config: "#2dd4bf",
  scripts: "#ff5667",
  assets: "#f472b6",
  i18n: "#60a5fa",
  other: "#9ca3af",
};

export type LevelNode = { id: string; label: string; files: number };
export type Level = { nodes: LevelNode[]; edges: { from: string; to: string; weight: number }[] };

const ROOT_MODULE = "(root)";

export function moduleLabel(id: string): string {
  const [path, family] = id.split("#");
  const segments = path.split("/");
  const name = segments[0] === ROOT_MODULE ? ROOT_MODULE : segments[segments.length - 1];
  return family ? `${name} (${family})` : name;
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function levelOf(arch: Architecture, focus: { family?: Family; module?: string }): Level {
  if (focus.module) {
    const files = arch.files.filter((f) => f.module === focus.module);
    const inside = new Set(files.map((f) => f.path));
    return {
      nodes: files.map((f) => ({ id: f.path, label: fileName(f.path), files: 1 })),
      edges: files.flatMap((f) => f.uses.filter((to) => inside.has(to)).map((to) => ({ from: f.path, to, weight: 1 }))),
    };
  }
  if (focus.family) {
    const modules = arch.modules.filter((m) => m.family === focus.family).sort((a, b) => byText(a.id, b.id));
    const inside = new Set(modules.map((m) => m.id));
    return {
      nodes: modules.map((m) => ({ id: m.id, label: moduleLabel(m.id), files: m.files })),
      edges: arch.edges.filter((e) => e.level === "module" && inside.has(e.from) && inside.has(e.to)).map(({ from, to, weight }) => ({ from, to, weight })),
    };
  }
  const families = [...arch.families].sort((a, b) => FAMILY_ORDER.indexOf(a.id) - FAMILY_ORDER.indexOf(b.id));
  return {
    nodes: families.map((f) => ({ id: f.id, label: f.name, files: f.files })),
    edges: arch.edges.filter((e) => e.level === "family").map(({ from, to, weight }) => ({ from, to, weight })),
  };
}

export function edgeWidth(weight: number): number {
  return 1 + Math.log2(Math.max(1, weight));
}

export function layoutGrid(
  ids: readonly string[],
  opts: GridOptions = { perRow: 4, w: 220, h: 88, gapX: 90, gapY: 80, x0: 40, y0: 40 },
): Record<string, Rect> {
  return Object.fromEntries(ids.map((id, i) => [id, {
    x: opts.x0 + (i % opts.perRow) * (opts.w + opts.gapX),
    y: opts.y0 + Math.floor(i / opts.perRow) * (opts.h + opts.gapY),
    w: opts.w,
    h: opts.h,
  }]));
}

type GridOptions = { perRow: number; w: number; h: number; gapX: number; gapY: number; x0: number; y0: number };

/** Linked nodes go in columns by their longest import chain from a node nothing imports; unlinked nodes fill rows below. */
export function layoutLevel(level: Level, opts: GridOptions = { perRow: 4, w: 220, h: 88, gapX: 90, gapY: 80, x0: 40, y0: 40 }): Record<string, Rect> {
  const ids = level.nodes.map((n) => n.id);
  const known = new Set(ids);
  const edges = level.edges.filter((e) => e.from !== e.to && known.has(e.from) && known.has(e.to));
  const linked = ids.filter((id) => edges.some((e) => e.from === id || e.to === id));
  if (!linked.length) return layoutGrid(ids, opts);
  const depth = new Map(linked.map((id) => [id, 0]));
  for (let pass = 0; pass < linked.length; pass++) {
    let changed = false;
    for (const e of edges) {
      const next = depth.get(e.from)! + 1;
      if (next > depth.get(e.to)! && next < linked.length) { depth.set(e.to, next); changed = true; }
    }
    if (!changed) break;
  }
  const columns = [...new Set([...depth.values()])].sort((a, b) => a - b);
  const rects: Record<string, Rect> = {};
  let tallest = 0;
  columns.forEach((d, column) => {
    linked.filter((id) => depth.get(id) === d).forEach((id, row) => {
      rects[id] = { x: opts.x0 + column * (opts.w + opts.gapX), y: opts.y0 + row * (opts.h + opts.gapY), w: opts.w, h: opts.h };
      tallest = Math.max(tallest, row + 1);
    });
  });
  const rest = ids.filter((id) => !depth.has(id));
  return { ...rects, ...layoutGrid(rest, { ...opts, y0: opts.y0 + tallest * (opts.h + opts.gapY) }) };
}

/** An SVG path between two rects; a non-zero `bend` bows it to the left of its direction, in pixels. */
export function edgeCurve(from: Rect, to: Rect, bend: number): { d: string; label: [number, number] } {
  const [x1, y1] = edgePoint(from, to), [x2, y2] = edgePoint(to, from);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  if (!bend) return { d: `M${x1} ${y1} L${x2} ${y2}`, label: [mx, my] };
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (y2 - y1) / len, ny = -(x2 - x1) / len;
  const cx = mx + nx * bend, cy = my + ny * bend;
  return { d: `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`, label: [mx + nx * bend / 2, my + ny * bend / 2] };
}

type WithOverrides = { overrides?: Record<string, ArchOverrides> };

function updateOverrides<S extends WithOverrides>(state: S, projectId: string, change: (o: ArchOverrides) => ArchOverrides): S {
  const all = state.overrides ?? {};
  const current = Object.hasOwn(all, projectId) ? all[projectId] : { moduleFamily: {}, familyNames: {} };
  return { ...state, overrides: { ...all, [projectId]: change(current) } };
}

export function withModuleFamily<S extends WithOverrides>(state: S, projectId: string, moduleId: string, family: Family): S {
  return updateOverrides(state, projectId, (o) => ({ ...o, moduleFamily: { ...o.moduleFamily, [moduleId]: family } }));
}

export function withFamilyName<S extends WithOverrides>(state: S, projectId: string, family: Family, name: string): S {
  return updateOverrides(state, projectId, (o) => {
    const familyNames = { ...o.familyNames };
    const trimmed = name.trim().slice(0, 60);
    if (trimmed) familyNames[family] = trimmed; else delete familyNames[family];
    return { ...o, familyNames };
  });
}
