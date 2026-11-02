export type Family = "tests" | "docs" | "i18n" | "data" | "config" | "scripts" | "assets" | "ui" | "server" | "other";

export const FAMILY_ORDER: readonly Family[] = ["tests", "docs", "i18n", "data", "config", "scripts", "assets", "ui", "server", "other"];

interface FamilyRule { dirs: readonly string[]; names: readonly RegExp[]; exts: readonly string[] }

const RULES: Record<Exclude<Family, "other">, FamilyRule> = {
  tests: { dirs: ["test", "tests", "__tests__", "spec"], names: [/\.(test|spec)\./i, /_test\.go$/i, /^test_.*\.py$/i], exts: [] },
  docs: { dirs: ["docs"], names: [/^(readme|changelog|license)/i], exts: [".md", ".mdx", ".rst"] },
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
    if (dirs.some((d) => rule.dirs.includes(d)) || rule.names.some((re) => re.test(name)) || rule.exts.includes(ext)) return family;
  }
  return "other";
}

export type ArchOverrides = { moduleFamily: Record<string, Family>; familyNames: Partial<Record<Family, string>> };
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
  const owner = new Map<string, { family: Family; size: number }>();
  for (const m of found) {
    const best = owner.get(m.prefix);
    if (!best || m.files.length > best.size || (m.files.length === best.size && FAMILY_ORDER.indexOf(m.family) < FAMILY_ORDER.indexOf(best.family))) {
      owner.set(m.prefix, { family: m.family, size: m.files.length });
    }
  }
  const rank = (f: Family) => FAMILY_ORDER.indexOf(f);
  return found
    .map((m) => {
      const id = owner.get(m.prefix)!.family === m.family ? m.prefix : `${m.prefix}#${m.family}`;
      return { id, family: overrides?.moduleFamily[id] ?? m.family, files: [...m.files].sort() };
    })
    .sort((a, b) => rank(a.family) - rank(b.family) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type ImportRef = { spec: string; line: number };

interface Syntax { lineComment: string | null; blockComment: boolean; quotes: string; tripleQuotes: boolean }

const C_LIKE: Syntax = { lineComment: "//", blockComment: true, quotes: "\"'`", tripleQuotes: false };
const SYNTAX: Record<string, Syntax> = {
  js: C_LIKE,
  css: { lineComment: null, blockComment: true, quotes: "\"'", tripleQuotes: false },
  scss: { lineComment: "//", blockComment: true, quotes: "\"'", tripleQuotes: false },
  py: { lineComment: "#", blockComment: false, quotes: "\"'", tripleQuotes: true },
  go: C_LIKE,
  rs: { lineComment: "//", blockComment: true, quotes: "\"", tripleQuotes: false },
};

const LANGUAGE_OF: Record<string, keyof typeof SYNTAX> = {
  ".ts": "js", ".tsx": "js", ".mts": "js", ".cts": "js", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".vue": "js", ".svelte": "js",
  ".css": "css", ".scss": "scss", ".sass": "scss", ".less": "scss",
  ".py": "py", ".go": "go", ".rs": "rs",
};

function blankCommentsKeepingOffsets(text: string, syntax: Syntax): { code: string; strings: [number, number][] } {
  const out = text.split("");
  const strings: [number, number][] = [];
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
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
    i++;
  }
  return { code: out.join(""), strings };
}

type Found = { spec: string; at: number };

const JS_STATIC = /(?<![.\w$])(?:import|export)\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s*)?(["'])([^"'\n]+)\1/g;
const JS_CALL = /(?<![.\w$])(?:import|require)\s*\(\s*(["'`])([^"'`\n]+)\1\s*\)/g;
const CSS_IMPORT = /@(?:import|use|forward)\s+(?:url\(\s*)?(["'])([^"'\n]+)\1/g;
const CSS_URL = /@import\s+url\(\s*([^"'\s)]+)\s*\)/g;
const PY_IMPORT = /^[ \t]*import[ \t]+([^\n]+)/gm;
const PY_FROM = /^[ \t]*from[ \t]+(\.+[\w.]*|[\w.]+)[ \t]+import\b/gm;
const GO_SINGLE = /\bimport[ \t]+(?:[\w.]+[ \t]+)?"([^"\n]+)"/g;
const GO_BLOCK = /\bimport\s*\(([^)]*)\)/g;
const GO_SPEC = /(?:[\w.]+[ \t]+)?"([^"\n]+)"/g;
const RS_MOD = /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm;
const RS_USE = /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+((?:::)?[\w:]+)/gm;

function findAll(re: RegExp, code: string, group: number): Found[] {
  return [...code.matchAll(re)].map((m) => ({ spec: m[group], at: m.index }));
}

function findImports(language: keyof typeof SYNTAX, code: string): Found[] {
  switch (language) {
    case "js": return [...findAll(JS_STATIC, code, 2), ...findAll(JS_CALL, code, 2)];
    case "css": case "scss": return [...findAll(CSS_IMPORT, code, 2), ...findAll(CSS_URL, code, 1)];
    case "py": return [
      ...[...code.matchAll(PY_IMPORT)].flatMap((m) => m[1].split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter((name) => /^[\w.]+$/.test(name))
        .map((spec) => ({ spec, at: m.index }))),
      ...findAll(PY_FROM, code, 1),
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
      ...findAll(RS_USE, code, 1).map((f) => ({ ...f, spec: f.spec.replace(/::$/, "") })),
    ];
  }
}

export function parseImports(path: string, text: string): ImportRef[] {
  const language = LANGUAGE_OF[extensionOf(path)];
  if (!language) return [];
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const { code, strings } = blankCommentsKeepingOffsets(normalized, SYNTAX[language]);
  const lineStarts = [0];
  for (let i = 0; i < normalized.length; i++) if (normalized[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (at: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= at) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const insideString = (at: number) => strings.some(([from, to]) => at > from && at <= to);
  return findImports(language, code)
    .filter((found) => !insideString(found.at))
    .sort((a, b) => a.at - b.at)
    .map((found) => ({ spec: found.spec, line: lineOf(found.at) }));
}
