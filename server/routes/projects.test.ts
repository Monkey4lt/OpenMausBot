import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { setGithubTransport } from "../projects-github.ts";
import { tar } from "../testing/tar-builder.ts";
import { cartographeBotId, CARTOGRAPHE_NAME, ensureCartographeBot } from "../cartographe-bot.ts";
import { DATA_DIR } from "../config.ts";
import { Store } from "../store.ts";
import { createProjectRoutes } from "./projects.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "projmap-routes-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); setGithubTransport(null); });

function ctx(method: string, path: string, body?: unknown): RouteContext & { sent: () => { status: number; body: unknown } } {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, { method, url: path, headers: {} });
  let status = 0;
  let text = "";
  const res = {
    headersSent: false,
    writableEnded: false,
    req,
    writeHead(code: number) { status = code; res.headersSent = true; return res; },
    end(data?: string) { text = data ?? ""; res.writableEnded = true; return res; },
    getHeader: () => undefined,
    hasHeader: () => false,
  } as unknown as { -readonly [K in keyof ServerResponse]: ServerResponse[K] };
  const url = new URL(path, "http://localhost");
  return {
    req, res, url, path: url.pathname, method,
    auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody,
    sent: () => ({ status, body: text ? JSON.parse(text) : undefined }),
  };
}

async function call(route: RouteHandler, method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const c = ctx(method, path, body);
  const out = await route(c);
  if (out === PASS) throw new Error(`${method} ${path} was not handled`);
  return c.sent();
}

