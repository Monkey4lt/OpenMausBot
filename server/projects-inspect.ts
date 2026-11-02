import { classify } from "./projects-architecture.ts";
import type { Architecture, FileImports } from "./projects-architecture.ts";
import { PIECE_KINDS, PIECE_LABELS } from "../shared/projects-pieces.ts";
import type { Piece, PieceKind, PieceLink } from "../shared/projects-pieces.ts";

export type { Piece, PieceKind, PieceLink };

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

const STRING_ARG = String.raw`\(\s*f?(?:"([^"\n]{0,2048})"|'([^'\n]{0,2048})'|` + "`([^`\\n]{0,2048})`)";
const CALL_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\bfetch` + STRING_ARG, "g"),
  new RegExp(String.raw`\baxios(?:\.(?:get|post|put|patch|delete|head|options|request))?` + STRING_ARG, "g"),
  new RegExp(String.raw`\b(?:httpx|requests)\.(?:get|post|put|patch|delete|head|options|request)` + STRING_ARG, "g"),
];
const ROUTE_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:app|fastify|server|\w{0,40}[Rr]outer)\.(?:get|post|put|patch|delete|all)` + STRING_ARG, "g"),
  new RegExp(String.raw`\.route\(\s*\{[^}]{0,500}?\burl\s*:\s*(?:"([^"\n]{0,2048})"|'([^'\n]{0,2048})'|` + "`([^`\\n]{0,2048})`)", "g"),
  new RegExp(String.raw`@\w{1,40}\.(?:get|post|put|patch|delete|route|api_route)` + STRING_ARG, "g"),
  new RegExp(String.raw`\b\w{1,40}\.(?:GET|POST|PUT|PATCH|DELETE|Any)` + STRING_ARG, "g"),
  new RegExp(String.raw`\.route` + STRING_ARG, "g"),
];

const URL_ORIGIN = /^[a-z][a-z0-9+.-]{0,30}:\/\/[^/\s]{0,300}/i;
const LEADING_PLACEHOLDER = /^(?:\$\{[^}]{0,200}\}|\{[^}]{0,200}\})+/;

/** The path part of a URL or route as written in code, or null when it is not an absolute path. */
function urlPath(raw: string): string | null {
  const path = raw.trim().replace(URL_ORIGIN, "").replace(LEADING_PLACEHOLDER, "").split(/[?#]/)[0];
  if (!path.startsWith("/")) return null;
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

function findPaths(patterns: readonly RegExp[], text: string): string[] {
  const found: { at: number; path: string }[] = [];
  const taken = new Set<number>();
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const raw = m[1] ?? m[2] ?? m[3];
      const at = m.index + m[0].length - raw.length;
      const path = urlPath(raw);
      if (path !== null && !taken.has(at)) { taken.add(at); found.push({ at, path }); }
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.path);
}

/** URL paths the file calls with fetch, axios, httpx or requests, in the order they appear. */
export function findCalls(_path: string, text: string): string[] {
  return findPaths(CALL_PATTERNS, text);
}

/** Route paths the file defines (Express, Koa, Hono, Fastify, FastAPI, Flask, Gin, Echo, Axum, Actix), in the order they appear. */
export function findRoutes(_path: string, text: string): string[] {
  return findPaths(ROUTE_PATTERNS, text);
}

const PARAM_SEGMENT = /^(?::\w{1,100}\??|\*|\{[^}]{0,200}\}|<[^>]{0,200}>|\$\{[^}]{0,200}\})$/;

/** True when a called URL lands on a route: same segments, a parameter on either side matching any one segment; scheme and host are ignored. */
export function routeMatches(call: string, route: string): boolean {
  const a = urlPath(call);
  const b = urlPath(route);
  if (a === null || b === null) return false;
  const left = a.split("/");
  const right = b.split("/");
  return left.length === right.length && left.every((seg, i) => seg === right[i] || PARAM_SEGMENT.test(seg) || PARAM_SEGMENT.test(right[i]));
}

