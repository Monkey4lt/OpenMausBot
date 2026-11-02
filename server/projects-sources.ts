import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { aliasesFromTsconfig, CODE_EXTENSIONS, MAX_CODE_FILES, parseImports, type FileImports } from "./projects-architecture.ts";
import { cachedForPush, githubContents, githubRepo, githubTarball, type GithubRepo } from "./projects-github.ts";
import { isManifestPath } from "./projects-inspect.ts";
import { existingFolder, githubTarget, localRoot, PROJECT_IGNORE, remoteShellPath, shellQuote, type ProjectSource } from "./projects.ts";
import { readTar } from "./tar.ts";

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

/** A regular file under `root` reached without any symlink, so a link cannot pull in a file from outside the project. */
async function readSmallText(root: string, path: string): Promise<string | null> {
  try {
    const parts = path.split("/");
    let at = root;
    for (const [i, part] of parts.entries()) {
      at = join(at, part);
      const info = await lstat(at);
      if (info.isSymbolicLink()) return null;
      if (i === parts.length - 1 && (!info.isFile() || info.size > MAX_FILE_BYTES)) return null;
    }
    return await readFile(at, "utf8");
  } catch {
    return null;
  }
}

function insideRoot(root: string, path: string): boolean {
  const rel = relative(root, join(root, ...path.split("/")));
  return Boolean(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function readLocalImports(root: string, paths: string[], limit = MAX_CODE_FILES): Promise<ImportSet> {
  const read: FileImports[] = [];
  for (const raw of paths) {
    if (read.length >= limit) break;
    const path = toPosix(raw);
    if (!isCodeFile(path)) continue;
    if (!insideRoot(root, path)) continue;
    const text = await readSmallText(root, path);
    if (text !== null) read.push({ path, imports: parseImports(path, text) });
  }
  const [tsconfig, tsconfigApp, goMod] = await Promise.all(["tsconfig.json", "tsconfig.app.json", "go.mod"].map((name) => readSmallText(root, name)));
  return { read, tsconfig: pickTsconfig(tsconfig, tsconfigApp), goMod };
}

const MAX_GREP_LINES = 200_000;
const MAX_GREP_LINE_CHARS = 4096;
const SSH_IMPORT_TIMEOUT_MS = 60_000;
const SSH_MAX_BUFFER = 64 * 1024 * 1024;
const CONFIG_MARKERS = { tsconfig: "---TSCONFIG---", tsconfigApp: "---TSCONFIG_APP---", goMod: "---GOMOD---" } as const;

const IMPORT_LINE_PATTERN = [
  `(^|[^.[:alnum:]_$])(import|export)([[:space:]]|$|\\()`,
  `require[[:space:]]*\\(`,
  `(^|[[:space:]}])from[[:space:]]*["']`,
  `^[[:space:]]*from[[:space:]]+[.[:alnum:]_]+[[:space:]]+import`,
  `^[[:space:]]*(pub(\\([^)]*\\))?[[:space:]]+)?(use|mod)[[:space:]]`,
  `@(import|use|forward)[[:space:]]`,
  `^[[:space:]]*([[:alpha:]_.][[:alnum:]_.]*[[:space:]]+)?"[^"]+"[[:space:]]*(//.*)?$`,
].join("|");

export function sshImportCommand(projectPath: string): string {
  const includes = CODE_EXTENSIONS.map((ext) => `--include=${shellQuote(`*${ext}`)}`).join(" ");
  const excludes = [`--exclude-dir=${shellQuote(".[!.]*")}`, ...PROJECT_IGNORE.map((name) => `--exclude-dir=${name}`)].join(" ");
  const grep = `grep -rEnIZ ${includes} --exclude=${shellQuote("*.min.*")} ${excludes} -e ${shellQuote(IMPORT_LINE_PATTERN)} . 2>/dev/null | cut -c1-${MAX_GREP_LINE_CHARS} | head -n ${MAX_GREP_LINES}`;
  const config = ([["tsconfig", "tsconfig.json"], ["tsconfigApp", "tsconfig.app.json"], ["goMod", "go.mod"]] as const)
    .map(([key, file]) => `printf '\\n${CONFIG_MARKERS[key]}\\n'; head -c ${MAX_FILE_BYTES} ${file} 2>/dev/null`).join("; ");
  return `cd ${remoteShellPath(projectPath)} && { ${grep}; ${config}; }`;
}

const GREP_LINE_NUL = /^(?:\.\/)?([^\0]+)\0(\d+):(.*)$/;
const GREP_LINE_COLON = /^(?:\.\/)?(.+?):(\d+):(.*)$/;
const GO_IMPORT_OPEN = /\bimport\s*\(\s*$/;
const GO_IMPORT_ENTRY = /^\s*(?:[\w.]+\s+)?"[^"]+"\s*(?:\/\/.*)?$/;

export function parseGrepOutput(out: string): FileImports[] {
  const byFile = new Map<string, Map<number, string>>();
  for (const raw of out.split(/\r?\n/)) {
    const m = GREP_LINE_NUL.exec(raw) ?? GREP_LINE_COLON.exec(raw);
    if (!m) continue;
    const path = toPosix(m[1]);
    if (!isCodeFile(path)) continue;
    const lines = byFile.get(path) ?? new Map<number, string>();
    lines.set(Number(m[2]), m[3]);
    byFile.set(path, lines);
  }
  return [...byFile].map(([path, lines]) => ({ path, imports: parseImports(path, rebuildTextAtOriginalLines(path, lines)) }));
}

function rebuildTextAtOriginalLines(path: string, lines: Map<number, string>): string {
  const numbers = [...lines.keys()].sort((a, b) => a - b);
  const text: string[] = [];
  let goBlockOpen = false;
  numbers.forEach((n, i) => {
    while (text.length < n - 1) text.push("");
    let line = lines.get(n)!;
    if (path.endsWith(".go")) {
      if (GO_IMPORT_OPEN.test(line)) goBlockOpen = true;
      else if (goBlockOpen && GO_IMPORT_ENTRY.test(line)) {
        const next = numbers[i + 1];
        if (next !== n + 1 || !GO_IMPORT_ENTRY.test(lines.get(next)!)) { line += ")"; goBlockOpen = false; }
      }
    }
    text.push(line);
  });
  return text.join("\n");
}

export function parseSshImportOutput(out: string): ImportSet {
  const [grepPart, rest = ""] = splitOnce(out, `\n${CONFIG_MARKERS.tsconfig}\n`);
  const [tsconfigPart, afterTsconfig = ""] = splitOnce(rest, `\n${CONFIG_MARKERS.tsconfigApp}\n`);
  const [appPart, goModPart = ""] = splitOnce(afterTsconfig, `\n${CONFIG_MARKERS.goMod}\n`);
  const orNull = (text: string) => (text.trim() ? text : null);
  return { read: parseGrepOutput(grepPart), tsconfig: pickTsconfig(orNull(tsconfigPart), orNull(appPart)), goMod: orNull(goModPart) };
}

function splitOnce(text: string, marker: string): [string, string?] {
  const at = text.indexOf(marker);
  return at < 0 ? [text] : [text.slice(0, at), text.slice(at + marker.length)];
}

export type SshRunner = (args: string[], options: { timeout: number; maxBuffer: number }) => Promise<string>;

const runSsh: SshRunner = (args, options) => new Promise((resolve, reject) => {
  execFile("ssh", args, options, (error, stdout, stderr) => {
    // grep exits 1 without a match and head exits 1 without a go.mod: the markers say the script ran to its end.
    if (error && !stdout.includes(CONFIG_MARKERS.goMod)) {
      return reject(new Error(String(stderr || error.message).trim().split("\n").pop() || "SSH failed"));
    }
    resolve(stdout);
  });
});

export async function readSshImports(host: string, projectPath: string, run: SshRunner = runSsh): Promise<ImportSet> {
  const out = await run(
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, sshImportCommand(projectPath)],
    { timeout: SSH_IMPORT_TIMEOUT_MS, maxBuffer: SSH_MAX_BUFFER },
  );
  return parseSshImportOutput(out);
}

export const MAX_TARBALL_BYTES = 200 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const CONFIG_FILES = new Set(["tsconfig.json", "tsconfig.app.json", "go.mod"]);

const gunzipAsync = promisify(gunzip);

export function formatBytes(bytes: number): string {
  const MB = 1024 * 1024;
  if (bytes >= MB && bytes % MB === 0) return `${bytes / MB} MB`;
  return bytes >= 1024 && bytes % 1024 === 0 ? `${bytes / 1024} KB` : `${bytes} bytes`;
}

/** The path under GitHub's "<owner>-<repo>-<sha>/" folder; null for anything absolute or climbing out of it. */
function projectPathInArchive(entryPath: string): string | null {
  const [top, ...rest] = entryPath.split("/");
  if (!top || top === "." || top === ".." || !rest.length || rest[0] === "") return null;
  const parts = rest.filter((part) => part && part !== ".");
  return parts.length && !parts.includes("..") ? parts.join("/") : null;
}

async function gunzipArchive(fullName: string, gz: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  try {
    return await gunzipAsync(gz, { maxOutputLength: maxBytes });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) {
      throw new Error(`GitHub archive of ${fullName} is larger than ${formatBytes(maxBytes)} unpacked`);
    }
    throw new Error(`GitHub archive of ${fullName} could not be read`);
  }
}

