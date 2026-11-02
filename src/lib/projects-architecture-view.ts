import { facingAnchors } from "@/lib/canvas/geometry";
import { edgePoint, type Rect } from "@/lib/projects-map";
import type { CanvasEdge } from "@/components/canvas/EdgeLayer";

import { FAMILY_ORDER, MAX_CODE_FILES } from "../../shared/projects-architecture";
import type { ArchOverrides, Architecture, Family } from "../../shared/projects-architecture";
import {
  BUILD_KINDS, CARD_KINDS, FLOW_COLUMNS, LINK_PHRASES, PIECE_DEFAULT_TEXT, PIECE_LABELS, externalPhrase, pieceKey,
  type ArchitectureWithPieces, type EvidenceCode, type Piece, type PieceKind, type PieceLink,
} from "../../shared/projects-pieces";

export { FAMILY_ORDER, MAX_CODE_FILES as MAX_READ_FILES };
export type { ArchOverrides, Architecture, ArchitectureWithPieces, Family, Piece, PieceKind, PieceLink };

type Locale = "fr" | "en";

export const PIECE_COLORS: Readonly<Record<PieceKind, string>> = {
  ui: "#1084fe", api: "#38d591", database: "#ff9800", cache: "#b47cff", jobs: "#facc15",
  external: "#ff5667", chatbot: "#2dd4bf", tests: "#9ca3af", deploy: "#60a5fa",
};

/** Plain words for each kind of evidence; the server's `reason` stays in English for the bot. */
export const EVIDENCE_WORDS: Readonly<Record<Locale, Record<EvidenceCode, string>>> = {
  fr: {
    dependency: "la liste des outils du projet le demande", compose_image: "un service lancé avec Docker", vue_component: "un morceau d'écran Vue",
    svelte_component: "un morceau d'écran Svelte", screen_component: "un morceau d'écran", web_page: "une page web", prisma_schema: "le plan de la base de données",
    migration: "un changement de la forme de la base de données", sql_file: "des commandes de base de données", docker_build: "la recette pour emballer le projet",
    compose_file: "la liste des services à lancer ensemble", ci_workflow: "une tâche automatique sur GitHub", vercel: "les réglages de Vercel",
    netlify: "les réglages de Netlify", fly: "les réglages de Fly.io", procfile: "la liste des programmes à lancer en ligne", test_file: "un fichier de tests",
    folder: "rangé dans le dossier de ce bloc",
  },
  en: {
    dependency: "the project's list of tools asks for it", compose_image: "a service started with Docker", vue_component: "a piece of Vue screen",
    svelte_component: "a piece of Svelte screen", screen_component: "a piece of screen", web_page: "a web page", prisma_schema: "the database's plan",
    migration: "a change to the database's layout", sql_file: "database commands", docker_build: "the recipe to package the project",
    compose_file: "the list of services to start together", ci_workflow: "an automatic task on GitHub", vercel: "Vercel settings",
    netlify: "Netlify settings", fly: "Fly.io settings", procfile: "the list of programs to start online", test_file: "a test file",
    folder: "kept in this part's folder",
  },
};

export function evidenceWords(evidence: Piece["evidence"][number], locale: Locale): string {
  return EVIDENCE_WORDS[locale][evidence.code] ?? evidence.reason;
}

export function evidenceLine(evidence: Piece["evidence"][number], locale: Locale): string {
  return `${evidence.path}${locale === "fr" ? " : " : ": "}${evidenceWords(evidence, locale)}`;
}

const PREVIEW_MAX = 120;