const MAX_LINK_EXAMPLES = 5;
const IMPORT_TARGETS: readonly PieceKind[] = ["database", "cache", "external"];

/** Site → server links from calls matching routes, and server → database, cache or outside service links from imports of their clients. */
export function linkPieces(pieces: Piece[], texts: { path: string; text: string }[], read: FileImports[]): PieceLink[] {
  const links: PieceLink[] = [];
  const has = (kind: PieceKind) => pieces.some((p) => p.kind === kind);
  const finish = (from: PieceKind, to: PieceKind, count: number, pairs: Set<string>) => {
    if (!count) return;
    const examples = [...pairs].sort(byText).slice(0, MAX_LINK_EXAMPLES).map((pair) => {
      const [a, b] = pair.split("\n");
      return { from: a, to: b };
    });
    links.push({ from, to, count, examples });
  };
  const uiModules = pieces.filter((p) => p.kind === "ui").flatMap((p) => p.modules);
  const onUiSide = (path: string) => classify(path) === "ui" || uiModules.some((m) => path.startsWith(`${m}/`));

  if (has("ui") && has("api")) {
    const sorted = [...texts].sort((a, b) => byText(a.path, b.path));
    const routes = sorted.flatMap(({ path, text }) => findRoutes(path, text).map((route) => ({ path, route })));
    let count = 0;
    const pairs = new Set<string>();
    for (const { path, text } of sorted) {
      if (!onUiSide(path)) continue;
      for (const call of findCalls(path, text)) {
        const hit = routes.find((r) => r.path !== path && routeMatches(call, r.route));
        if (!hit) continue;
        count++;
        pairs.add(`${path}\n${hit.path}`);
      }
    }
    finish("ui", "api", count, pairs);
  }

  if (has("api")) {
    for (const kind of IMPORT_TARGETS) {
      const cues = pieces.filter((p) => p.kind === kind).flatMap((p) => PACKAGE_CUES.filter((c) => c.kind === p.kind && c.tech === p.tech));
      if (!cues.length) continue;
      const files = new Set<string>();
      const pairs = new Set<string>();
      for (const { path, imports } of read) {
        const eco = importEcosystem(path);
        if (!eco || onUiSide(path)) continue;
        for (const { spec } of imports) {
          const key = importKey(eco, spec);
          if (!cues.some((cue) => importsCue(cue, eco, key))) continue;
          files.add(path);
          pairs.add(`${path}\n${key}`);
        }
      }
      finish("api", kind, files.size, pairs);
    }
  }
  return links;
}

const DIAGRAM_COLUMNS: readonly (readonly PieceKind[])[] = [["ui", "chatbot"], ["api", "jobs"], ["database", "cache", "external"], ["tests", "deploy"]];
const DIAGRAM_COLORS: Record<PieceKind, string> = {
  ui: "#5b8def", api: "#38b27a", database: "#d9822b", cache: "#c95fd1", jobs: "#c9a227",
  external: "#e0566b", chatbot: "#2bb3c0", tests: "#8a93a6", deploy: "#6f7ad9",
};
const MAX_DIAGRAM_BOXES = 12;
const MAX_DIAGRAM_TECH = 40;
const BOX_W = 200;
const BOX_H = 56;
const GAP_X = 70;
const GAP_Y = 22;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
const cut = (text: string, max: number) => ([...text].length > max ? `${[...text].slice(0, max - 1).join("")}…` : text);