/** Imports and inspect material from one archive, so a push is downloaded once for both. */
export async function unpackGithubArchive(fullName: string, gz: Uint8Array, maxBytes = MAX_TARBALL_BYTES): Promise<{ imports: ImportSet; inspect: InspectSet }> {
  const tarBytes = await gunzipArchive(fullName, gz, maxBytes);
  const decoder = new TextDecoder();
  const read: FileImports[] = [];
  const config = new Map<string, string>();
  const inspect = inspectCollector();
  for (const entry of readTar(tarBytes)) {
    const path = projectPathInArchive(entry.path);
    if (!path || entry.data.length > MAX_FILE_BYTES) continue;
    const manifest = isInspectManifest(path);
    const code = isCodeFile(path);
    if (!manifest && !code && !CONFIG_FILES.has(path)) continue;
    const text = decoder.decode(entry.data);
    if (CONFIG_FILES.has(path)) config.set(path, text);
    if (manifest) inspect.manifest(path, text);
    if (code) {
      if (read.length < MAX_CODE_FILES) read.push({ path, imports: parseImports(path, text) });
      inspect.code(path, text);
    }
  }
  return {
    imports: { read, tsconfig: pickTsconfig(config.get("tsconfig.json") ?? null, config.get("tsconfig.app.json") ?? null), goMod: config.get("go.mod") ?? null },
    inspect: inspect.done(),
  };
}

