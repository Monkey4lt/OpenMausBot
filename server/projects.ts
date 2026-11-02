// Projects map: every folder under a "source" (a local path, a path on an
// SSH host, or a GitHub account or repository) becomes a block with its full file tree. Groups, links and block
// positions are the person's layout, kept in projects-map.json in the data dir.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { scanGithubLines } from "./projects-github.ts";

/** Heavy folders that say nothing about a project's shape. Hidden entries are skipped too. */
export const PROJECT_IGNORE = ["node_modules", "__pycache__", "target", "venv", "env", "dist", "build", "vendor"];
export const MAX_DEPTH = 12;
export const MAX_ITEMS_PER_PROJECT = 5000;
const MAX_LINES = 200_000;
const SSH_TIMEOUT_MS = 25_000;

export interface ProjectNode { n: string; t: "d" | "f" | "more"; c?: ProjectNode[] }
export interface Project {
  /** `${sourceId}:${name}`, stable across scans; the layout is keyed by it. */
  id: string;
  name: string;
  sourceId: string;
  files: number;
  dirs: number;
  truncated: boolean;
  tree: ProjectNode[];
}

const idSchema = z.string().min(1).max(200);
const sourceSchema = z.object({
  id: z.string().regex(/^[\w-]{1,40}$/),
  label: z.string().trim().min(1).max(60),
  kind: z.enum(["local", "ssh", "github"]),
  // An ssh alias or user@host; never an option.
  host: z.string().regex(/^[\w.@-]{1,120}$/).refine((h) => !h.startsWith("-")).optional(),
  path: z.string().trim().min(1).max(500),
}).strict()
  .refine((s) => s.kind !== "ssh" || Boolean(s.host), { message: "An SSH source needs a host" })
  .refine((s) => s.kind !== "github" || /^[A-Za-z0-9-]{1,39}(\/(?!\.\.?$)[\w.-]{1,100})?$/.test(s.path), { message: "Use owner or owner/repo" });

export const projectMapStateSchema = z.object({
  sources: z.array(sourceSchema).max(20).default([]),
  pos: z.record(idSchema, z.object({ x: z.number().finite(), y: z.number().finite() })).default({}),
  groups: z.array(z.object({
    id: z.string().regex(/^[\w-]{1,40}$/),
    name: z.string().trim().min(1).max(60),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })).max(50).default([]),
  member: z.record(idSchema, z.string().max(40)).default({}),
  links: z.array(z.object({ a: idSchema, b: idSchema, label: z.string().max(60).default("") })).max(500).default([]),
  collapsed: z.record(idSchema, z.literal(1)).default({}),
  zoom: z.number().min(0.2).max(2).default(1),
  help: z.boolean().default(true),
});
export type ProjectSource = z.infer<typeof sourceSchema>;
export type ProjectMapState = z.infer<typeof projectMapStateSchema>;

export function statePath(dataDir: string): string {
  return join(dataDir, "projects-map.json");
}

export function readProjectMapState(dataDir: string): ProjectMapState {
  try {
    const parsed = projectMapStateSchema.safeParse(JSON.parse(readFileSync(statePath(dataDir), "utf8")));
    if (parsed.success) return parsed.data;
  } catch { /* missing or unreadable: start empty */ }
  return projectMapStateSchema.parse({});
}

export function writeProjectMapState(dataDir: string, state: ProjectMapState): void {
  writeFileAtomic(statePath(dataDir), JSON.stringify(state, null, 2));
}

const skipped = (name: string) => name.startsWith(".") || PROJECT_IGNORE.includes(name);

