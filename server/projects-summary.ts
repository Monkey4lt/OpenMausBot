import type { ArchOverrides, Architecture } from "../shared/projects-architecture.ts";
import type { Project, ProjectMapState, ProjectNode } from "./projects.ts";

export const SUMMARY_LIMIT = 20_000;

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

/** The largest n in [0, max] for which make(n) fits; make(0) is assumed to fit or to be the best that can be done. */
function largestFitting<T>(max: number, limit: number, make: (n: number) => T): T {
  let lo = 0;
  let hi = max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(make(mid)) <= limit) lo = mid; else hi = mid - 1;
  }
  return make(lo);
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
  const base = {
    sources: state.sources.map((s) => ({ id: s.id, label: s.label, kind: s.kind })),
    groups: state.groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
  };
  const rows = (depth: number) => projects.map((p) => {
    const groupId = Object.hasOwn(state.member, p.id) ? state.member[p.id] : undefined;
    return { id: p.id, name: p.name, source: p.sourceId, groupId: groupId && groupIds.has(groupId) ? groupId : null, dirs: p.dirs, files: p.files, folders: folders(p.tree, depth) };
  });
  const links = state.links.map((l) => ({ a: l.a, b: l.b, label: l.label }));
  const full: MapSummary = { ...base, projects: rows(2), links, errors, truncated: false };
  if (size(full) <= limit) return full;

  for (const depth of [1, 0]) {
    const shallow: MapSummary = { ...full, projects: rows(depth), truncated: true };
    if (size(shallow) <= limit) return shallow;
  }
  const bare = rows(0);
  const withProjects = largestFitting(bare.length, limit, (n) => ({ ...base, projects: bare.slice(0, n), links, errors, truncated: true }));
  if (size(withProjects) <= limit) return withProjects;
  const withLinks = largestFitting(links.length, limit, (n) => ({ ...base, projects: [], links: links.slice(0, n), errors, truncated: true }));
  if (size(withLinks) <= limit) return withLinks;
  return largestFitting(errors.length, limit, (n) => ({ ...base, projects: [], links: [], errors: errors.slice(0, n), truncated: true }));
}

/** One project's architecture for the Cartographe; file paths only when asked for, at most `limit` characters of JSON. */
export function summarizeArchitecture(arch: Architecture, overrides: ArchOverrides | undefined, includeFiles: boolean, limit = SUMMARY_LIMIT): ArchitectureSummary {
  const base = {
    families: arch.families.map((f) => ({ id: f.id, name: f.name, files: f.files })),
    modules: arch.modules,
    external: arch.external,
    overrides: overrides ?? { moduleFamily: {}, familyNames: {} },
  };
  const familyEdges = arch.edges.filter((e) => e.level === "family");
  const moduleEdges = arch.edges.filter((e) => e.level === "module");
  const files = arch.files.map((f) => f.path);
  const full: ArchitectureSummary = { ...base, edges: arch.edges, ...(includeFiles ? { files } : {}), truncated: arch.truncated };
  if (size(full) <= limit) return full;

  if (includeFiles) {
    const someFiles = largestFitting(files.length, limit, (n) => ({ ...base, edges: arch.edges, files: files.slice(0, n), truncated: true }));
    if (size(someFiles) <= limit) return someFiles;
  }
  const extra = includeFiles ? { files: [] as string[] } : {};
  const someEdges = largestFitting(moduleEdges.length, limit, (n) => ({ ...base, edges: [...familyEdges, ...moduleEdges.slice(0, n)], ...extra, truncated: true }));
  if (size(someEdges) <= limit) return someEdges;
  const someExternal = largestFitting(arch.external.length, limit, (n) => ({ ...base, external: arch.external.slice(0, n), edges: familyEdges, ...extra, truncated: true }));
  if (size(someExternal) <= limit) return someExternal;
  return largestFitting(arch.modules.length, limit, (n) => ({ ...base, external: [], modules: arch.modules.slice(0, n), edges: familyEdges, ...extra, truncated: true }));
}