export async function unpackGithubTarball(fullName: string, gz: Uint8Array, maxBytes = MAX_TARBALL_BYTES): Promise<ImportSet> {
  return (await unpackGithubArchive(fullName, gz, maxBytes)).imports;
}

function githubArchive(repo: GithubRepo): Promise<{ imports: ImportSet; inspect: InspectSet }> {
  return cachedForPush(repo, "archive", async () => unpackGithubArchive(repo.fullName, await githubTarball(repo.fullName, repo.defaultBranch, MAX_DOWNLOAD_BYTES)));
}

export async function readGithubImports(repo: GithubRepo): Promise<ImportSet> {
  return (await githubArchive(repo)).imports;
}

export async function readGithubInspect(repo: GithubRepo): Promise<InspectSet> {
  return (await githubArchive(repo)).inspect;
}

/** What detectPieces and linkPieces read: manifest texts by path, and the call and route lines of code files. */
export type InspectSet = { manifests: Record<string, string>; texts: { path: string; text: string }[]; truncated: boolean };

/** Characters of call and route lines kept for linking; past it, whole files are left out and `truncated` is set. */
export const MAX_INSPECT_CHARS = 8 * 1024 * 1024;
const MAX_MANIFESTS = 200;
const MAX_LINE_CHARS = 4096;