/** The first non-empty line of an En bref summary, for the project's block. */
export function summaryPreview(summary: string | undefined): string {
  const line = (summary ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 1)}…` : line;
}

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

/** A module's name for people: the project's top folder is called `rootName` instead of "(root)". */
export function plainModuleLabel(id: string, rootName: string): string {
  const label = moduleLabel(id);
  return label === ROOT_MODULE || label.startsWith(`${ROOT_MODULE} (`) ? rootName + label.slice(ROOT_MODULE.length) : label;
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

export type DrawnEdge = { from: string; to: string; weight: number; twoWay: boolean };

/** One arrow per pair of nodes: a link both ways becomes a single double-headed arrow carrying both weights. */
export function mergeTwoWay(edges: Level["edges"]): DrawnEdge[] {
  const out = new Map<string, DrawnEdge>();
  for (const e of edges) {
    const back = out.get(`${e.to}->${e.from}`);
    if (back) { back.weight += e.weight; back.twoWay = true; continue; }
    const same = out.get(`${e.from}->${e.to}`);
    if (same) same.weight += e.weight; else out.set(`${e.from}->${e.to}`, { ...e, twoWay: false });
  }
  return [...out.values()];
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

const CARD_MAX = 3;

/** The kinds a project's card shows: each once, in card order, never tests or deploy; at most three, and how many more. */
export function cardPieces(kinds: readonly PieceKind[] | undefined): { shown: PieceKind[]; more: number } {
  const all = CARD_KINDS.filter((kind) => kinds?.includes(kind));
  return { shown: all.slice(0, CARD_MAX), more: Math.max(0, all.length - CARD_MAX) };
}

/** What `link` does to the box of `to`, read as "[from] phrase [to]". */
export function linkPhrase(link: PieceLink, to: { kind: PieceKind; tech: string }, locale: Locale): string {
  if (link.to === "external") return externalPhrase(to.tech, locale);
  const key = `${link.from}->${link.to}`;
  return Object.hasOwn(LINK_PHRASES, key) ? LINK_PHRASES[key as keyof typeof LINK_PHRASES][locale] : "";
}

/**
 * What backs one drawn arrow. The server → outside services link is one link for every service, so for one service only
 * the examples whose package names it are kept; their files are counted when the examples hold the whole link.
 */
export function edgeEvidence(link: PieceLink, to: { kind: PieceKind; tech: string }): { count: number; examples: PieceLink["examples"] } {
  if (link.to !== "external" || !to.tech) return { count: link.count, examples: link.examples };
  const name = to.tech.toLowerCase();
  const examples = link.examples.filter((x) => x.to.toLowerCase().includes(name));
  const whole = link.examples.length >= link.count;
  return { count: whole ? new Set(examples.map((x) => x.from)).size : link.count, examples };
}

export type FlowBox = {
  key: string;
  kind: PieceKind;
  label: string;
  /** « Service extérieur » under an outside service's brand. */
  subtitle?: string;
  text: string;
  /** True when the text is the Cartographe's, not the default line. */
  described: boolean;
  techs: string[];
  pieces: Piece[];
  rect: Rect;
};
export type FlowEdge = CanvasEdge & { fromKey: string; toKey: string; link: PieceLink; label: string };
export type FlowColumn = { id: (typeof FLOW_COLUMNS)[number]["id"]; x: number; y: number; w: number };

export const FLOW_BOX = { w: 240, h: 92, gapX: 150, gapY: 28, underGap: 74, stackGap: 110, x0: 40, y0: 56, buildW: 200, buildH: 44, buildGap: 70 };

/** The « Comment ça marche » view: one box per kind (one per outside service) in four columns, tests and deploy in a row under them, and one plain phrase per found link. */
export function flowLayout(pieces: readonly Piece[], links: readonly PieceLink[], texts: Readonly<Record<string, string>> | undefined, locale: Locale,
  options: { stacked?: boolean } = {}): {
  boxes: FlowBox[]; build: FlowBox[]; columns: FlowColumn[]; buildRow: { x: number; y: number } | null; edges: FlowEdge[];
} {
  const groupsOf = (kind: PieceKind): { key: string; tech: string; pieces: Piece[] }[] => {
    const own = pieces.filter((p) => p.kind === kind);
    if (!own.length) return [];
    if (kind !== "external") return [{ key: kind, tech: "", pieces: own }];
    const byKey = new Map<string, { key: string; tech: string; pieces: Piece[] }>();
    for (const p of own) {
      const key = pieceKey(p);
      const found = byKey.get(key) ?? { key, tech: p.tech, pieces: [] };
      found.pieces.push(p);
      byKey.set(key, found);
    }
    return [...byKey.values()].sort((a, b) => byText(a.tech.toLowerCase(), b.tech.toLowerCase()));
  };
  const box = (kind: PieceKind, group: { key: string; tech: string; pieces: Piece[] }, rect: Rect): FlowBox => {
    const own = texts && Object.hasOwn(texts, group.key) ? texts[group.key] : undefined;
    const brand = kind === "external" && group.tech;
    return {
      key: group.key, kind, label: brand ? group.tech : PIECE_LABELS[kind][locale], ...(brand ? { subtitle: PIECE_LABELS.external[locale] } : {}),
      text: own || PIECE_DEFAULT_TEXT[kind][locale], described: Boolean(own),
      techs: [...new Set(group.pieces.map((p) => p.tech).filter(Boolean))], pieces: group.pieces, rect,
    };
  };
  const B = FLOW_BOX;
  const boxes: FlowBox[] = [];
  const columns: FlowColumn[] = [];
  let bottom = B.y0;
  const columnBottom = new Map<string, number>();
  let slot = 0;
  for (const column of FLOW_COLUMNS) {
    const groups = column.kinds.flatMap((kind) => groupsOf(kind).map((g) => ({ kind, g })));
    if (!groups.length) continue;
    const host = options.stacked ? columns.at(-1) : column.under ? columns.find((c) => c.id === column.under) : undefined;
    const x = host ? host.x : B.x0 + slot++ * (B.w + B.gapX);
    const top = host ? columnBottom.get(host.id)! + (options.stacked ? B.stackGap : B.underGap) : B.y0;
    columns.push({ id: column.id, x, y: top - 34, w: B.w });
    groups.forEach(({ kind, g }, row) => {
      const rect = { x, y: top + row * (B.h + B.gapY), w: B.w, h: B.h };
      boxes.push(box(kind, g, rect));
      columnBottom.set(column.id, rect.y + rect.h);
      bottom = Math.max(bottom, rect.y + rect.h);
    });
  }
  const buildKinds = BUILD_KINDS.filter((kind) => pieces.some((p) => p.kind === kind));
  const buildRow = buildKinds.length ? { x: B.x0, y: (boxes.length ? bottom : B.y0) + B.buildGap - 30 } : null;
  const build = buildKinds.map((kind, i) => box(kind, groupsOf(kind)[0]!, options.stacked
    ? { x: B.x0, y: buildRow!.y + 30 + i * (B.buildH + 12), w: B.w, h: B.buildH }
    : { x: B.x0 + i * (B.buildW + B.gapY), y: buildRow!.y + 30, w: B.buildW, h: B.buildH }));
  const edges = links.flatMap((link) => {
    const from = boxes.find((b) => b.kind === link.from);
    if (!from) return [];
    return boxes.filter((b) => b.kind === link.to).map((to): FlowEdge => {
      const [a, b] = facingAnchors(from.rect, to.rect);
      return { id: `${from.key}->${to.key}`, fromKey: from.key, toKey: to.key, link, from: a, to: b, label: linkPhrase(link, { kind: to.kind, tech: to.techs[0] ?? "" }, locale), arrow: "end", dashed: false };
    });
  });
  return { boxes, build, columns, buildRow, edges };
}
