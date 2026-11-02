import type { Architecture, FileImports } from "./projects-architecture.ts";
import { PIECE_KINDS } from "../shared/projects-pieces.ts";
import type { Piece, PieceKind } from "../shared/projects-pieces.ts";

export type { Piece, PieceKind };

type Ecosystem = "npm" | "py" | "go" | "cargo" | "gem";

/** Package names as each ecosystem normalizes them; a name ending in "/" matches every package under that scope. */
interface PackageCue {
  kind: PieceKind;
  tech: string;
  deps: Partial<Record<Ecosystem, readonly string[]>>;
  /** Python packages imported under another name than the one they are installed by. */
  pyImports?: readonly string[];
}

const PACKAGE_CUES: readonly PackageCue[] = [
  { kind: "ui", tech: "React", deps: { npm: ["react"] } },
  { kind: "ui", tech: "Vue", deps: { npm: ["vue"] } },
  { kind: "ui", tech: "Svelte", deps: { npm: ["svelte"] } },
  { kind: "ui", tech: "Next.js", deps: { npm: ["next"] } },
  { kind: "ui", tech: "Nuxt", deps: { npm: ["nuxt"] } },
  { kind: "ui", tech: "Vite", deps: { npm: ["vite"] } },
  { kind: "ui", tech: "Angular", deps: { npm: ["angular", "@angular/"] } },
  { kind: "api", tech: "Express", deps: { npm: ["express"] } },
  { kind: "api", tech: "Fastify", deps: { npm: ["fastify"] } },
  { kind: "api", tech: "Koa", deps: { npm: ["koa"] } },
  { kind: "api", tech: "Hono", deps: { npm: ["hono"] } },
  { kind: "api", tech: "NestJS", deps: { npm: ["nestjs", "@nestjs/"] } },
  { kind: "api", tech: "FastAPI", deps: { py: ["fastapi"] } },
  { kind: "api", tech: "Flask", deps: { py: ["flask"] } },
  { kind: "api", tech: "Django", deps: { py: ["django"] } },
  { kind: "api", tech: "Gin", deps: { go: ["github.com/gin-gonic/gin"] } },
  { kind: "api", tech: "Echo", deps: { go: ["github.com/labstack/echo"] } },
  { kind: "api", tech: "Actix", deps: { cargo: ["actix-web", "actix"] } },
  { kind: "api", tech: "Axum", deps: { cargo: ["axum"] } },
  { kind: "api", tech: "Rails", deps: { gem: ["rails"] } },
  { kind: "database", tech: "PostgreSQL", deps: { npm: ["pg", "postgres"], py: ["psycopg", "psycopg-binary", "psycopg2", "psycopg2-binary"] }, pyImports: ["psycopg", "psycopg2"] },
  { kind: "database", tech: "MySQL", deps: { npm: ["mysql2"] } },
  { kind: "database", tech: "MongoDB", deps: { npm: ["mongodb", "mongoose"] } },
  { kind: "database", tech: "SQLite", deps: { npm: ["sqlite3", "better-sqlite3"] } },
  { kind: "database", tech: "Prisma", deps: { npm: ["prisma", "@prisma/client"] } },
  { kind: "database", tech: "TypeORM", deps: { npm: ["typeorm"] } },
  { kind: "database", tech: "Sequelize", deps: { npm: ["sequelize"] } },
  { kind: "database", tech: "Drizzle", deps: { npm: ["drizzle-orm"] } },
  { kind: "database", tech: "SQLAlchemy", deps: { py: ["sqlalchemy"] } },
  { kind: "database", tech: "GORM", deps: { go: ["gorm.io/gorm"] } },
  { kind: "database", tech: "Diesel", deps: { cargo: ["diesel"] } },
  { kind: "database", tech: "SQLx", deps: { cargo: ["sqlx"] } },
  { kind: "cache", tech: "Redis", deps: { npm: ["redis", "ioredis"], py: ["redis"] } },
  { kind: "cache", tech: "Memcached", deps: { npm: ["memcached"] } },
  { kind: "jobs", tech: "BullMQ", deps: { npm: ["bullmq"] } },
  { kind: "jobs", tech: "Bull", deps: { npm: ["bull"] } },
  { kind: "jobs", tech: "Celery", deps: { py: ["celery"] } },
  { kind: "jobs", tech: "RQ", deps: { py: ["rq"] } },
  { kind: "jobs", tech: "Agenda", deps: { npm: ["agenda"] } },
  { kind: "jobs", tech: "node-cron", deps: { npm: ["node-cron"] } },
  { kind: "jobs", tech: "Croner", deps: { npm: ["croner"] } },
  { kind: "external", tech: "Stripe", deps: { npm: ["stripe"], py: ["stripe"] } },
  { kind: "external", tech: "Nodemailer", deps: { npm: ["nodemailer"] } },
  { kind: "external", tech: "SendGrid", deps: { npm: ["@sendgrid/"], py: ["sendgrid"] } },
  { kind: "external", tech: "Twilio", deps: { npm: ["twilio"], py: ["twilio"] } },
  { kind: "external", tech: "OpenAI", deps: { npm: ["openai"], py: ["openai"] } },
  { kind: "external", tech: "Anthropic", deps: { npm: ["@anthropic-ai/"], py: ["anthropic"] } },
  { kind: "external", tech: "AWS", deps: { npm: ["aws-sdk", "@aws-sdk/"] } },
  { kind: "external", tech: "Firebase", deps: { npm: ["firebase"] } },
  { kind: "chatbot", tech: "Telegraf", deps: { npm: ["telegraf"] } },
  { kind: "chatbot", tech: "node-telegram-bot-api", deps: { npm: ["node-telegram-bot-api"] } },
  { kind: "chatbot", tech: "python-telegram-bot", deps: { py: ["python-telegram-bot"] }, pyImports: ["telegram"] },
  { kind: "chatbot", tech: "aiogram", deps: { py: ["aiogram"] } },
  { kind: "chatbot", tech: "discord.js", deps: { npm: ["discord.js"] } },
  { kind: "chatbot", tech: "discord.py", deps: { py: ["discord-py"] }, pyImports: ["discord"] },
];

