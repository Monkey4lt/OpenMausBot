import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { buildArchitecture, aliasesFromGoMod, aliasesFromTsconfig, type Architecture } from "../projects-architecture.ts";
import { githubLogin, githubRepo, githubRepoLines, githubSignIn } from "../projects-github.ts";
import { detectPieces, isManifestPath, languagesOf, linkPieces, type Piece, type PieceLink } from "../projects-inspect.ts";
import type { ArchitectureWithPieces } from "../../shared/projects-pieces.ts";
import {
  isCodeFile, readGithubImports, readGithubInspect, readLocalImports, readLocalInspect, readSshImports, readSshInspect, type ImportSet, type InspectSet,
} from "../projects-sources.ts";
import { readPieceKinds, savePieceKinds } from "../projects-pieces-store.ts";
import { PromiseLru } from "../promise-lru.ts";
import {
  existingFolder, findProject, githubTarget, localRoot, readProjectMapState, scanLocalLines, scanSshLines, scanSource, withoutStamp,
  projectMapStateSchema, writeProjectMapState, type Project, type ProjectMapState, type ProjectSource,
} from "../projects.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ProjectRouteDeps {
  dataDir: string;
  onArchitectureRead?: (projectId: string) => void;
  readers?: ProjectReaders;
  onChanged?: (rev: number) => void;
  cartographeBotId?: () => string | null;
  /** Makes the Cartographe if this place never had one; called once the map has a source. */
  ensureCartographe?: () => string | null;
  /** Makes the Cartographe again when the person asks for it, even after it was deleted; null where there can be none. */
  recreateCartographe?: () => string | null;
}

const ARCHITECTURE_CACHE_SIZE = 32;

/**
 * GET /api/projects        → the saved layout plus a fresh scan of every source, the Cartographe's bot id or null, and
 *   `pieceKinds` {projectId: PieceKind[]} as saved by the last read of each project; it never reads a project's files
 * PUT /api/projects/state {...layout, baseRev} → 200 {ok, rev}; 409 {error, rev} when baseRev is not the saved rev
 * POST /api/projects/cartographe → 200 {cartographeBotId}, making it again if it was deleted; 404 where there can be none.
 *   Not in CLIENT_ALLOW: only the owner and admins.
 * GET /api/projects/github → the GitHub login Git keeps on this computer, if any
 * POST /api/projects/github/signin {switch?} → open Git's GitHub sign-in window on this computer
 * GET /api/projects/architecture?id=<sourceId:name> → 200 Architecture with `pieces` and `pieceLinks` (shared/projects-pieces.ts),
 *   404 {error} for an id no source has, 502 {error} with the source's message when it cannot be read
 */
function cartographeFor(deps: ProjectRouteDeps): string | null {
  try {
    return deps.ensureCartographe?.() ?? deps.cartographeBotId?.() ?? null;
  } catch (error) {
    console.warn("could not make the Cartographe", error);
    return null;
  }
}