/** A line that may hold an HTTP call or a route definition; findCalls and findRoutes do the real matching. */
const LINK_LINE = /\b(?:fetch|axios|httpx|requests)\b|\.(?:get|post|put|patch|delete|all|route|api_route|GET|POST|PUT|PATCH|DELETE|Any)\s*\(|^\s*url\s*:/;
const LINK_LINE_ERE = "(fetch|axios|httpx|requests)|\\.(get|post|put|patch|delete|all|route|api_route|GET|POST|PUT|PATCH|DELETE|Any)[[:space:]]*\\(|^[[:space:]]*url[[:space:]]*:";
const CONTROL = /[\u0000-\u001f\u007f]/;

function isInspectManifest(path: string): boolean {
  return isManifestPath(path) && !CONTROL.test(path);
}

function linkLines(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").filter((line) => LINK_LINE.test(line)).map((line) => line.slice(0, MAX_LINE_CHARS)).join("\n");
}

function inspectCollector(maxChars = MAX_INSPECT_CHARS) {
  const manifests: Record<string, string> = {};
  const texts: { path: string; text: string }[] = [];
  let kept = 0;
  let count = 0;
  let truncated = false;
  return {
    manifest(path: string, text: string) {
      if (count >= MAX_MANIFESTS) { truncated = true; return; }
      count++;
      manifests[path] = text;
    },
    code(path: string, text: string, alreadyFiltered = false) {
      const lines = alreadyFiltered ? text : linkLines(text);
      if (!lines) return;
      if (kept + lines.length > maxChars) { truncated = true; return; }
      kept += lines.length;
      texts.push({ path, text: lines });
    },
    done: (): InspectSet => ({ manifests: Object.fromEntries(Object.entries(manifests).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), texts, truncated }),
  };
}

export async function readLocalInspect(root: string, paths: string[], options: { maxChars?: number } = {}): Promise<InspectSet> {
  const collect = inspectCollector(options.maxChars);
  for (const raw of paths) {
    const path = toPosix(raw);
    const manifest = isInspectManifest(path);
    const code = isCodeFile(path);
    if ((!manifest && !code) || !insideRoot(root, path)) continue;
    const text = await readSmallText(root, path);
    if (text === null) continue;
    if (manifest) collect.manifest(path, text);
    if (code) collect.code(path, text);
  }
  return collect.done();
}

const INSPECT_MARKERS = { manifest: "---OMB-MANIFEST---", end: "---OMB-INSPECT-END---" } as const;

/** One remote command: grep the call and route lines of code files, then print each manifest that is a regular file, never a link. */
export function sshInspectCommand(projectPath: string, manifests: string[]): string {
  const includes = CODE_EXTENSIONS.map((ext) => `--include=${shellQuote(`*${ext}`)}`).join(" ");
  const excludes = [`--exclude-dir=${shellQuote(".[!.]*")}`, ...PROJECT_IGNORE.map((name) => `--exclude-dir=${name}`)].join(" ");
  const grep = `grep -rEnIZ ${includes} --exclude=${shellQuote("*.min.*")} ${excludes} -e ${shellQuote(LINK_LINE_ERE)} . 2>/dev/null | cut -c1-${MAX_GREP_LINE_CHARS} | head -n ${MAX_GREP_LINES}`;
  const prints = manifests.filter(isInspectManifest).slice(0, MAX_MANIFESTS).map((path) => {
    const q = shellQuote(path);
    return `if [ -f ${q} ] && [ ! -L ${q} ]; then printf '\\n${INSPECT_MARKERS.manifest}\\n%s\\n' ${q}; head -c ${MAX_FILE_BYTES} ${q}; fi`;
  }).join("; ");
  return `cd ${remoteShellPath(projectPath)} && { ${grep}; ${prints ? `${prints}; ` : ""}printf '\\n${INSPECT_MARKERS.end}\\n'; }`;
}

export function parseSshInspectOutput(out: string, maxChars = MAX_INSPECT_CHARS): InspectSet {
  const body = out.slice(0, Math.max(0, out.lastIndexOf(`\n${INSPECT_MARKERS.end}\n`)));
  const [grepPart, ...manifestParts] = (body || out).split(`\n${INSPECT_MARKERS.manifest}\n`);
  const collect = inspectCollector(maxChars);
  for (const part of manifestParts) {
    const newline = part.indexOf("\n");
    if (newline < 0) continue;
    const path = part.slice(0, newline);
    if (isInspectManifest(path)) collect.manifest(path, part.slice(newline + 1));
  }
  const byFile = new Map<string, string[]>();
  for (const raw of grepPart.split(/\r?\n/)) {
    const m = GREP_LINE_NUL.exec(raw) ?? GREP_LINE_COLON.exec(raw);
    if (!m) continue;
    const path = toPosix(m[1]);
    if (!isCodeFile(path) || !LINK_LINE.test(m[3])) continue;
    byFile.set(path, [...byFile.get(path) ?? [], m[3]]);
  }
  for (const [path, lines] of byFile) collect.code(path, lines.join("\n"), true);
  return collect.done();
}

const runSshInspect: SshRunner = (args, options) => new Promise((resolve, reject) => {
  execFile("ssh", args, options, (error, stdout, stderr) => {
    if (error && !stdout.includes(INSPECT_MARKERS.end)) return reject(new Error(String(stderr || error.message).trim().split("\n").pop() || "SSH failed"));
    resolve(stdout);
  });
});

export async function readSshInspect(host: string, projectPath: string, manifests: string[], run: SshRunner = runSshInspect): Promise<InspectSet> {
  const out = await run(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, sshInspectCommand(projectPath, manifests)], { timeout: SSH_IMPORT_TIMEOUT_MS, maxBuffer: SSH_MAX_BUFFER });
  return parseSshInspectOutput(out);
}

