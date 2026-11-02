import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { aliasesFromTsconfig, CODE_EXTENSIONS, MAX_CODE_FILES, parseImports, type FileImports } from "./projects-architecture.ts";

export const MAX_FILE_BYTES = 256 * 1024;

export type ImportSet = { read: FileImports[]; tsconfig: string | null; goMod: string | null };

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

export function isCodeFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && CODE_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}

/** tsconfig.json, or tsconfig.app.json when the first declares no `paths` (Vite splits them so). */
export function pickTsconfig(main: string | null, app: string | null): string | null {
  if (main !== null && Object.keys(aliasesFromTsconfig(main)).length) return main;
  if (app !== null && Object.keys(aliasesFromTsconfig(app)).length) return app;
  return main ?? app;
}

async function readSmallText(file: string): Promise<string | null> {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

export async function readLocalImports(root: string, paths: string[], limit = MAX_CODE_FILES): Promise<ImportSet> {
  const read: FileImports[] = [];
  for (const raw of paths) {
    if (read.length >= limit) break;
    const path = toPosix(raw);
    if (!isCodeFile(path)) continue;
    const file = join(root, ...path.split("/"));
    const rel = relative(root, file);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
    const text = await readSmallText(file);
    if (text !== null) read.push({ path, imports: parseImports(path, text) });
  }
  const [tsconfig, tsconfigApp, goMod] = await Promise.all(["tsconfig.json", "tsconfig.app.json", "go.mod"].map((name) => readSmallText(join(root, name))));
  return { read, tsconfig: pickTsconfig(tsconfig, tsconfigApp), goMod };
}