const COMPOSE_IMAGES: Readonly<Record<string, { kind: PieceKind; tech: string }>> = {
  postgres: { kind: "database", tech: "PostgreSQL" },
  mysql: { kind: "database", tech: "MySQL" },
  mariadb: { kind: "database", tech: "MariaDB" },
  mongo: { kind: "database", tech: "MongoDB" },
  redis: { kind: "cache", tech: "Redis" },
};

interface FileCue { kind: PieceKind; tech: string; reason: string; test: (path: string, name: string) => boolean }

const COMPOSE_FILE = /^(docker-)?compose[\w.-]{0,64}\.ya?ml$/i;

const FILE_CUES: readonly FileCue[] = [
  { kind: "ui", tech: "Vue", reason: "Vue component", test: (_, name) => /\.vue$/i.test(name) },
  { kind: "ui", tech: "Svelte", reason: "Svelte component", test: (_, name) => /\.svelte$/i.test(name) },
  { kind: "ui", tech: "", reason: "screen component", test: (_, name) => /\.tsx$/i.test(name) },
  { kind: "ui", tech: "", reason: "web page", test: (_, name) => /\.html$/i.test(name) },
  { kind: "database", tech: "Prisma", reason: "Prisma schema", test: (_, name) => name.toLowerCase() === "schema.prisma" },
  { kind: "database", tech: "", reason: "database migration", test: (path) => path.toLowerCase().split("/").slice(0, -1).includes("migrations") },
  { kind: "database", tech: "", reason: "SQL file", test: (_, name) => /\.sql$/i.test(name) },
  { kind: "deploy", tech: "Docker", reason: "Docker build file", test: (_, name) => /^dockerfile|\.dockerfile$/i.test(name) },
  { kind: "deploy", tech: "Docker", reason: "Docker Compose file", test: (_, name) => COMPOSE_FILE.test(name) },
  { kind: "deploy", tech: "GitHub Actions", reason: "GitHub workflow", test: (path) => /(^|\/)\.github\/workflows\/[^/]+$/.test(path) },
  { kind: "deploy", tech: "Vercel", reason: "Vercel settings", test: (_, name) => name.toLowerCase() === "vercel.json" },
  { kind: "deploy", tech: "Netlify", reason: "Netlify settings", test: (_, name) => name.toLowerCase() === "netlify.toml" },
  { kind: "deploy", tech: "Fly.io", reason: "Fly.io settings", test: (_, name) => name.toLowerCase() === "fly.toml" },
  { kind: "deploy", tech: "Procfile", reason: "list of processes to start online", test: (_, name) => name === "Procfile" },
];