export const DEFAULT_FILE_CHARS = 8000;
export const MAX_FILE_CHARS = 20_000;

const SECRET_NAME = /^\.env|\.(?:pem|key|p12|pfx)$|^id_(?:rsa|dsa|ecdsa|ed25519)/i;

/**
 * Why a project-relative path is never read, or null. Security invariant: hidden entries, ignored folders,
 * environment files, keys and anything named like a secret stay unread, whatever the Cartographe asks.
 */
export function fileRefusal(path: string): string | null {
  if (!path || path.length > 500 || CONTROL.test(path) || path.includes("\\") || path.startsWith("/")) return "Give a path relative to the project, with / between folders.";
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return "Give a path relative to the project, with / between folders.";
  if (parts.some((part) => part.startsWith("."))) return "Hidden files and folders are never read.";
  if (parts.some((part) => PROJECT_IGNORE.includes(part))) return "Files in ignored folders are never read.";
  if (parts.some((part) => /secret/i.test(part)) || SECRET_NAME.test(parts.at(-1)!)) return "Keys, secrets and environment files are never read.";
  return null;
}

export type FileRead = { text: string } | { error: string };

const LINK_REFUSAL = "That path goes through a link, which is never read.";
const NOT_A_FILE = "That path is not a file of the project.";
const TOO_LARGE = `That file is larger than ${formatBytes(MAX_FILE_BYTES)}.`;
const NOT_TEXT = "That file is not a text file.";

const asText = (text: string): FileRead => (text.includes("\u0000") ? { error: NOT_TEXT } : { text });

export async function readLocalFile(root: string, path: string): Promise<FileRead> {
  if (!insideRoot(root, path)) return { error: NOT_A_FILE };
  const parts = path.split("/");
  let at = root;
  try {
    for (const [i, part] of parts.entries()) {
      at = join(at, part);
      const info = await lstat(at);
      if (info.isSymbolicLink()) return { error: LINK_REFUSAL };
      if (i === parts.length - 1) {
        if (!info.isFile()) return { error: NOT_A_FILE };
        if (info.size > MAX_FILE_BYTES) return { error: TOO_LARGE };
      }
    }
    return asText(await readFile(at, "utf8"));
  } catch {
    return { error: NOT_A_FILE };
  }
}

