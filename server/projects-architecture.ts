import { FAMILY_ORDER, MAX_CODE_FILES } from "../shared/projects-architecture.ts";
import type { ArchOverrides, Architecture, Family } from "../shared/projects-architecture.ts";

export { FAMILY_ORDER, MAX_CODE_FILES };
export type { ArchOverrides, Architecture, Family };

interface FamilyRule {
  dirs: readonly string[];
  names: readonly RegExp[];
  exts: readonly string[];
  namesOnlyWithExts?: readonly string[];
  dirsNotForExts?: Readonly<Record<string, readonly string[]>>;
}

const SERVER_LANGUAGE_EXTS = [".py", ".rb", ".go", ".rs", ".php", ".java"];

const RULES: Record<Exclude<Family, "other">, FamilyRule> = {
  tests: { dirs: ["test", "tests", "__tests__", "spec"], names: [/\.(test|spec)\./i, /_test\.go$/i, /^test_.*\.py$/i], exts: [] },
  docs: { dirs: ["docs"], names: [/^(readme|changelog|license)/i], exts: [".md", ".mdx", ".rst"], namesOnlyWithExts: ["", ".md", ".mdx", ".txt", ".rst"] },
  i18n: { dirs: ["locales", "i18n", "lang"], names: [], exts: [".po"] },
  data: { dirs: ["migrations", "db", "database", "models", "prisma"], names: [/^schema/i], exts: [".sql", ".prisma"] },
  config: {
    dirs: [".github"],
    names: [/^package\.json$/i, /^tsconfig/i, /\.config\./i, /^dockerfile/i, /^(docker-)?compose.*\.ya?ml$/i, /\.env\.example$/i],
    exts: [".toml"],
  },
  scripts: { dirs: ["scripts", "bin"], names: [/^makefile$/i], exts: [".sh", ".ps1", ".bat"] },
  assets: {
    dirs: ["public", "assets", "static"],
    names: [],
    exts: [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".avif", ".bmp", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".ogg"],
  },
  ui: {
    dirs: ["components", "pages", "app", "views", "ui"],
    names: [],
    dirsNotForExts: { app: SERVER_LANGUAGE_EXTS },
    exts: [".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".sass", ".less", ".html"],
  },
  server: {
    dirs: ["server", "api", "routes", "controllers", "services", "backend"],
    names: [],
    exts: [".go", ".rs", ".py", ".rb", ".php", ".java", ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"],
  },
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function classify(path: string): Family {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop() ?? "";
  const dirs = parts.map((p) => p.toLowerCase());
  const ext = extensionOf(name);
  for (const family of FAMILY_ORDER) {
    if (family === "other") break;
    const rule = RULES[family];
    const dirHit = dirs.some((d) => rule.dirs.includes(d) && !rule.dirsNotForExts?.[d]?.includes(ext));
    const nameHit = (!rule.namesOnlyWithExts || rule.namesOnlyWithExts.includes(ext)) && rule.names.some((re) => re.test(name));
    if (dirHit || nameHit || rule.exts.includes(ext)) return family;
  }
  return "other";
}

export type ModuleInfo = { id: string; family: Family; files: string[] };

export const MIN_MODULE_FILES = 3;
export const MAX_MODULE_DEPTH = 3;
export const ROOT_MODULE = "(root)";

interface DirNode { files: string[]; kids: Map<string, DirNode> }

function dirTree(paths: string[]): DirNode {
  const root: DirNode = { files: [], kids: new Map() };
  for (const path of paths) {
    const dirs = path.split("/").filter(Boolean).slice(0, -1).slice(0, MAX_MODULE_DEPTH);
    let node = root;
    for (const dir of dirs) {
      let next = node.kids.get(dir);
      if (!next) node.kids.set(dir, next = { files: [], kids: new Map() });
      node = next;
    }
    node.files.push(path);
  }
  return root;
}

function carveModulesBottomUp(node: DirNode, prefix: string[], out: { prefix: string; files: string[] }[]): string[] {
  const loose = [...node.files];
  for (const [name, kid] of node.kids) loose.push(...carveModulesBottomUp(kid, [...prefix, name], out));
  if (prefix.length && loose.length >= MIN_MODULE_FILES) {
    out.push({ prefix: prefix.join("/"), files: loose });
    return [];
  }
  return loose;
}

function overrideOf<T>(table: Partial<Record<string, T>> | undefined, key: string): T | undefined {
  return table && Object.hasOwn(table, key) ? table[key] : undefined;
}

export function modulesOf(paths: string[], overrides?: ArchOverrides): ModuleInfo[] {
  const byFamily = new Map<Family, string[]>();
  for (const path of paths) {
    const family = classify(path);
    byFamily.set(family, [...byFamily.get(family) ?? [], path]);
  }
  const found: { prefix: string; family: Family; files: string[] }[] = [];
  for (const [family, files] of byFamily) {
    const carved: { prefix: string; files: string[] }[] = [];
    const rest = carveModulesBottomUp(dirTree(files), [], carved);
    if (rest.length) carved.push({ prefix: `${ROOT_MODULE}/${family}`, files: rest });
    found.push(...carved.map((m) => ({ ...m, family })));
  }
  const rank = (f: Family) => FAMILY_ORDER.indexOf(f);
  const owner = new Map<string, Family>();
  for (const m of found) {
    const best = owner.get(m.prefix);
    if (!best || rank(m.family) < rank(best)) owner.set(m.prefix, m.family);
  }
  return found
    .map((m) => {
      const id = owner.get(m.prefix) === m.family ? m.prefix : `${m.prefix}#${m.family}`;
      return { id, family: overrideOf(overrides?.moduleFamily, id) ?? m.family, files: [...m.files].sort() };
    })
    .sort((a, b) => rank(a.family) - rank(b.family) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type ImportRef = { spec: string; line: number };

interface Syntax { lineComment: string | null; blockComment: boolean; quotes: string; tripleQuotes: boolean; regexLiterals?: boolean; markupComments?: boolean }

const C_LIKE: Syntax = { lineComment: "//", blockComment: true, quotes: "\"'`", tripleQuotes: false };
type Language = "js" | "sfc" | "css" | "scss" | "py" | "go" | "rs";

const SYNTAX: Record<Language, Syntax> = {
  js: { ...C_LIKE, regexLiterals: true },
  sfc: { ...C_LIKE, regexLiterals: true, markupComments: true },
  css: { lineComment: null, blockComment: true, quotes: "\"'", tripleQuotes: false },
  scss: { lineComment: "//", blockComment: true, quotes: "\"'", tripleQuotes: false },
  py: { lineComment: "#", blockComment: false, quotes: "\"'", tripleQuotes: true },
  go: C_LIKE,
  rs: { lineComment: "//", blockComment: true, quotes: "\"", tripleQuotes: false },
};

const LANGUAGE_OF: Partial<Record<string, Language>> = {
  ".ts": "js", ".tsx": "js", ".mts": "js", ".cts": "js", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".vue": "sfc", ".svelte": "sfc",
  ".css": "css", ".scss": "scss", ".sass": "scss", ".less": "scss",
  ".py": "py", ".go": "go", ".rs": "rs",
};

export const CODE_EXTENSIONS: readonly string[] = Object.keys(LANGUAGE_OF);

function blankCommentsKeepingOffsets(text: string, syntax: Syntax): { code: string; strings: [number, number][] } {
  const parts: string[] = [];
  const strings: [number, number][] = [];
  let kept = 0;
  const blank = (from: number, to: number) => {
    parts.push(text.slice(kept, from), text.slice(from, to).replace(/[^\n]/g, " "));
    kept = to;
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (syntax.tripleQuotes && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const close = text.indexOf(text.slice(i, i + 3), i + 3);
      const end = close < 0 ? text.length : close + 3;
      blank(i, end); i = end; continue;
    }
    if (syntax.quotes.includes(ch)) {
      let j = i + 1;
      while (j < text.length && text[j] !== ch && (ch === "`" || text[j] !== "\n")) j += text[j] === "\\" ? 2 : 1;
      strings.push([i, j]); i = j + 1; continue;
    }
    if (syntax.lineComment && text.startsWith(syntax.lineComment, i)) {
      const nl = text.indexOf("\n", i);
      const end = nl < 0 ? text.length : nl;
      blank(i, end); i = end; continue;
    }
    if (syntax.blockComment && text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      const end = close < 0 ? text.length : close + 2;
      blank(i, end); i = end; continue;
    }
    if (syntax.markupComments && text.startsWith("<!--", i)) {
      const close = text.indexOf("-->", i + 4);
      const end = close < 0 ? text.length : close + 3;
      blank(i, end); i = end; continue;
    }
    if (syntax.regexLiterals && ch === "/" && startsRegexLiteral(text, i)) {
      const end = regexLiteralEnd(text, i);
      blank(i, end); i = end; continue;
    }
    i++;
  }
  parts.push(text.slice(kept));
  return { code: parts.join(""), strings };
}

const BEFORE_REGEX = "(,=:[!&|?{};+-*%<>~^";

function startsRegexLiteral(text: string, slash: number): boolean {
  let k = slash - 1;
  while (k >= 0 && (text[k] === " " || text[k] === "\t")) k--;
  if (k < 0 || text[k] === "\n") return true;
  if (BEFORE_REGEX.includes(text[k])) return true;
  return /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await)$/.test(text.slice(Math.max(0, k - 6), k + 1));
}

function regexLiteralEnd(text: string, slash: number): number {
  let inClass = false;
  for (let j = slash + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\n") return j;
    if (c === "\\") j++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      let end = j + 1;
      while (end < text.length && /[a-z]/i.test(text[end])) end++;
      return end;
    }
  }
  return text.length;
}

type Found = { spec: string; at: number };

const JS_STATIC = /(?<![.\w$])(?:import|export)\s+(?:type\s+)?(?:[\w$*{},][\w$*{},\s]{0,2000}?\bfrom\s*)?(["'])([^"'\n]+)\1/g;
const JS_CALL = /(?<![.\w$])(?:import|require)\s*\(\s*(["'`])([^"'`\n]+)\1\s*\)/g;
const CSS_IMPORT = /@(?:import|use|forward)\s+(?:url\(\s*)?(["'])([^"'\n]+)\1/g;
const CSS_URL = /@import\s+url\(\s*([^"'\s)]+)\s*\)/g;
const PY_IMPORT = /(?:^|;)[ \t]*import[ \t]+([^\n;#]+)/gm;
const PY_FROM = /(?:^|;)[ \t]*from[ \t]+(\.*\w[\w.]*|\.+)[ \t]+import[ \t]*(\([^()]{0,4000}\)|[^\n;#]+)/gm;
const GO_SINGLE = /\bimport[ \t]+(?:[\w.]+[ \t]+)?"([^"\n]+)"/g;
const GO_BLOCK = /\bimport\s*\(([^()]*)\)/g;
const GO_SPEC = /(?:[\w.]+[ \t]+)?"([^"\n]+)"/g;
const RS_MOD = /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm;
const RS_USE = /^[ \t]*(?:pub(?:\([^)\n]{0,40}\))?[ \t]+)?use[ \t]+([^;]{1,4000});/gm;

function findAll(re: RegExp, code: string, group: number): Found[] {
  return [...code.matchAll(re)].map((m) => ({ spec: m[group], at: m.index }));
}

function pythonFromSpecs(module: string, names: string): string[] {
  const listed = names.replace(/[()]/g, " ").split(",").map((part) => part.trim().split(/\s+/)[0]).filter((name) => /^\w+$/.test(name));
  if (!listed.length) return [module];
  return listed.map((name) => (/^\.+$/.test(module) ? `${module}${name}` : `${module}.${name}`));
}

function expandRustUse(tree: string): string[] {
  const text = tree.replace(/\s+as\s+\w+/g, "").replace(/\s+/g, "");
  let i = 0;
  const group = (prefix: string): string[] => {
    const out: string[] = [];
    for (;;) {
      out.push(...path(prefix));
      if (text[i] === ",") { i++; if (text[i] === "}") break; continue; }
      break;
    }
    return out;
  };
  const path = (prefix: string): string[] => {
    const start = i;
    while (i < text.length && /[\w:]/.test(text[i])) i++;
    let segment = text.slice(start, i).replace(/^::|::$/g, "");
    if (text[i] === "*") i++;
    if (segment === "self" && prefix) segment = "";
    const full = [prefix, segment].filter(Boolean).join("::");
    if (text[i] !== "{") return full ? [full] : [];
    i++;
    const inner = group(full);
    if (text[i] === "}") i++;
    return inner;
  };
  return [...new Set(group(""))];
}

function findImports(language: Language, code: string): Found[] {
  switch (language) {
    case "js": case "sfc": return [...findAll(JS_STATIC, code, 2), ...findAll(JS_CALL, code, 2)];
    case "css": case "scss": return [...findAll(CSS_IMPORT, code, 2), ...findAll(CSS_URL, code, 1)];
    case "py": return [
      ...[...code.matchAll(PY_IMPORT)].flatMap((m) => m[1].split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter((name) => /^[\w.]+$/.test(name))
        .map((spec) => ({ spec, at: m.index }))),
      ...[...code.matchAll(PY_FROM)].flatMap((m) => pythonFromSpecs(m[1], m[2]).map((spec) => ({ spec, at: m.index }))),
    ];
    case "go": return [
      ...findAll(GO_SINGLE, code, 1),
      ...[...code.matchAll(GO_BLOCK)].flatMap((block) => {
        const body = block.index + block[0].indexOf("(") + 1;
        return [...block[1].matchAll(GO_SPEC)].map((m) => ({ spec: m[1], at: body + m.index + m[0].indexOf('"') }));
      }),
    ];
    case "rs": return [
      ...findAll(RS_MOD, code, 1).map((f) => ({ ...f, spec: `self::${f.spec}` })),
      ...findAll(RS_USE, code, 1).flatMap((f) => expandRustUse(f.spec).map((spec) => ({ spec, at: f.at }))),
    ];
  }
}

export function parseImports(path: string, text: string): ImportRef[] {
  const language = LANGUAGE_OF[extensionOf(path)];
  if (!language) return [];
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const { code, strings } = blankCommentsKeepingOffsets(normalized, SYNTAX[language]);
  const lineStarts = [0];
  for (let i = 0; i < normalized.length; i++) if (normalized[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (at: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= at) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const insideString = (at: number) => {
    let lo = 0, hi = strings.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [from, to] = strings[mid];
      if (at <= from) hi = mid - 1; else if (at > to) lo = mid + 1; else return true;
    }
    return false;
  };
  return findImports(language, code)
    .filter((found) => !insideString(found.at))
    .sort((a, b) => a.at - b.at)
    .map((found) => ({ spec: found.spec, line: lineOf(found.at) }));
}

const JS_TRIES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".css", ".scss", "/index.ts", "/index.tsx", "/index.js"];
const ESM_TS_TWINS: Record<string, readonly string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

function normalizeWithinRoot(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.join("/");
}

const dirnameOf = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const joinPath = (dir: string, rest: string) => normalizeWithinRoot(dir ? `${dir}/${rest}` : rest);
const firstExisting = (candidates: string[], files: ReadonlySet<string>) => candidates.find((c) => files.has(c)) ?? null;

function applyAlias(spec: string, aliases: Record<string, string>): string | null {
  const keys = Object.keys(aliases).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (key.endsWith("/") ? spec.startsWith(key) || spec === key.slice(0, -1) : spec === key) {
      return aliases[key] + spec.slice(key.length).replace(/^\//, "");
    }
  }
  return null;
}

const CONVENTIONAL_ROOT_ALIAS = /^[@~]\//;

function resolveScript(from: string, spec: string, files: ReadonlySet<string>, aliases: Record<string, string>): string | null {
  if (spec.startsWith("./") || spec.startsWith("../")) return resolveScriptPath(joinPath(dirnameOf(from), spec), files);
  if (spec.startsWith("/")) return resolveScriptPath(spec, files);
  const aliased = applyAlias(spec, aliases);
  if (aliased !== null) return resolveScriptPath(aliased, files);
  if (!CONVENTIONAL_ROOT_ALIAS.test(spec)) return null;
  const rest = spec.slice(2);
  return resolveScriptPath(`src/${rest}`, files) ?? resolveScriptPath(rest, files);
}

function resolveScriptPath(target: string | null, files: ReadonlySet<string>): string | null {
  if (target === null) return null;
  const base = normalizeWithinRoot(target);
  if (base === null) return null;
  const direct = firstExisting(JS_TRIES.map((ext) => base + ext), files);
  if (direct) return direct;
  const ext = extensionOf(base);
  const twin = firstExisting((ESM_TS_TWINS[ext] ?? []).map((t) => base.slice(0, -ext.length) + t), files);
  if (twin) return twin;
  const slash = base.lastIndexOf("/");
  const partial = `${base.slice(0, slash + 1)}_${base.slice(slash + 1)}`;
  return firstExisting([".scss", ".sass", ""].map((e) => partial + e), files);
}

function resolvePython(from: string, spec: string, files: ReadonlySet<string>): string | null {
  const dots = /^\.*/.exec(spec)![0].length;
  let base = "";
  if (dots) {
    base = dirnameOf(from);
    for (let i = 1; i < dots; i++) {
      if (!base) return null;
      base = dirnameOf(base);
    }
  }
  const segments = spec.slice(dots).split(".").filter(Boolean);
  for (let n = segments.length; n > 0; n--) {
    const target = [base, ...segments.slice(0, n)].filter(Boolean).join("/");
    const found = firstExisting([`${target}.py`, `${target}/__init__.py`], files);
    if (found) return found;
  }
  return dots ? firstExisting([`${base ? `${base}/` : ""}__init__.py`], files) : null;
}

function rustModuleDir(from: string): string {
  const dir = dirnameOf(from);
  const name = from.slice(from.lastIndexOf("/") + 1);
  return ["main.rs", "lib.rs", "mod.rs"].includes(name) ? dir : (dir ? `${dir}/` : "") + name.replace(/\.rs$/, "");
}

function rustCrateRoot(from: string): string {
  const parts = from.split("/");
  const src = parts.lastIndexOf("src", parts.length - 2);
  return src >= 0 ? parts.slice(0, src + 1).join("/") : dirnameOf(from);
}

function resolveRust(from: string, spec: string, files: ReadonlySet<string>): string | null {
  const [head, ...segments] = spec.split("::").filter(Boolean);
  let base: string | null;
  if (head === "crate") base = rustCrateRoot(from);
  else if (head === "self") base = rustModuleDir(from);
  else if (head === "super") base = dirnameOf(rustModuleDir(from));
  else return null;
  for (let n = segments.length; n > 0; n--) {
    const target = joinPath(base, segments.slice(0, n).join("/"));
    if (target === null) return null;
    const found = firstExisting([`${target}.rs`, `${target}/mod.rs`], files);
    if (found) return found;
  }
  const own = base ? `${base}/` : "";
  return firstExisting([`${base}.rs`, `${own}mod.rs`, `${own}lib.rs`, `${own}main.rs`], files);
}

const goPackages = new WeakMap<ReadonlySet<string>, Map<string, string>>();

function goPackageFiles(files: ReadonlySet<string>): Map<string, string> {
  let index = goPackages.get(files);
  if (index) return index;
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    if (!file.endsWith(".go")) continue;
    const dir = dirnameOf(file);
    byDir.set(dir, [...byDir.get(dir) ?? [], file]);
  }
  index = new Map([...byDir].map(([dir, list]) => {
    const sorted = list.sort();
    return [dir, sorted.find((f) => !f.endsWith("_test.go")) ?? sorted[0]];
  }));
  goPackages.set(files, index);
  return index;
}

function resolveGo(spec: string, files: ReadonlySet<string>, aliases: Record<string, string>): string | null {
  const target = applyAlias(spec, aliases);
  if (target === null) return null;
  const dir = normalizeWithinRoot(target);
  if (dir === null) return null;
  return goPackageFiles(files).get(dir) ?? null;
}

export function resolveImport(from: string, spec: string, files: ReadonlySet<string>, aliases: Record<string, string>): string | null {
  switch (extensionOf(from)) {
    case ".py": return resolvePython(from, spec, files);
    case ".rs": return resolveRust(from, spec, files);
    case ".go": return resolveGo(spec, files, aliases);
    default: return resolveScript(from, spec, files, aliases);
  }
}

function parseJsonWithCommentsAndTrailingCommas(text: string): unknown {
  const { code, strings } = blankCommentsKeepingOffsets(text.replace(/^\uFEFF/, ""), C_LIKE);
  let out = "";
  let last = 0;
  for (const [from, to] of strings) {
    out += code.slice(last, from).replace(/,(\s*[}\]])/g, "$1") + code.slice(from, to + 1);
    last = to + 1;
  }
  out += code.slice(last).replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(out); } catch { return null; }
}

export function aliasesFromTsconfig(text: string): Record<string, string> {
  const options = (parseJsonWithCommentsAndTrailingCommas(text) as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | null)?.compilerOptions;
  const paths = options?.paths;
  if (!paths || typeof paths !== "object") return {};
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : ".";
  const out: Record<string, string> = {};
  for (const [key, targets] of Object.entries(paths as Record<string, unknown>)) {
    const first = Array.isArray(targets) ? targets.find((t): t is string => typeof t === "string") : undefined;
    if (!first) continue;
    const wildcard = key.endsWith("/*") && first.endsWith("/*");
    const target = normalizeWithinRoot(`${baseUrl}/${wildcard ? first.slice(0, -2) : first}`);
    if (target === null) continue;
    if (wildcard) out[key.slice(0, -1)] = target ? `${target}/` : "";
    else if (!key.includes("*")) out[key] = target;
  }
  return out;
}

export function aliasesFromGoMod(text: string): Record<string, string> {
  const name = /^\s*module\s+"?([^\s"]+)"?/m.exec(text)?.[1];
  return name ? { [`${name}/`]: "" } : {};
}

export type FileImports = { path: string; imports: ImportRef[] };

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:(?!:)/i;

function isProjectOrUrlSpec(from: string, spec: string, aliases: Record<string, string>): boolean {
  if (/^\.{1,2}(\/|$)|^\//.test(spec)) return true;
  switch (extensionOf(from)) {
    case ".py": return spec.startsWith(".");
    case ".rs": return /^(crate|self|super)(::|$)/.test(spec);
    case ".go": return applyAlias(spec, aliases) !== null;
    default: return (URL_SCHEME.test(spec) && !spec.startsWith("node:")) || CONVENTIONAL_ROOT_ALIAS.test(spec) || applyAlias(spec, aliases) !== null;
  }
}

function packageName(from: string, spec: string): string {
  switch (extensionOf(from)) {
    case ".py": return spec.split(".")[0];
    case ".rs": return spec.split("::")[0];
    case ".go": {
      const parts = spec.split("/");
      return parts[0].includes(".") ? parts.slice(0, 3).join("/") : parts[0];
    }
    default: {
      const parts = spec.split("/");
      return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    }
  }
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildArchitecture(
  allPaths: string[],
  read: FileImports[],
  aliases: Record<string, string>,
  overrides?: ArchOverrides,
  limit = MAX_CODE_FILES,
): Architecture {
  const paths = [...new Set(allPaths)];
  const modules = modulesOf(paths, overrides);
  const moduleOf = new Map<string, ModuleInfo>();
  for (const m of modules) for (const file of m.files) moduleOf.set(file, m);
  const files = new Set(paths);
  const codeFiles = paths.filter((p) => CODE_EXTENSIONS.includes(extensionOf(p))).length;

  const uses = new Map<string, Set<string>>();
  const usedBy = new Map<string, Set<string>>();
  const weights = new Map<string, number>();
  const external = new Map<string, number>();
  const addEdge = (level: "family" | "module", from: string, to: string) => {
    const key = `${level}\n${from}\n${to}`;
    weights.set(key, (weights.get(key) ?? 0) + 1);
  };

  for (const { path, imports } of read.slice(0, limit)) {
    const source = moduleOf.get(path);
    if (!source) continue;
    const counted = new Set<string>();
    for (const { spec, line } of imports) {
      const target = resolveImport(path, spec, files, aliases);
      if (target === null) {
        if (!isProjectOrUrlSpec(path, spec, aliases)) {
          const name = packageName(path, spec);
          external.set(name, (external.get(name) ?? 0) + 1);
        }
        continue;
      }
      if (target === path || counted.has(`${line}\n${target}`)) continue;
      counted.add(`${line}\n${target}`);
      const dest = moduleOf.get(target)!;
      uses.set(path, (uses.get(path) ?? new Set()).add(target));
      usedBy.set(target, (usedBy.get(target) ?? new Set()).add(path));
      if (dest.id !== source.id) addEdge("module", source.id, dest.id);
      if (dest.family !== source.family) addEdge("family", source.family, dest.family);
    }
  }

  const sorted = (set: Set<string> | undefined) => [...set ?? []].sort(byText);
  return {
    families: FAMILY_ORDER.flatMap((family) => {
      const own = modules.filter((m) => m.family === family);
      if (!own.length) return [];
      return [{ id: family, name: overrideOf(overrides?.familyNames, family) ?? family, files: own.reduce((n, m) => n + m.files.length, 0), modules: own.map((m) => m.id) }];
    }),
    modules: modules.map((m) => ({ id: m.id, family: m.family, files: m.files.length })),
    files: [...paths].sort(byText).map((path) => ({ path, module: moduleOf.get(path)!.id, uses: sorted(uses.get(path)), usedBy: sorted(usedBy.get(path)) })),
    edges: [...weights].map(([key, weight]) => {
      const [level, from, to] = key.split("\n") as ["family" | "module", string, string];
      return { level, from, to, weight };
    }).sort((a, b) => byText(a.level, b.level) || byText(a.from, b.from) || byText(a.to, b.to)),
    external: [...external].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || byText(a.name, b.name)),
    truncated: codeFiles > limit || read.length > limit,
  };
}