export function createProjectRoutes(deps: ProjectRouteDeps): RouteHandler {
  const readers = deps.readers ?? createProjectReaders(deps);
  return async ({ req, res, url, path, method, json, readBody }) => {
    if (path === "/api/projects/architecture" && method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      try {
        const read = await readers.inspection(id, { refresh: url.searchParams.get("refresh") === "1" });
        if (!read) return json(res, 404, { error: "Unknown project" });
        return json(res, 200, { ...read.architecture, pieces: read.inspection.pieces, pieceLinks: read.inspection.links } satisfies ArchitectureWithPieces);
      } catch (error) {
        return json(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (path === "/api/projects" && method === "GET") {
      const state = readProjectMapState(deps.dataDir);
      const { projects, errors } = await scanProjects(state);
      const saved = readPieceKinds(deps.dataDir);
      const pieceKinds = Object.fromEntries(projects.flatMap((p) => (Object.hasOwn(saved, p.id) ? [[p.id, saved[p.id]!]] : [])));
      return json(res, 200, { state, projects, errors, cartographeBotId: state.sources.length ? cartographeFor(deps) : deps.cartographeBotId?.() ?? null, pieceKinds });
    }
    if (path === "/api/projects/state" && method === "PUT") {
      const body = await readBody(req, 2_000_000) as { baseRev?: unknown } | null;
      const baseRev = body?.baseRev;
      const parsed = projectMapStateSchema.safeParse(body);
      if (!parsed.success || typeof baseRev !== "number" || !Number.isInteger(baseRev) || baseRev < 0) return json(res, 400, { error: "Invalid project map" });
      const current = readProjectMapState(deps.dataDir).rev;
      if (baseRev !== current) return json(res, 409, { error: "The map changed since it was loaded", rev: current });
      const { rev } = writeProjectMapState(deps.dataDir, parsed.data);
      deps.onChanged?.(rev);
      return json(res, 200, { ok: true, rev });
    }
    if (path === "/api/projects/cartographe" && method === "POST") {
      let id: string | null;
      try {
        id = deps.recreateCartographe?.() ?? null;
      } catch (error) {
        console.warn("could not make the Cartographe", error);
        return json(res, 500, { error: "Could not make the Cartographe" });
      }
      return id ? json(res, 200, { cartographeBotId: id }) : json(res, 404, { error: "No Cartographe here" });
    }
    if (path === "/api/projects/github" && method === "GET") {
      return json(res, 200, { login: await githubLogin() });
    }
    if (path === "/api/projects/github/signin" && method === "POST") {
      const body = await readBody(req).catch(() => null) as { switch?: unknown } | null;
      return json(res, 200, { login: await githubSignIn(body?.switch === true) });
    }
    return PASS;
  };
}

/** Every source scanned at once; a source that fails is reported in errors and the others still load. */
export async function scanProjects(state: ProjectMapState): Promise<{ projects: Project[]; errors: { sourceId: string; message: string }[] }> {
  const projects: Project[] = [];
  const errors: { sourceId: string; message: string }[] = [];
  await Promise.all(state.sources.map(async (source) => {
    try {
      projects.push(...await scanSource(source));
    } catch (error) {
      errors.push({ sourceId: source.id, message: error instanceof Error ? error.message : String(error) });
    }
  }));
  projects.sort((a, b) => a.id.localeCompare(b.id));
  return { projects, errors };
}

/** null for an id no source has; a source that cannot be read rejects with its message. */
export type ArchitectureReader = (projectId: string, options?: { refresh?: boolean }) => Promise<Architecture | null>;

/** What projects_inspect_project and the project map show: pieces, the links between them, files per language. */
export interface ProjectInspection { pieces: Piece[]; links: PieceLink[]; languages: Record<string, number>; truncated: boolean }

/** null for an id no source has; a source that cannot be read rejects with its message. */
export type InspectionReader = (projectId: string, options?: { refresh?: boolean }) => Promise<{ architecture: Architecture; inspection: ProjectInspection } | null>;

export interface ProjectReaders { architecture: ArchitectureReader; inspection: InspectionReader }

/** Reads a project's architecture with the saved overrides, cached until its code files, overrides or source change. */
export function createArchitectureReader(deps: { dataDir: string; onArchitectureRead?: (projectId: string) => void }): ArchitectureReader {
  return createProjectReaders(deps).architecture;
}

/** The architecture and the inspection of a project, sharing one read of its files and cached until they, the overrides or the source change. */
export function createProjectReaders(deps: { dataDir: string; onArchitectureRead?: (projectId: string) => void }): ProjectReaders {
  const architectures = new PromiseLru<{ architecture: Architecture; read: ImportSet["read"] }>(ARCHITECTURE_CACHE_SIZE);
  const inspections = new PromiseLru<ProjectInspection>(ARCHITECTURE_CACHE_SIZE);

  async function open(projectId: string, refresh: boolean) {
    const state = readProjectMapState(deps.dataDir);
    const found = findProject(state, projectId);
    if (!found) return null;
    const id = `${found.source.id}:${found.name}`;
    if (refresh) { architectures.delete(id); inspections.delete(id); }
    const reader = await projectReader(found.source, found.name);
    if (!reader) return null;
    const overrides = Object.hasOwn(state.overrides, id) ? state.overrides[id] : undefined;
    const version = createHash("sha256").update(JSON.stringify([[...reader.paths].sort(), reader.version, overrides ?? null, found.source])).digest("hex");
    const built = await architectures.get(id, version, async () => {
      deps.onArchitectureRead?.(id);
      const set = await reader.imports(reader.paths);
      const aliases = { ...(set.tsconfig ? aliasesFromTsconfig(set.tsconfig) : {}), ...(set.goMod ? aliasesFromGoMod(set.goMod) : {}) };
      return { architecture: buildArchitecture(reader.paths, set.read, aliases, overrides), read: set.read };
    });
    return { id, version, reader, built };
  }

  return {
    architecture: async (projectId, options = {}) => (await open(projectId, options.refresh === true))?.built.architecture ?? null,
    inspection: async (projectId, options = {}) => {
      const opened = await open(projectId, options.refresh === true);
      if (!opened) return null;
      const { reader, built } = opened;
      const inspection = await inspections.get(opened.id, opened.version, async () => {
        const material = await reader.inspect(reader.paths);
        const pieces = detectPieces({ paths: reader.paths, manifests: material.manifests, read: built.read, arch: built.architecture });
        try {
          savePieceKinds(deps.dataDir, opened.id, pieces.map((p) => p.kind));
        } catch (error) {
          console.warn("could not save the project's pieces", error);
        }
        return { pieces, links: linkPieces(pieces, material.texts, built.read), languages: languagesOf(reader.paths), truncated: material.truncated || built.architecture.truncated };
      });
      return { architecture: built.architecture, inspection };
    },
  };
}

/** `version` changes whenever a code file is added, removed or edited. */
type Reader = { paths: string[]; version: string; imports: (paths: string[]) => Promise<ImportSet>; inspect: (paths: string[]) => Promise<InspectSet> };

function projectPaths(lines: string[], prefix: string): string[] {
  return lines.filter((line) => line.startsWith(`f ${prefix}/`)).map((line) => line.slice(prefix.length + 3));
}

async function localCodeVersion(root: string, paths: string[]): Promise<string> {
  const stamps = await Promise.all(paths.filter((path) => isCodeFile(path) || isManifestPath(path)).map(async (path) => {
    const info = await lstat(join(root, ...path.split("/"))).catch(() => null);
    return info ? `${path}\t${info.mtimeMs}\t${info.size}` : path;
  }));
  return stamps.join("\n");
}

/** The listed files of a project, or null when the source has no such project. */
export async function projectFiles(source: ProjectSource, name: string): Promise<string[] | null> {
  return (await projectReader(source, name))?.paths ?? null;
}

async function projectReader(source: ProjectSource, name: string): Promise<Reader | null> {
  if (source.kind === "local") {
    const root = join(existingFolder(localRoot(source.path)), name);
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return null;
    const paths = scanLocalLines(root).filter((line) => line.startsWith("f ")).map((line) => line.slice(2));
    return { paths, version: await localCodeVersion(root, paths), imports: (list) => readLocalImports(root, list), inspect: (list) => readLocalInspect(root, list) };
  }
  if (source.kind === "ssh") {
    const lines = await scanSshLines(source.host!, source.path, { stamps: true });
    if (!lines.includes(`d ${name}`)) return null;
    const base = source.path.replace(/\/+$/, "");
    const own = lines.filter((line) => line.startsWith(`f ${name}/`));
    const paths = projectPaths(own.map(withoutStamp), name);
    return {
      paths,
      version: own.filter((line) => { const path = withoutStamp(line); return isCodeFile(path) || isManifestPath(path); }).join("\n"),
      imports: () => readSshImports(source.host!, `${base || ""}/${name}`),
      inspect: (list) => readSshInspect(source.host!, `${base || ""}/${name}`, list.filter(isManifestPath)),
    };
  }
  const [owner, single] = githubTarget(source.path).split("/");
  const repo = await githubRepo(`${owner}/${single ?? name}`);
  const paths = projectPaths(await githubRepoLines(repo), repo.name);
  return { paths, version: repo.pushedAt, imports: () => readGithubImports(repo), inspect: () => readGithubInspect(repo) };
}
