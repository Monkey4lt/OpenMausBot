import { DESCRIPTION_MAX, SUMMARY_MAX, type ArchOverrides, type Architecture } from "../shared/projects-architecture.ts";
import { PIECE_LABELS, type Piece, type PieceKind, type PieceLink } from "../shared/projects-pieces.ts";
import { MAX_NOTE_CHARS } from "../src/lib/canvas/model.ts";
import { cleanLabel } from "./projects-changes.ts";
import type { Project, ProjectMapState, ProjectNode } from "./projects.ts";

export const SUMMARY_LIMIT = 20_000;
const ERROR_MAX = 300;

export interface MapSummary {
  sources: { id: string; label: string; kind: string }[];
  groups: { id: string; name: string; color: string }[];
  projects: { id: string; name: string; source: string; groupId: string | null; dirs: number; files: number; folders: string[] }[];
  links: { a: string; b: string; label: string }[];
  errors: { sourceId: string; message: string }[];
  /** What the person wrote on the canvas (notes and texts), as indications from them. */
  notes: { kind: "sticky" | "text"; text: string }[];
  /** True when something was left out to stay under the size limit. */
  truncated: boolean;
}

export interface ArchitectureSummary {
  families: { id: string; name: string; files: number }[];
  modules: Architecture["modules"];
  edges: Architecture["edges"];
  external: Architecture["external"];
  overrides: ArchOverrides;
  files?: string[];
  /** The offset of the next page of files, when more remain. */
  nextOffset?: number;
  /** True when the server read only part of the project, or something was left out to stay under the size limit. */
  truncated: boolean;
}

/** Which files to list: one module's or one family's, a page at a time. */
export interface FilePage { module?: string; family?: string; offset?: number; limit?: number }

export const DEFAULT_FILE_PAGE = 300;
export const MAX_FILE_PAGE = 1000;

const size = (value: unknown) => JSON.stringify(value).length;
const fits = (value: unknown, limit: number) => size(value) <= limit;

/** The largest n in [0, max] for which make(n) fits, as make(n). */
function largestFitting<T>(max: number, limit: number, make: (n: number) => T): T {
  let lo = 0;
  let hi = max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(make(mid), limit)) lo = mid; else hi = mid - 1;
  }
  return make(lo);
}

/** The first candidate that fits; the last one is built to always fit. */
function firstFitting<T>(limit: number, candidates: Array<() => T>): T {
  for (const make of candidates.slice(0, -1)) {
    const value = make();
    if (fits(value, limit)) return value;
  }
  return candidates.at(-1)!();
}