const MAX_EVIDENCE = 5;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirName = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function manifestEcosystem(path: string): Ecosystem | "compose" | null {
  const name = baseName(path);
  if (name === "package.json") return "npm";
  if (/^requirements([-_.][\w.-]{0,64})?\.txt$/i.test(name) || name === "pyproject.toml") return "py";
  if (name === "go.mod") return "go";
  if (name === "Cargo.toml") return "cargo";
  if (name === "Gemfile") return "gem";
  if (COMPOSE_FILE.test(name)) return "compose";
  return null;
}

/** The files `detectPieces` wants in `manifests`. */
export function isManifestPath(path: string): boolean {
  return manifestEcosystem(path) !== null;
}

function normalize(eco: Ecosystem, name: string): string {
  const lower = name.trim().toLowerCase();
  if (eco === "py") return lower.replace(/[-_.]+/g, "-");
  if (eco === "cargo") return lower.replace(/_/g, "-");
  return lower;
}

function cueMatches(eco: Ecosystem, wanted: readonly string[] | undefined, key: string): boolean {
  if (!wanted) return false;
  return wanted.some((name) => name.endsWith("/") ? key.startsWith(name) : key === name || (eco === "go" && key.startsWith(`${name}/`)));
}

interface CueIndex { exact: Map<string, PackageCue[]>; prefixed: { prefix: string; cue: PackageCue }[] }

const CUE_INDEX = new Map<Ecosystem, CueIndex>();
for (const cue of PACKAGE_CUES) {
  for (const [eco, names] of Object.entries(cue.deps) as [Ecosystem, readonly string[]][]) {
    let index = CUE_INDEX.get(eco);
    if (!index) CUE_INDEX.set(eco, index = { exact: new Map(), prefixed: [] });
    for (const name of names) {
      if (name.endsWith("/") || eco === "go") index.prefixed.push({ prefix: name.endsWith("/") ? name : `${name}/`, cue });
      if (!name.endsWith("/")) index.exact.set(name, [...index.exact.get(name) ?? [], cue]);
    }
  }
}

function cuesFor(eco: Ecosystem, key: string): PackageCue[] {
  const index = CUE_INDEX.get(eco);
  if (!index) return [];
  const found = [...index.exact.get(key) ?? []];
  for (const { prefix, cue } of index.prefixed) if (key.startsWith(prefix) && !found.includes(cue)) found.push(cue);
  return found;
}