/** Lines "d rel/path" or "f rel/path", relative to the source root (same shape the SSH scan prints). */
export function scanLocalLines(root: string): string[] {
  const lines: string[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > MAX_DEPTH || lines.length >= MAX_LINES) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (skipped(entry.name) || lines.length >= MAX_LINES) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      // Dirent types do not follow symlinks, so a link to a folder is listed as a file: no loops.
      if (entry.isDirectory()) {
        lines.push(`d ${childRel}`);
        walk(join(dir, entry.name), childRel, depth + 1);
      } else {
        lines.push(`f ${childRel}`);
      }
    }
  };
  walk(root, "", 0);
  return lines;
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The remote command: GNU find, pruning hidden and heavy folders, one entry per line. */
export function sshFindCommand(path: string): string {
  const prune = ["'.*'", ...PROJECT_IGNORE.map((name) => shellQuote(name))].map((n) => `-name ${n}`).join(" -o ");
  // A leading ~ must stay unquoted for the remote shell to expand it.
  const target = path === "~" ? "~" : path.startsWith("~/") ? `~/${shellQuote(path.slice(2))}` : shellQuote(path);
  return `find ${target} -mindepth 1 -maxdepth ${MAX_DEPTH + 1} \\( ${prune} \\) -prune -o \\( -type d -printf 'd %P\\n' -o -printf 'f %P\\n' \\) 2>/dev/null | head -n ${MAX_LINES}`;
}

export function scanSshLines(host: string, path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, sshFindCommand(path)],
      { timeout: SSH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // find exits non-zero on unreadable folders; only fail when nothing came back.
        if (error && !stdout) return reject(new Error(String(stderr || error.message).trim().split("\n").pop() || "SSH failed"));
        resolve(stdout.split("\n").filter(Boolean));
      },
    );
  });
}

interface Builder { name: string; dir: boolean; kids: Map<string, Builder> }

function finish(node: Builder): ProjectNode[] {
  return [...node.kids.values()]
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map((kid) => (kid.dir ? { n: kid.name, t: "d" as const, c: finish(kid) } : { n: kid.name, t: "f" as const }));
}

/** Each first-level folder is a project; first-level files are left out. */
export function projectsFromLines(sourceId: string, lines: readonly string[]): Project[] {
  const roots = new Map<string, { root: Builder; files: number; dirs: number; items: number; truncated: boolean }>();
  for (const line of lines) {
    const kind = line[0];
    const rel = line.slice(2);
    if ((kind !== "d" && kind !== "f") || line[1] !== " " || !rel) continue;
    const parts = rel.split("/").filter(Boolean);
    if (parts.some(skipped)) continue;
    const [top, ...rest] = parts;
    if (!rest.length) {
      if (kind === "d" && !roots.has(top)) roots.set(top, { root: { name: top, dir: true, kids: new Map() }, files: 0, dirs: 0, items: 0, truncated: false });
      continue;
    }
    const project = roots.get(top);
    if (!project) continue;
    if (project.items >= MAX_ITEMS_PER_PROJECT) { project.truncated = true; continue; }
    let node = project.root;
    rest.forEach((part, i) => {
      const last = i === rest.length - 1;
      let next = node.kids.get(part);
      if (!next) {
        next = { name: part, dir: !last || kind === "d", kids: new Map() };
        node.kids.set(part, next);
        project.items++;
        if (next.dir) project.dirs++; else project.files++;
      }
      node = next;
    });
  }
  return [...roots.values()]
    .sort((a, b) => a.root.name.localeCompare(b.root.name, undefined, { sensitivity: "base" }))
    .map(({ root, files, dirs, truncated }) => ({
      id: `${sourceId}:${root.name}`,
      name: root.name,
      sourceId,
      files,
      dirs,
      truncated,
      tree: truncated ? [...finish(root), { n: "", t: "more" as const }] : finish(root),
    }));
}

export async function scanSource(source: ProjectSource): Promise<Project[]> {
  const lines = source.kind === "ssh" ? await scanSshLines(source.host!, source.path)
    : source.kind === "github" ? await scanGithubLines(source.path.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "").replace(/\.git$|\/$/g, ""))
    : scanLocalLines(source.path.replace(/^~(?=$|\/)/, homedir()));
  return projectsFromLines(source.id, lines);
}