/** A self-contained page (inline SVG, no script, no outside link) of a project's pieces and the links between them, in plain French. */
export function pieceDiagramHtml(inspect: { pieces: Piece[]; links: PieceLink[] }, title: string): string {
  const heading = escapeHtml(cut(title.replace(/[\u0000-\u001f\u007f]+/g, " ").trim(), 80));
  const boxes = new Map<PieceKind, { x: number; y: number; w: number; h: number }>();
  const shapes: string[] = [];
  let height = 0;
  DIAGRAM_COLUMNS.forEach((kinds, column) => {
    let y = 0;
    for (const kind of kinds) {
      const own = inspect.pieces.filter((p) => p.kind === kind).slice(0, MAX_DIAGRAM_BOXES);
      if (!own.length) continue;
      const techs = own.map((p) => p.tech).filter(Boolean);
      const x = column * (BOX_W + GAP_X);
      const lines = Math.max(1, Math.min(techs.length, 4));
      const h = BOX_H + (lines - 1) * 16;
      boxes.set(kind, { x, y, w: BOX_W, h });
      const color = DIAGRAM_COLORS[kind];
      const shown = techs.slice(0, 4).map((t, i) => `<text x="${x + 14}" y="${y + 42 + i * 16}" class="t">${escapeHtml(cut(t, MAX_DIAGRAM_TECH))}${i === 3 && techs.length > 4 ? ` +${techs.length - 4}` : ""}</text>`).join("");
      shapes.push(`<g data-piece="${kind}"><rect x="${x}" y="${y}" width="${BOX_W}" height="${h}" rx="10" fill="${color}22" stroke="${color}" stroke-width="2"/><text x="${x + 14}" y="${y + 22}" class="k">${escapeHtml(PIECE_LABELS[kind].fr)}</text>${shown}</g>`);
      y += h + GAP_Y;
    }
    height = Math.max(height, y);
  });
  const arrows = inspect.links.flatMap((link) => {
    const a = boxes.get(link.from);
    const b = boxes.get(link.to);
    if (!a || !b) return [];
    const forward = b.x >= a.x;
    const x1 = forward ? a.x + a.w : a.x;
    const x2 = forward ? b.x : b.x + b.w;
    const y1 = a.y + a.h / 2;
    const y2 = b.y + b.h / 2;
    const word = link.from === "ui" && link.to === "api" ? (link.count > 1 ? "appels" : "appel") : (link.count > 1 ? "fichiers" : "fichier");
    return [`<g data-link="${link.from}-${link.to}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="a" marker-end="url(#h)"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" class="c" text-anchor="middle">${link.count} ${word}</text></g>`];
  });
  const width = Math.max(1, ...[...boxes.values()].map((b) => b.x + b.w));
  const body = boxes.size
    ? `<svg viewBox="-4 -4 ${width + 8} ${Math.max(height, BOX_H) + 8}" width="100%" role="img" aria-label="Les pièces de ${heading}"><defs><marker id="h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9aa4b8"/></marker></defs>${arrows.join("")}${shapes.join("")}</svg>`
    : `<p>Aucune pièce reconnue dans ce projet pour l'instant.</p>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${heading}</title><style>body{margin:0;padding:16px;background:#14161c;color:#e8ebf2;font:14px system-ui,sans-serif}h1{font-size:16px;margin:0 0 12px}.k{fill:#f2f4f8;font-weight:600;font-size:14px}.t{fill:#b8c0d0;font-size:11px}.a{stroke:#9aa4b8;stroke-width:2;stroke-dasharray:6 4}.c{fill:#cfd5e2;font-size:11px}</style></head><body><h1>Les grandes pièces de ${heading}</h1>${body}</body></html>`;
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".vue": "Vue", ".svelte": "Svelte", ".py": "Python", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
  ".java": "Java", ".kt": "Kotlin", ".swift": "Swift", ".cs": "C#", ".c": "C", ".h": "C", ".cpp": "C++", ".hpp": "C++",
  ".html": "HTML", ".css": "CSS", ".scss": "CSS", ".sass": "CSS", ".less": "CSS", ".sql": "SQL", ".sh": "Shell", ".ps1": "PowerShell",
};

/** Files per programming language, most used first. */
export function languagesOf(paths: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const name = baseName(path);
    const dot = name.lastIndexOf(".");
    const language = dot > 0 ? LANGUAGE_NAMES[name.slice(dot).toLowerCase()] : undefined;
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || byText(a[0], b[0])));
}
