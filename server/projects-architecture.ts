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

/** A folder becomes a module once it holds MIN_MODULE_FILES files not already taken by a deeper module; fewer bubble up to the parent. */
function carve(node: DirNode, prefix: string[], out: { prefix: string; files: string[] }[]): string[] {
  const loose = [...node.files];
  for (const [name, kid] of node.kids) loose.push(...carve(kid, [...prefix, name], out));
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
    const rest = carve(dirTree(files), [], carved);
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
