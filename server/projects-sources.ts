import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";

import { aliasesFromTsconfig, CODE_EXTENSIONS, MAX_CODE_FILES, parseImports, type FileImports } from "./projects-architecture.ts";
import { cachedForPush, githubTarball, type GithubRepo } from "./projects-github.ts";
import { PROJECT_IGNORE, remoteShellPath, shellQuote } from "./projects.ts";
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

const MAX_GREP_LINES = 200_000;
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
  const grep = `grep -rEnIZ ${includes} ${excludes} -e ${shellQuote(IMPORT_LINE_PATTERN)} . 2>/dev/null | head -n ${MAX_GREP_LINES}`;
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
const MB = 1024 * 1024;
const CONFIG_FILES = new Set(["tsconfig.json", "tsconfig.app.json", "go.mod"]);

function unpackGithubTarball(fullName: string, gz: Uint8Array): ImportSet {
  let tarBytes: Uint8Array;
  try {
    tarBytes = gunzipSync(gz, { maxOutputLength: MAX_TARBALL_BYTES });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new Error(`GitHub archive of ${fullName} is larger than ${MAX_TARBALL_BYTES / MB} MB unpacked`);
    }
    throw new Error(`GitHub archive of ${fullName} could not be read`);
  }
  const decoder = new TextDecoder();
  const read: FileImports[] = [];
  const config = new Map<string, string>();
  for (const entry of readTar(tarBytes)) {
    const path = entry.path.slice(entry.path.indexOf("/") + 1);
    if (!path || entry.data.length > MAX_FILE_BYTES) continue;
    if (CONFIG_FILES.has(path)) config.set(path, decoder.decode(entry.data));
    else if (isCodeFile(path) && read.length < MAX_CODE_FILES) read.push({ path, imports: parseImports(path, decoder.decode(entry.data)) });
  }
  return {
    read,
    tsconfig: pickTsconfig(config.get("tsconfig.json") ?? null, config.get("tsconfig.app.json") ?? null),
    goMod: config.get("go.mod") ?? null,
  };
}

export function readGithubImports(repo: GithubRepo): Promise<ImportSet> {
  return cachedForPush(repo, "imports", async () => unpackGithubTarball(repo.fullName, await githubTarball(repo.fullName, repo.defaultBranch)));
}