const HOST = /\b[\w.-]+@[\w.-]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
const PATH = /(?:~|\.{1,2})?(?:[\\/][^\s\\/:'"]+){2,}[\\/]?|[A-Za-z]:\\[^\s'"]*/g;

/** A source's error as one short line, with hosts and paths taken out. */
function errorLine(message: string): string {
  const flat = message.replace(/\s+/g, " ").replace(HOST, "<host>").replace(PATH, "<path>");
  return [...flat].filter((ch) => cleanLabel(ch) === ch || ch === " ").join("").trim().slice(0, ERROR_MAX);
}

function folders(tree: ProjectNode[], depth: number): string[] {
  const out: string[] = [];
  for (const node of tree) {
    if (node.t !== "d") continue;
    out.push(node.n);
    if (depth > 1) for (const child of node.c ?? []) if (child.t === "d") out.push(`${node.n}/${child.n}`);
  }
  return out;
}

/** The global map for the Cartographe: no file trees, no source hosts or paths, at most `limit` characters of JSON. */
export function summarizeMap(
  state: ProjectMapState, projects: Project[], errors: { sourceId: string; message: string }[], limit = SUMMARY_LIMIT,
): MapSummary {
  const groupIds = new Set(state.groups.map((g) => g.id));
  const sources = state.sources.map((s) => ({ id: s.id, label: cleanLabel(s.label), kind: s.kind }));
  const groups = state.groups.map((g) => ({ id: g.id, name: cleanLabel(g.name), color: g.color }));
  const rows = (depth: number) => projects.map((p) => {
    const groupId = Object.hasOwn(state.member, p.id) ? state.member[p.id] : undefined;
    return { id: p.id, name: p.name, source: p.sourceId, groupId: groupId && groupIds.has(groupId) ? groupId : null, dirs: p.dirs, files: p.files, folders: folders(p.tree, depth) };
  });
  const links = state.links.map((l) => ({ a: l.a, b: l.b, label: cleanLabel(l.label) }));
  const errs = errors.map((e) => ({ sourceId: e.sourceId, message: errorLine(e.message) }));
  const notes = (state.annotations ?? []).flatMap((a) => {
    if (a.kind !== "sticky" && a.kind !== "text") return [];
    const text = cleanLabel(a.text, { max: MAX_NOTE_CHARS, keepLines: true });
    return text ? [{ kind: a.kind, text }] : [];
  });
  const bare = rows(0);
  const cut = (part: Partial<MapSummary>): MapSummary => ({ sources, groups, projects: bare, links, errors: errs, notes, ...part, truncated: true });

  return firstFitting<MapSummary>(limit, [
    () => ({ sources, groups, projects: rows(2), links, errors: errs, notes, truncated: false }),
    () => cut({ projects: rows(1) }),
    () => cut({}),
    () => largestFitting(notes.length, limit, (n) => cut({ notes: notes.slice(0, n) })),
    () => largestFitting(bare.length, limit, (n) => cut({ projects: bare.slice(0, n), notes: [] })),
    () => largestFitting(links.length, limit, (n) => cut({ projects: [], notes: [], links: links.slice(0, n) })),
    () => largestFitting(errs.length, limit, (n) => cut({ projects: [], notes: [], links: [], errors: errs.slice(0, n) })),
    () => largestFitting(groups.length, limit, (n) => cut({ projects: [], notes: [], links: [], errors: [], groups: groups.slice(0, n) })),
    () => largestFitting(sources.length, limit, (n) => cut({ projects: [], notes: [], links: [], errors: [], groups: [], sources: sources.slice(0, n) })),
  ]);
}

/** One project's architecture for the Cartographe; file paths only when asked for, a page at a time, at most `limit` characters of JSON. */
export function summarizeArchitecture(arch: Architecture, overrides: ArchOverrides | undefined, page: boolean | FilePage, limit = SUMMARY_LIMIT): ArchitectureSummary {
  const includeFiles = page !== false;
  const { module, family, offset: rawOffset, limit: rawLimit } = typeof page === "object" ? page : {};
  const moduleIds = new Set(arch.modules.map((m) => m.id));
  const kept: ArchOverrides = {
    moduleFamily: Object.fromEntries(Object.entries(overrides?.moduleFamily ?? {}).filter(([id]) => moduleIds.has(id))),
    familyNames: Object.fromEntries(Object.entries(overrides?.familyNames ?? {}).map(([family, name]) => [family, cleanLabel(name ?? "")])),
    ...(overrides?.summary ? { summary: cleanLabel(overrides.summary, { max: SUMMARY_MAX, keepLines: true }) } : {}),
    ...(overrides?.familyText ? { familyText: Object.fromEntries(Object.entries(overrides.familyText).map(([family, text]) => [family, cleanLabel(text ?? "", { max: DESCRIPTION_MAX })])) } : {}),
    ...(overrides?.moduleText ? { moduleText: Object.fromEntries(Object.entries(overrides.moduleText).filter(([id]) => moduleIds.has(id)).map(([id, text]) => [id, cleanLabel(text, { max: DESCRIPTION_MAX })])) } : {}),
  };
  const families = arch.families.map((f) => ({ id: f.id, name: cleanLabel(f.name), files: f.files }));
  const familyEdges = arch.edges.filter((e) => e.level === "family");
  const moduleEdges = arch.edges.filter((e) => e.level === "module");
  const familyOf = new Map(arch.modules.map((m) => [m.id, m.family]));
  const chosen = arch.files.filter((f) => (module === undefined || f.module === module) && (family === undefined || familyOf.get(f.module) === family)).map((f) => f.path);
  const offset = Math.max(0, Math.floor(rawOffset ?? 0));
  const size = Math.min(MAX_FILE_PAGE, Math.max(1, Math.floor(rawLimit ?? DEFAULT_FILE_PAGE)));
  const files = chosen.slice(offset, offset + size);
  const pageOf = (n: number) => ({ files: files.slice(0, n), ...(offset + n < chosen.length ? { nextOffset: offset + n } : {}) });
  const noFiles = includeFiles ? { files: [] as string[] } : {};
  const base = { families, modules: arch.modules, external: arch.external, overrides: kept };
  const cut = (part: Partial<ArchitectureSummary>): ArchitectureSummary => ({ ...base, edges: arch.edges, ...noFiles, ...part, truncated: true });
  const overrideEntries = Object.entries(kept.moduleFamily);
  const withOverrides = (n: number): ArchOverrides => ({ ...kept, moduleFamily: Object.fromEntries(overrideEntries.slice(0, n)) });

  return firstFitting<ArchitectureSummary>(limit, [
    () => ({ ...base, edges: arch.edges, ...(includeFiles ? pageOf(files.length) : {}), truncated: arch.truncated }),
    ...(includeFiles ? [() => largestFitting(files.length, limit, (n) => ({ ...base, edges: arch.edges, ...pageOf(n), truncated: arch.truncated }))] : []),
    () => largestFitting(moduleEdges.length, limit, (n) => cut({ edges: [...familyEdges, ...moduleEdges.slice(0, n)] })),
    () => largestFitting(arch.external.length, limit, (n) => cut({ edges: familyEdges, external: arch.external.slice(0, n) })),
    () => largestFitting(overrideEntries.length, limit, (n) => cut({ edges: familyEdges, external: [], overrides: withOverrides(n) })),
    () => largestFitting(arch.modules.length, limit, (n) => cut({ edges: familyEdges, external: [], overrides: withOverrides(0), modules: arch.modules.slice(0, n) })),
    () => largestFitting(families.length, limit, (n) => cut({ edges: [], external: [], overrides: { moduleFamily: {}, familyNames: {} }, modules: [], families: families.slice(0, n) })),
  ]);
}

export interface InspectionSummary {
  /** `label` is the plain French word for the piece, to use when talking to the person. */
  pieces: (Piece & { label: string })[];
  links: PieceLink[];
  languages: Record<string, number>;
  /** A ready page of the pieces and their links, to pass as is to show_html. */
  diagramHtml: string;
  /** True when the server read only part of the project, or something was left out to stay under the size limit. */
  truncated: boolean;
}

/** One project's pieces for the Cartographe, at most `limit` characters of JSON; the diagram is drawn from what is kept. */
export function summarizeInspection(
  inspection: { pieces: Piece[]; links: PieceLink[]; languages: Record<string, number>; truncated: boolean },
  diagram: (kept: { pieces: Piece[]; links: PieceLink[] }) => string,
  limit = SUMMARY_LIMIT,
): InspectionSummary {
  const labelled = (pieces: Piece[]) => pieces.map((p) => ({ ...p, tech: cleanLabel(p.tech), label: PIECE_LABELS[p.kind as PieceKind].fr }));
  const make = (pieces: Piece[], links: PieceLink[], languages: Record<string, number>, truncated: boolean, withDiagram = true): InspectionSummary => ({
    pieces: labelled(pieces), links, languages, diagramHtml: withDiagram ? diagram({ pieces, links }) : "", truncated,
  });
  const { pieces, links, languages } = inspection;
  const lean = pieces.map((p) => ({ ...p, evidence: p.evidence.slice(0, 1), modules: p.modules.slice(0, 5) }));
  const leanLinks = links.map((l) => ({ ...l, examples: l.examples.slice(0, 1) }));
  const fewLanguages = Object.fromEntries(Object.entries(languages).slice(0, 10));
  return firstFitting<InspectionSummary>(limit, [
    () => make(pieces, links, languages, inspection.truncated),
    () => make(lean, leanLinks, fewLanguages, true),
    () => largestFitting(lean.length, limit, (n) => make(lean.slice(0, n), leanLinks, fewLanguages, true)),
    () => largestFitting(lean.length, limit, (n) => make(lean.slice(0, n), leanLinks, fewLanguages, true, false)),
    () => make([], [], {}, true, false),
  ]);
}