describe("projects routes", () => {
  it("GET /api/projects on an empty data dir returns no sources and no projects", async () => {
    const route = createProjectRoutes({ dataDir: tmp() });
    expect(await call(route, "GET", "/api/projects")).toEqual({ status: 200, body: { state: expect.objectContaining({ sources: [], rev: 0 }), projects: [], errors: [], cartographeBotId: null } });
  });

  it("GET /api/projects returns cartographeBotId from the dependency, or null", async () => {
    let id: string | null = "b-carto";
    const route = createProjectRoutes({ dataDir: tmp(), cartographeBotId: () => id });
    expect((await call(route, "GET", "/api/projects")).body).toMatchObject({ cartographeBotId: "b-carto" });
    id = null;
    expect((await call(route, "GET", "/api/projects")).body).toMatchObject({ cartographeBotId: null });
  });

  it("PUT with the current baseRev saves, answers the new rev and calls onChanged once", async () => {
    const changed: number[] = [];
    const route = createProjectRoutes({ dataDir: tmp(), onChanged: (rev) => changed.push(rev) });
    const groups = [{ id: "g1", name: "Clients", color: "#38d591" }];
    expect(await call(route, "PUT", "/api/projects/state", { groups, baseRev: 0 })).toEqual({ status: 200, body: { ok: true, rev: 1 } });
    expect(changed).toEqual([1]);
    const got = (await call(route, "GET", "/api/projects")).body as { state: { rev: number; groups: unknown[] } };
    expect(got.state).toMatchObject({ rev: 1, groups });
    expect(await call(route, "PUT", "/api/projects/state", { ...got.state, groups: [], baseRev: 1 })).toEqual({ status: 200, body: { ok: true, rev: 2 } });
    expect(changed).toEqual([1, 2]);
  });

  it("PUT with a stale baseRev answers 409 with the current rev and writes nothing", async () => {
    const changed: number[] = [];
    const route = createProjectRoutes({ dataDir: tmp(), onChanged: (rev) => changed.push(rev) });
    const groups = [{ id: "g1", name: "Clients", color: "#38d591" }];
    await call(route, "PUT", "/api/projects/state", { groups, baseRev: 0 });
    const stale = await call(route, "PUT", "/api/projects/state", { groups: [], baseRev: 0, rev: 1 });
    expect(stale).toEqual({ status: 409, body: { error: expect.any(String), rev: 1 } });
    expect(changed).toEqual([1]);
    expect((await call(route, "GET", "/api/projects")).body).toMatchObject({ state: { rev: 1, groups } });
  });

  it("GET /api/projects makes the Cartographe only once the map has a source", async () => {
    const dataDir = tmp();
    const calls: string[] = [];
    let made: string | null = null;
    const route = createProjectRoutes({ dataDir, cartographeBotId: () => made, ensureCartographe: () => { calls.push("ensure"); made = "b-carto"; return made; } });
    expect((await call(route, "GET", "/api/projects")).body).toMatchObject({ cartographeBotId: null });
    expect(calls).toEqual([]);
    mkdirSync(join(dataDir, "proj"));
    await call(route, "PUT", "/api/projects/state", { sources: [{ id: "s1", label: "x", kind: "local", path: join(dataDir, "proj") }], baseRev: 0 });
    expect((await call(route, "GET", "/api/projects")).body).toMatchObject({ cartographeBotId: "b-carto" });
    expect(calls).toEqual(["ensure"]);
  });

  it("with a real store: no source no Cartographe, first source makes it, deleted it is not made again", async () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    const store = new Store(() => ({ instanceId: "", model: "" }));
    const dataDir = tmp();
    mkdirSync(join(dataDir, "proj"));
    const route = createProjectRoutes({
      dataDir,
      cartographeBotId: () => cartographeBotId(DATA_DIR, (id) => Boolean(store.bot(id))),
      ensureCartographe: () => ensureCartographeBot(store, { dataDir: DATA_DIR })?.id ?? null,
    });
    const named = () => store.bots.filter((b) => b.name === CARTOGRAPHE_NAME);
    expect((await call(route, "GET", "/api/projects")).body).toMatchObject({ cartographeBotId: null });
    expect(named()).toHaveLength(0);
    await call(route, "PUT", "/api/projects/state", { sources: [{ id: "s1", label: "x", kind: "local", path: join(dataDir, "proj") }], baseRev: 0 });
    const id = ((await call(route, "GET", "/api/projects")).body as { cartographeBotId: string }).cartographeBotId;
    expect(named().map((b) => b.id)).toEqual([id]);
    expect(((await call(route, "GET", "/api/projects")).body as { cartographeBotId: string }).cartographeBotId).toBe(id);
    expect(named()).toHaveLength(1);
    store.deleteBot(id);
    expect((await call(route, "GET", "/api/projects")).body).toMatchObject({ cartographeBotId: null });
    expect(named()).toHaveLength(0);
  });

  it("GET /api/projects still answers, with no Cartographe, when making it fails", async () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, "proj"));
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { warned.push(args); };
    try {
      const route = createProjectRoutes({ dataDir, cartographeBotId: () => null, ensureCartographe: () => { throw new Error("EBUSY: locked"); } });
      await call(route, "PUT", "/api/projects/state", { sources: [{ id: "s1", label: "x", kind: "local", path: join(dataDir, "proj") }], baseRev: 0 });
      const answer = await call(route, "GET", "/api/projects");
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject({ cartographeBotId: null, state: { sources: [{ id: "s1" }] } });
      expect(String(warned.flat().join(" "))).toContain("EBUSY");
    } finally {
      console.warn = warn;
    }
  });

  it("PUT without a usable baseRev is refused and writes nothing", async () => {
    const route = createProjectRoutes({ dataDir: tmp() });
    for (const baseRev of [undefined, "0", -1, 0.5]) {
      expect((await call(route, "PUT", "/api/projects/state", { groups: [], baseRev })).status).toBe(400);
    }
    expect((await call(route, "GET", "/api/projects")).body).toMatchObject({ state: { rev: 0 } });
  });

  it("PUT /api/projects/state rejects an SSH host that starts with a dash", async () => {
    const route = createProjectRoutes({ dataDir: tmp() });
    const bad = { sources: [{ id: "s1", label: "x", kind: "ssh", host: "-oProxyCommand=x", path: "/" }], baseRev: 0 };
    expect((await call(route, "PUT", "/api/projects/state", bad)).status).toBe(400);
  });

  it("PUT then GET returns the saved groups and scans a local source", async () => {
    const route = createProjectRoutes({ dataDir: tmp() });
    const root = tmp();
    mkdirSync(join(root, "api", "src"), { recursive: true });
    writeFileSync(join(root, "api", "src", "a.ts"), "");
    const state = {
      sources: [{ id: "s1", label: "Here", kind: "local", path: root }],
      groups: [{ id: "g1", name: "Clients", color: "#38d591" }],
      member: { "s1:api": "g1" },
    };
    expect(await call(route, "PUT", "/api/projects/state", { ...state, baseRev: 0 })).toEqual({ status: 200, body: { ok: true, rev: 1 } });

    const got = await call(route, "GET", "/api/projects");
    expect(got.status).toBe(200);
    const body = got.body as { state: { groups: unknown[]; member: Record<string, string> }; projects: { id: string; files: number }[]; errors: unknown[] };
    expect(body.state.groups).toEqual(state.groups);
    expect(body.state.member).toEqual(state.member);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({ id: "s1:api", files: 1 });
    expect(body.errors).toEqual([]);
  });

  it("an unreadable source is reported in errors, other sources still load", async () => {
    const route = createProjectRoutes({ dataDir: tmp() });
    const root = tmp();
    mkdirSync(join(root, "web"), { recursive: true });
    writeFileSync(join(root, "web", "index.html"), "");
    const missing = join(root, "does-not-exist");
    await call(route, "PUT", "/api/projects/state", {
      sources: [
        { id: "gone", label: "Gone", kind: "local", path: missing },
        { id: "ok", label: "Here", kind: "local", path: root },
      ],
      baseRev: 0,
    });

    const body = (await call(route, "GET", "/api/projects")).body as { projects: { id: string }[]; errors: { sourceId: string; message: string }[] };
    expect(body.projects.map((p) => p.id)).toEqual(["ok:web"]);
    expect(body.errors).toEqual([{ sourceId: "gone", message: `Folder not found: ${missing}` }]);
  });

  it("other paths PASS", async () => {
    const route = createProjectRoutes({ dataDir: tmp() });
    expect(await route(ctx("GET", "/api/other"))).toBe(PASS);
    expect(await route(ctx("DELETE", "/api/projects"))).toBe(PASS);
  });
});