const FILE_STATUS = { ok: "OMB-FILE-OK", link: "OMB-FILE-LINK", none: "OMB-FILE-NONE", big: "OMB-FILE-BIG" } as const;

/** One remote command: refuses a link anywhere along the path, a non-file and a file over the cap, else prints the file. */
export function sshFileCommand(projectPath: string, path: string): string {
  return [
    `cd ${remoteShellPath(projectPath)} || exit 1`,
    `p=${shellQuote(path)}`,
    `set -f; q=; IFS=/; for s in $p; do q="\${q:+$q/}$s"; if [ -L "$q" ]; then echo ${FILE_STATUS.link}; exit 0; fi; done; unset IFS`,
    `if [ ! -f "$p" ]; then echo ${FILE_STATUS.none}; exit 0; fi`,
    `n=$(wc -c < "$p" | tr -d ' ')`,
    `if [ "$n" -gt ${MAX_FILE_BYTES} ]; then echo ${FILE_STATUS.big}; exit 0; fi`,
    `echo ${FILE_STATUS.ok}; head -c ${MAX_FILE_BYTES} "$p"`,
  ].join("\n");
}

export function parseSshFileOutput(out: string): FileRead {
  const newline = out.indexOf("\n");
  const status = (newline < 0 ? out : out.slice(0, newline)).trim();
  if (status === FILE_STATUS.ok) return asText(out.slice(newline + 1));
  if (status === FILE_STATUS.link) return { error: LINK_REFUSAL };
  if (status === FILE_STATUS.big) return { error: TOO_LARGE };
  return { error: NOT_A_FILE };
}

export async function readSshFile(host: string, projectPath: string, path: string, run: SshRunner = runSshFile): Promise<FileRead> {
  return parseSshFileOutput(await run(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, sshFileCommand(projectPath, path)], { timeout: SSH_IMPORT_TIMEOUT_MS, maxBuffer: 2 * MAX_FILE_BYTES }));
}

const runSshFile: SshRunner = (args, options) => new Promise((resolve, reject) => {
  execFile("ssh", args, options, (error, stdout, stderr) => {
    if (error && !stdout.startsWith("OMB-FILE-")) return reject(new Error(String(stderr || error.message).trim().split("\n").pop() || "SSH failed"));
    resolve(stdout);
  });
});

export async function readGithubFile(repo: GithubRepo, path: string): Promise<FileRead> {
  const entry = await githubContents(repo.fullName, path, repo.defaultBranch);
  if (Array.isArray(entry) || !entry || typeof entry !== "object") return { error: NOT_A_FILE };
  const file = entry as { type?: unknown; size?: unknown; encoding?: unknown; content?: unknown };
  if (file.type === "symlink") return { error: LINK_REFUSAL };
  if (file.type !== "file") return { error: NOT_A_FILE };
  if (typeof file.size !== "number" || file.size > MAX_FILE_BYTES) return { error: TOO_LARGE };
  if (file.encoding !== "base64" || typeof file.content !== "string") return { error: NOT_TEXT };
  return asText(new TextDecoder().decode(Buffer.from(file.content, "base64")));
}

/** One file of `projectName` under `source`, cut to `maxChars`; the caller checks it is in the project's listed tree. */
export async function readProjectFile(source: ProjectSource, projectName: string, path: string, maxChars = DEFAULT_FILE_CHARS): Promise<{ text: string; truncated: boolean } | { error: string }> {
  const refused = fileRefusal(path);
  if (refused) return { error: refused };
  let read: FileRead;
  if (source.kind === "local") read = await readLocalFile(join(existingFolder(localRoot(source.path)), projectName), path);
  else if (source.kind === "ssh") read = await readSshFile(source.host!, `${source.path.replace(/\/+$/, "")}/${projectName}`, path);
  else {
    const [owner, single] = githubTarget(source.path).split("/");
    read = await readGithubFile(await githubRepo(`${owner}/${single ?? projectName}`), path);
  }
  if ("error" in read) return read;
  const cap = Math.min(Math.max(1, Math.floor(maxChars)), MAX_FILE_CHARS);
  return { text: read.text.slice(0, cap), truncated: read.text.length > cap };
}
