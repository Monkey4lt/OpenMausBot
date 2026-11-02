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