describe("GET /api/projects/architecture", () => {
  function localProject(files: Record<string, string>) {
    const root = tmp();
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, "api", ...path.split("/").slice(0, -1)), { recursive: true });
      writeFileSync(join(root, "api", ...path.split("/")), text);
    }
    return root;
  }
  async function withSources(sources: unknown[], overrides: unknown = {}) {
    const route = createProjectRoutes({ dataDir: tmp() });
    expect((await call(route, "PUT", "/api/projects/state", { sources, overrides, baseRev: 0 })).status).toBe(200);
    return route;
  }
  type Arch = { edges: { level: string; from: string; to: string; weight: number }[]; families: { id: string; name: string }[]; files: { path: string }[]; truncated: boolean };
  const architecture = async (route: Awaited<ReturnType<typeof withSources>>, id: string) => {
    const got = await call(route, "GET", `/api/projects/architecture?id=${encodeURIComponent(id)}`);
    return { status: got.status, body: got.body as Arch & { error?: string } };
  };

  it("returns the architecture of a local project", async () => {
    const root = localProject({
      "src/components/A.tsx": 'import { list } from "@/server/users";\nimport "./B";',
      "src/components/B.tsx": "",
      "src/server/users.ts": 'import { z } from "zod";',
      "tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      "node_modules/x/index.ts": 'import "../../src/components/A";',
    });
    const route = await withSources([{ id: "s1", label: "Here", kind: "local", path: root }]);
    const { status, body } = await architecture(route, "s1:api");
    expect(status).toBe(200);
    expect(body.edges).toEqual([{ level: "family", from: "ui", to: "server", weight: 1 }, { level: "module", from: "(root)/ui", to: "(root)/server", weight: 1 }]);
    expect(body.files.map((f) => f.path)).toEqual(["src/components/A.tsx", "src/components/B.tsx", "src/server/users.ts", "tsconfig.json"]);
    expect(body.truncated).toBe(false);
  });

  it("uses the saved family names of that project", async () => {
    const root = localProject({ "src/App.tsx": "" });
    const route = await withSources([{ id: "s1", label: "Here", kind: "local", path: root }], { "s1:api": { moduleFamily: {}, familyNames: { ui: "Front" } } });
    expect((await architecture(route, "s1:api")).body.families).toEqual([{ id: "ui", name: "Front", files: 1, modules: ["(root)/ui"] }]);
  });

  it.each([["s1:nope"], ["s9:api"], ["s1:../api"], ["s1:.hidden"], ["s1:node_modules"], ["s1"], [""], ["s1:api\u0000"], [`s1:${"a".repeat(200)}`]])("unknown project %s → 404", async (id) => {
    const root = localProject({ "a.ts": "" });
    mkdirSync(join(root, ".hidden"));
    const route = await withSources([{ id: "s1", label: "Here", kind: "local", path: root }]);
    const got = await architecture(route, id);
    expect(got.status).toBe(404);
    expect(got.body).toEqual({ error: "Unknown project" });
  });

  it("a source that fails → 502 with its message", async () => {
    const missing = join(tmp(), "gone");
    const route = await withSources([{ id: "s1", label: "Gone", kind: "local", path: missing }]);
    expect(await architecture(route, "s1:api")).toEqual({ status: 502, body: { error: `Folder not found: ${missing}` } });
  });

  it("an edited import is seen on the next call", async () => {
    const root = localProject({ "a.ts": "", "b.ts": "" });
    const route = await withSources([{ id: "s1", label: "Here", kind: "local", path: root }]);
    expect((await architecture(route, "s1:api")).body.edges).toEqual([]);
    writeFileSync(join(root, "api", "a.ts"), 'import "./b";');
    expect((await architecture(route, "s1:api")).body.files.find((f) => f.path === "a.ts")).toMatchObject({ uses: ["b.ts"] });
  });

  it("an unchanged project is served from the cache, and ?refresh=1 reads it again", async () => {
    const root = localProject({ "a.ts": "/*            */", "b.ts": "" });
    const file = join(root, "api", "a.ts");
    utimesSync(file, 1_700_000_000, 1_700_000_000);
    const route = await withSources([{ id: "s1", label: "Here", kind: "local", path: root }]);
    const first = await call(route, "GET", "/api/projects/architecture?id=s1%3Aapi");
    writeFileSync(file, 'import "./b";   ');
    utimesSync(file, 1_700_000_000, 1_700_000_000);
    expect(await call(route, "GET", "/api/projects/architecture?id=s1%3Aapi")).toEqual(first);
    const fresh = (await call(route, "GET", "/api/projects/architecture?id=s1%3Aapi&refresh=1")).body as { files: { path: string; uses: string[] }[] };
    expect(fresh.files.find((f) => f.path === "a.ts")?.uses).toEqual(["b.ts"]);
  });

  it("a non-code file edit does not throw the cache away", async () => {
    const root = localProject({ "a.ts": "", "README.md": "x" });
    let reads = 0;
    const route = createProjectRoutes({ dataDir: tmp(), onArchitectureRead: () => { reads += 1; } });
    await call(route, "PUT", "/api/projects/state", { sources: [{ id: "s1", label: "Here", kind: "local", path: root }], baseRev: 0 });
    await call(route, "GET", "/api/projects/architecture?id=s1%3Aapi");
    writeFileSync(join(root, "api", "README.md"), "longer text");
    await call(route, "GET", "/api/projects/architecture?id=s1%3Aapi");
    expect(reads).toBe(1);
  });

  it("concurrent identical requests read the project once", async () => {
    const root = localProject({ "a.ts": "" });
    let reads = 0;
    const route = createProjectRoutes({ dataDir: tmp(), onArchitectureRead: () => { reads += 1; } });
    await call(route, "PUT", "/api/projects/state", { sources: [{ id: "s1", label: "Here", kind: "local", path: root }], baseRev: 0 });
    const all = await Promise.all([1, 2, 3].map(() => call(route, "GET", "/api/projects/architecture?id=s1%3Aapi")));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(reads).toBe(1);
  });

  it("a change of overrides is not served from the cache", async () => {
    const root = localProject({ "a.ts": "" });
    const route = await withSources([{ id: "s1", label: "Here", kind: "local", path: root }]);
    expect((await architecture(route, "s1:api")).body.families[0].name).toBe("server");
    await call(route, "PUT", "/api/projects/state", { sources: [{ id: "s1", label: "Here", kind: "local", path: root }], overrides: { "s1:api": { moduleFamily: {}, familyNames: { server: "Back" } } }, baseRev: 1 });
    expect((await architecture(route, "s1:api")).body.families[0].name).toBe("Back");
  });

  it("a GitHub account project maps back to <owner>/<repo>", async () => {
    const seen: string[] = [];
    setGithubTransport({
      credential: async () => null,
      fetch: (async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        seen.push(path);
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
        if (path === "/repos/octo/web") return json({ name: "web", full_name: "octo/web", default_branch: "main", pushed_at: "2026-01-01T00:00:00Z", owner: { login: "octo" } });
        if (path === "/repos/octo/web/git/trees/main") return json({ tree: [{ path: "src", type: "tree" }, { path: "src/a.ts", type: "blob" }, { path: "src/b.ts", type: "blob" }] });
        if (path === "/repos/octo/web/tarball/main") return new Response(gzipSync(tar([{ name: "octo-web-1a2b/src/a.ts", data: 'import "./b";' }, { name: "octo-web-1a2b/src/b.ts", data: "" }])));
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }) as typeof globalThis.fetch,
    });
    const route = await withSources([{ id: "g1", label: "GitHub", kind: "github", path: "octo" }]);
    const { status, body } = await architecture(route, "g1:web");
    expect(status).toBe(200);
    expect(body.files).toEqual([
      { path: "src/a.ts", module: "(root)/server", uses: ["src/b.ts"], usedBy: [] },
      { path: "src/b.ts", module: "(root)/server", uses: [], usedBy: ["src/a.ts"] },
    ]);
    expect(seen).toEqual(["/repos/octo/web", "/repos/octo/web/git/trees/main", "/repos/octo/web/tarball/main"]);
  });

  it("GitHub: the same push is served from the cache, a new push is read again", async () => {
    let pushedAt = "2026-01-01T00:00:00Z";
    let body = 'import "./b";';
    const tarballs: string[] = [];
    setGithubTransport({
      credential: async () => null,
      fetch: (async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
        if (path === "/repos/octo/web") return json({ name: "web", full_name: "octo/web", default_branch: "main", pushed_at: pushedAt, owner: { login: "octo" } });
        if (path === "/repos/octo/web/git/trees/main") return json({ tree: [{ path: "a.ts", type: "blob" }, { path: "b.ts", type: "blob" }] });
        if (path === "/repos/octo/web/tarball/main") { tarballs.push(pushedAt); return new Response(gzipSync(tar([{ name: "octo-web-1/a.ts", data: body }, { name: "octo-web-1/b.ts", data: "" }]))); }
        return new Response("{}", { status: 404 });
      }) as typeof globalThis.fetch,
    });
    const route = await withSources([{ id: "g1", label: "GitHub", kind: "github", path: "octo/web" }]);
    expect((await architecture(route, "g1:web")).body.edges).toEqual([]);
    body = "";
    expect((await architecture(route, "g1:web")).body.files.find((f) => f.path === "a.ts")).toMatchObject({ uses: ["b.ts"] });
    pushedAt = "2026-02-01T00:00:00Z";
    expect((await architecture(route, "g1:web")).body.files.find((f) => f.path === "a.ts")).toMatchObject({ uses: [] });
    expect(tarballs).toEqual(["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"]);
  });

  it("a GitHub repository source only knows its own repository", async () => {
    const route = await withSources([{ id: "g1", label: "GitHub", kind: "github", path: "octo/web" }]);
    expect((await architecture(route, "g1:other")).status).toBe(404);
  });
});
