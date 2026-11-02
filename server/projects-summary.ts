import type { ArchOverrides, Architecture } from "../shared/projects-architecture.ts";
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
  /** True when the server read only part of the project, or something was left out to stay under the size limit. */
  truncated: boolean;
}

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
  const bare = rows(0);
  const cut = (part: Partial<MapSummary>): MapSummary => ({ sources, groups, projects: bare, links, errors: errs, ...part, truncated: true });

  return firstFitting<MapSummary>(limit, [
    () => ({ sources, groups, projects: rows(2), links, errors: errs, truncated: false }),
    () => cut({ projects: rows(1) }),
    () => cut({}),
    () => largestFitting(bare.length, limit, (n) => cut({ projects: bare.slice(0, n) })),
    () => largestFitting(links.length, limit, (n) => cut({ projects: [], links: links.slice(0, n) })),
    () => largestFitting(errs.length, limit, (n) => cut({ projects: [], links: [], errors: errs.slice(0, n) })),
    () => largestFitting(groups.length, limit, (n) => cut({ projects: [], links: [], errors: [], groups: groups.slice(0, n) })),
    () => largestFitting(sources.length, limit, (n) => cut({ projects: [], links: [], errors: [], groups: [], sources: sources.slice(0, n) })),
  ]);
}

/** One project's architecture for the Cartographe; file paths only when asked for, at most `limit` characters of JSON. */
export function summarizeArchitecture(arch: Architecture, overrides: ArchOverrides | undefined, includeFiles: boolean, limit = SUMMARY_LIMIT): ArchitectureSummary {
  const moduleIds = new Set(arch.modules.map((m) => m.id));
  const kept: ArchOverrides = {
    moduleFamily: Object.fromEntries(Object.entries(overrides?.moduleFamily ?? {}).filter(([id]) => moduleIds.has(id))),
    familyNames: Object.fromEntries(Object.entries(overrides?.familyNames ?? {}).map(([family, name]) => [family, cleanLabel(name ?? "")])),
  };
  const families = arch.families.map((f) => ({ id: f.id, name: cleanLabel(f.name), files: f.files }));
  const familyEdges = arch.edges.filter((e) => e.level === "family");
  const moduleEdges = arch.edges.filter((e) => e.level === "module");
  const files = arch.files.map((f) => f.path);
  const noFiles = includeFiles ? { files: [] as string[] } : {};
  const base = { families, modules: arch.modules, external: arch.external, overrides: kept };
  const cut = (part: Partial<ArchitectureSummary>): ArchitectureSummary => ({ ...base, edges: arch.edges, ...noFiles, ...part, truncated: true });
  const overrideEntries = Object.entries(kept.moduleFamily);
  const withOverrides = (n: number): ArchOverrides => ({ moduleFamily: Object.fromEntries(overrideEntries.slice(0, n)), familyNames: kept.familyNames });

  return firstFitting<ArchitectureSummary>(limit, [
    () => ({ ...base, edges: arch.edges, ...(includeFiles ? { files } : {}), truncated: arch.truncated }),
    ...(includeFiles ? [() => largestFitting(files.length, limit, (n) => cut({ files: files.slice(0, n) }))] : []),
    () => largestFitting(moduleEdges.length, limit, (n) => cut({ edges: [...familyEdges, ...moduleEdges.slice(0, n)] })),
    () => largestFitting(arch.external.length, limit, (n) => cut({ edges: familyEdges, external: arch.external.slice(0, n) })),
    () => largestFitting(overrideEntries.length, limit, (n) => cut({ edges: familyEdges, external: [], overrides: withOverrides(n) })),
    () => largestFitting(arch.modules.length, limit, (n) => cut({ edges: familyEdges, external: [], overrides: withOverrides(0), modules: arch.modules.slice(0, n) })),
    () => largestFitting(families.length, limit, (n) => cut({ edges: [], external: [], overrides: { moduleFamily: {}, familyNames: {} }, modules: [], families: families.slice(0, n) })),
  ]);
}