function tomlSections(text: string): { section: string; lines: string[] }[] {
  const out: { section: string; lines: string[] }[] = [{ section: "", lines: [] }];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]{1,200})\]$/.exec(line);
    if (header) out.push({ section: header[1].trim().replace(/^\[|\]$/g, ""), lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

const TOML_KEY = /^["']?([A-Za-z0-9][\w.-]{0,200})["']?\s*=/;
const QUOTED = /["']([^"'\n]{1,300})["']/g;
const REQUIREMENT_NAME = /^([A-Za-z0-9][A-Za-z0-9._-]{0,200})/;

function pyprojectDeps(text: string): string[] {
  const names: string[] = [];
  for (const { section, lines } of tomlSections(text)) {
    if (/^tool\.poetry\.(dev-)?dependencies$|^tool\.poetry\.group\.[\w.-]{1,100}\.dependencies$/.test(section)) {
      for (const line of lines) {
        const key = TOML_KEY.exec(line)?.[1];
        if (key && key.toLowerCase() !== "python") names.push(key);
      }
      continue;
    }
    if (section !== "project") continue;
    let inList = false;
    for (const line of lines) {
      if (!inList && /^dependencies\s*=\s*\[/.test(line)) inList = true;
      if (!inList) continue;
      for (const m of line.matchAll(QUOTED)) {
        const name = REQUIREMENT_NAME.exec(m[1].trim())?.[1];
        if (name) names.push(name);
      }
      if (line.includes("]")) inList = false;
    }
  }
  return names;
}

function requirementsDeps(text: string): string[] {
  return text.split(/\r?\n/).flatMap((raw) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line || line.startsWith("-")) return [];
    const name = REQUIREMENT_NAME.exec(line)?.[1];
    return name ? [name] : [];
  });
}

function goModDeps(text: string): string[] {
  const names: string[] = [];
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*/, "").trim();
    if (inBlock) {
      if (line.startsWith(")")) { inBlock = false; continue; }
      const path = line.split(/\s+/)[0];
      if (path) names.push(path);
      continue;
    }
    if (/^require\s*\($/.test(line)) { inBlock = true; continue; }
    const single = /^require\s+(\S+)/.exec(line);
    if (single) names.push(single[1]);
  }
  return names;
}

function cargoDeps(text: string): string[] {
  const names: string[] = [];
  for (const { section, lines } of tomlSections(text)) {
    const table = /^(?:workspace\.|target\.[^\]]{1,200}\.)?(?:dev-|build-)?dependencies(?:\.(.+))?$/.exec(section);
    if (!table) continue;
    if (table[1]) { names.push(table[1].replace(/^["']|["']$/g, "")); continue; }
    for (const line of lines) {
      const key = TOML_KEY.exec(line)?.[1];
      if (key) names.push(key);
    }
  }
  return names;
}

function packageJsonDeps(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return [];
    const record = parsed as Record<string, unknown>;
    return ["dependencies", "devDependencies"].flatMap((field) => {
      const deps = record[field];
      return deps && typeof deps === "object" && !Array.isArray(deps) ? Object.keys(deps) : [];
    });
  } catch {
    return [];
  }
}

function gemfileDeps(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const name = /^\s*gem\s+["']([\w.-]{1,200})["']/.exec(line)?.[1];
    return name ? [name] : [];
  });
}

function manifestDeps(eco: Ecosystem, path: string, text: string): string[] {
  switch (eco) {
    case "npm": return packageJsonDeps(text);
    case "py": return baseName(path) === "pyproject.toml" ? pyprojectDeps(text) : requirementsDeps(text);
    case "go": return goModDeps(text);
    case "cargo": return cargoDeps(text);
    case "gem": return gemfileDeps(text);
  }
}

function composeImages(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const value = /^\s*image:\s*["']?([^\s"'#]{1,300})/.exec(line)?.[1];
    if (!value) return [];
    const name = value.split(/[@:]/)[0];
    return [baseName(name).toLowerCase()];
  });
}

function importEcosystem(path: string): Ecosystem | null {
  const ext = baseName(path).slice(baseName(path).lastIndexOf(".")).toLowerCase();
  if (ext === ".py") return "py";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "cargo";
  if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"].includes(ext)) return "npm";
  return null;
}

function importKey(eco: Ecosystem, spec: string): string {
  switch (eco) {
    case "py": return normalize("py", spec.split(".")[0]);
    case "cargo": return normalize("cargo", spec.split("::")[0]);
    case "go": return spec.toLowerCase();
    default: {
      const parts = spec.toLowerCase().split("/");
      return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    }
  }
}

function importsCue(cue: PackageCue, eco: Ecosystem, key: string): boolean {
  if (eco === "py" && cue.pyImports) return cue.pyImports.includes(key);
  return cueMatches(eco, cue.deps[eco], key);
}

interface Draft { kind: PieceKind; tech: string; evidence: Map<string, string>; modules: Set<string> }

/** One piece per (kind, tech) from the closed cue lists; a piece with no tech is dropped when a named one of its kind is found. */
export function detectPieces(input: { paths: string[]; manifests: Record<string, string>; read: FileImports[]; arch: Architecture }): Piece[] {
  const drafts = new Map<string, Draft>();
  const draft = (kind: PieceKind, tech: string) => {
    const key = `${kind}\n${tech}`;
    let found = drafts.get(key);
    if (!found) drafts.set(key, found = { kind, tech, evidence: new Map(), modules: new Set() });
    return found;
  };
  const moduleOf = new Map(input.arch.files.map((f) => [f.path, f.module]));
  const addEvidence = (d: Draft, path: string, reason: string, withModule: boolean) => {
    if (!d.evidence.has(path)) d.evidence.set(path, reason);
    const module = withModule ? moduleOf.get(path) : undefined;
    if (module) d.modules.add(module);
  };

  const imported = input.read.flatMap(({ path, imports }) => {
    const eco = importEcosystem(path);
    return eco ? [{ path, eco, keys: new Set(imports.map((i) => importKey(eco, i.spec))) }] : [];
  });

  for (const path of Object.keys(input.manifests).sort(byText)) {
    const eco = manifestEcosystem(path);
    const text = input.manifests[path];
    if (!eco || typeof text !== "string") continue;
    if (eco === "compose") {
      for (const image of composeImages(text)) {
        const cue = Object.hasOwn(COMPOSE_IMAGES, image) ? COMPOSE_IMAGES[image] : undefined;
        if (cue) addEvidence(draft(cue.kind, cue.tech), path, `runs the ${image} image`, true);
      }
      continue;
    }
    const dir = dirName(path);
    const scoped = imported.filter((f) => !dir || f.path.startsWith(`${dir}/`));
    for (const name of manifestDeps(eco, path, text)) {
      const key = normalize(eco, name);
      for (const cue of cuesFor(eco, key)) {
        const d = draft(cue.kind, cue.tech);
        addEvidence(d, path, `depends on ${name}`, false);
        for (const file of scoped) {
          if (![...file.keys].some((k) => importsCue(cue, file.eco, k))) continue;
          const module = moduleOf.get(file.path);
          if (module) d.modules.add(module);
        }
      }
    }
  }

  for (const path of [...input.paths].sort(byText)) {
    const name = baseName(path);
    for (const cue of FILE_CUES) if (cue.test(path, name)) addEvidence(draft(cue.kind, cue.tech), path, cue.reason, true);
  }

  const testModules = input.arch.modules.filter((m) => m.family === "tests").map((m) => m.id);
  if (testModules.length) {
    const tests = draft("tests", "");
    for (const f of input.arch.files) if (testModules.includes(f.module)) addEvidence(tests, f.path, "test file", true);
  }

  const named = new Set([...drafts.values()].filter((d) => d.tech).map((d) => d.kind));
  const moduleOrder = input.arch.modules.map((m) => m.id);
  return [...drafts.values()]
    .filter((d) => d.tech || d.kind === "tests" || !named.has(d.kind))
    .sort((a, b) => PIECE_KINDS.indexOf(a.kind) - PIECE_KINDS.indexOf(b.kind) || byText(a.tech.toLowerCase(), b.tech.toLowerCase()) || byText(a.tech, b.tech))
    .map((d) => ({
      kind: d.kind,
      tech: d.tech,
      evidence: [...d.evidence].sort(([a], [b]) => byText(a, b)).slice(0, MAX_EVIDENCE).map(([path, reason]) => ({ path, reason })),
      modules: moduleOrder.filter((id) => d.modules.has(id)),
    }));
}
