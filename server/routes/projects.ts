import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { buildArchitecture, aliasesFromGoMod, aliasesFromTsconfig, type Architecture } from "../projects-architecture.ts";
import { githubLogin, githubRepo, githubRepoLines, githubSignIn } from "../projects-github.ts";
import { isCodeFile, readGithubImports, readLocalImports, readSshImports, type ImportSet } from "../projects-sources.ts";
import { PromiseLru } from "../promise-lru.ts";
import {
  existingFolder, findProject, githubTarget, localRoot, readProjectMapState, scanLocalLines, scanSshLines, scanSource, withoutStamp,
  projectMapStateSchema, writeProjectMapState, type Project, type ProjectMapState, type ProjectSource,
} from "../projects.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ProjectRouteDeps {
  dataDir: string;
  onArchitectureRead?: (projectId: string) => void;
  /** Shares one architecture cache with other callers; made from dataDir and onArchitectureRead when absent. */
  architectures?: ArchitectureReader;
  /** Called after each saved write with the new rev. */
  onChanged?: (rev: number) => void;
  cartographeBotId?: () => string | null;
}

const ARCHITECTURE_CACHE_SIZE = 32;

/**
 * GET /api/projects        → the saved layout plus a fresh scan of every source, and the Cartographe's bot id or null
 * PUT /api/projects/state {...layout, baseRev} → 200 {ok, rev}; 409 {error, rev} when baseRev is not the saved rev
 * GET /api/projects/github → the GitHub login Git keeps on this computer, if any
 * POST /api/projects/github/signin {switch?} → open Git's GitHub sign-in window on this computer
 * GET /api/projects/architecture?id=<sourceId:name> → 200 Architecture (shared/projects-architecture.ts),
 *   404 {error} for an id no source has, 502 {error} with the source's message when it cannot be read
 */
export function createProjectRoutes(deps: ProjectRouteDeps): RouteHandler {
  const architectures = deps.architectures ?? createArchitectureReader(deps);
  return async ({ req, res, url, path, method, json, readBody }) => {
    if (path === "/api/projects/architecture" && method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      try {
        const architecture = await architectures(id, { refresh: url.searchParams.get("refresh") === "1" });
        if (!architecture) return json(res, 404, { error: "Unknown project" });
        return json(res, 200, architecture);
      } catch (error) {
        return json(res, 502, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (path === "/api/projects" && method === "GET") {
      const state = readProjectMapState(deps.dataDir);
      const { projects, errors } = await scanProjects(state);
      return json(res, 200, { state, projects, errors, cartographeBotId: deps.cartographeBotId?.() ?? null });
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

/** Reads a project's architecture with the saved overrides, cached until its code files, overrides or source change. */
export function createArchitectureReader(deps: { dataDir: string; onArchitectureRead?: (projectId: string) => void }): ArchitectureReader {
  const cache = new PromiseLru<Architecture>(ARCHITECTURE_CACHE_SIZE);
  return async (projectId, options = {}) => {
    const state = readProjectMapState(deps.dataDir);
    const found = findProject(state, projectId);
    if (!found) return null;
    if (options.refresh) cache.delete(`${found.source.id}:${found.name}`);
    return projectArchitecture(state, found.source, found.name, cache, deps.onArchitectureRead);
  };
}

/** `version` changes whenever a code file is added, removed or edited. */
type Reader = { paths: string[]; version: string; imports: (paths: string[]) => Promise<ImportSet> };

function projectPaths(lines: string[], prefix: string): string[] {
  return lines.filter((line) => line.startsWith(`f ${prefix}/`)).map((line) => line.slice(prefix.length + 3));
}

async function localCodeVersion(root: string, paths: string[]): Promise<string> {
  const stamps = await Promise.all(paths.filter(isCodeFile).map(async (path) => {
    const info = await lstat(join(root, ...path.split("/"))).catch(() => null);
    return info ? `${path}\t${info.mtimeMs}\t${info.size}` : path;
  }));
  return stamps.join("\n");
}

async function projectReader(source: ProjectSource, name: string): Promise<Reader | null> {
  if (source.kind === "local") {
    const root = join(existingFolder(localRoot(source.path)), name);
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return null;
    const paths = scanLocalLines(root).filter((line) => line.startsWith("f ")).map((line) => line.slice(2));
    return { paths, version: await localCodeVersion(root, paths), imports: (list) => readLocalImports(root, list) };
  }
  if (source.kind === "ssh") {
    const lines = await scanSshLines(source.host!, source.path, { stamps: true });
    if (!lines.includes(`d ${name}`)) return null;
    const base = source.path.replace(/\/+$/, "");
    const own = lines.filter((line) => line.startsWith(`f ${name}/`));
    return {
      paths: projectPaths(own.map(withoutStamp), name),
      version: own.filter((line) => isCodeFile(withoutStamp(line))).join("\n"),
      imports: () => readSshImports(source.host!, `${base || ""}/${name}`),
    };
  }
  const [owner, single] = githubTarget(source.path).split("/");
  const repo = await githubRepo(`${owner}/${single ?? name}`);
  const paths = projectPaths(await githubRepoLines(repo), repo.name);
  return { paths, version: repo.pushedAt, imports: () => readGithubImports(repo) };
}

async function projectArchitecture(
  state: ProjectMapState, source: ProjectSource, name: string, cache: PromiseLru<Architecture>, onRead?: (projectId: string) => void,
): Promise<Architecture | null> {
  const id = `${source.id}:${name}`;
  const reader = await projectReader(source, name);
  if (!reader) return null;
  const overrides = Object.hasOwn(state.overrides, id) ? state.overrides[id] : undefined;
  const version = createHash("sha256").update(JSON.stringify([[...reader.paths].sort(), reader.version, overrides ?? null, source])).digest("hex");
  return cache.get(id, version, async () => {
    onRead?.(id);
    const set = await reader.imports(reader.paths);
    const aliases = { ...(set.tsconfig ? aliasesFromTsconfig(set.tsconfig) : {}), ...(set.goMod ? aliasesFromGoMod(set.goMod) : {}) };
    return buildArchitecture(reader.paths, set.read, aliases, overrides);
  });
}
