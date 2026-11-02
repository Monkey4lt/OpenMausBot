import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { setGithubTransport } from "../projects-github.ts";
import { tar } from "../testing/tar-builder.ts";
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
    expect(await call(route, "GET", "/api/projects")).toEqual({ status: 200, body: { state: expect.objectContaining({ sources: [] }), projects: [], errors: [] } });
  });

  it("PUT /api/projects/state rejects an SSH host that starts with a dash", async () => {
    const route = createProjectRoutes({ dataDir: tmp() });
    const bad = { sources: [{ id: "s1", label: "x", kind: "ssh", host: "-oProxyCommand=x", path: "/" }] };
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
    expect(await call(route, "PUT", "/api/projects/state", state)).toEqual({ status: 200, body: { ok: true } });

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
    expect((await call(route, "PUT", "/api/projects/state", { sources, overrides })).status).toBe(200);
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

  it.each([["s1:nope"], ["s9:api"], ["s1:../api"], ["s1:.hidden"], ["s1:node_modules"], ["s1"], [""]])("unknown project %s → 404", async (id) => {
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

  it("a second call with the same files does not read them again", async () => {
    const root = localProject({ "a.ts": "", "b.ts": "" });
    const route = await withSources([{ id: "s1", label: "Here", kind: "local", path: root }]);
    expect((await architecture(route, "s1:api")).body.edges).toEqual([]);
    writeFileSync(join(root, "api", "a.ts"), 'import "./b";');
    expect((await architecture(route, "s1:api")).body.edges).toEqual([]);
    writeFileSync(join(root, "api", "c.ts"), "");
    expect((await architecture(route, "s1:api")).body.files.map((f) => f.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("a change of overrides is not served from the cache", async () => {
    const root = localProject({ "a.ts": "" });
    const route = await withSources([{ id: "s1", label: "Here", kind: "local", path: root }]);
    expect((await architecture(route, "s1:api")).body.families[0].name).toBe("server");
    await call(route, "PUT", "/api/projects/state", { sources: [{ id: "s1", label: "Here", kind: "local", path: root }], overrides: { "s1:api": { moduleFamily: {}, familyNames: { server: "Back" } } } });
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

  it("a GitHub repository source only knows its own repository", async () => {
    const route = await withSources([{ id: "g1", label: "GitHub", kind: "github", path: "octo/web" }]);
    expect((await architecture(route, "g1:other")).status).toBe(404);
  });
});
