import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { createProjectRoutes } from "./projects.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "projmap-routes-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ctx(method: string, path: string, body?: unknown): RouteContext & { sent: () => { status: number; body: unknown } } {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, { method, url: path, headers: {} });
  let status = 0;
  let text = "";
  const res = {
    headersSent: false,
    writableEnded: false,
    req,
    writeHead(code: number) { status = code; this.headersSent = true; return this; },
    end(data?: string) { text = data ?? ""; this.writableEnded = true; return this; },
    getHeader: () => undefined,
    hasHeader: () => false,
  } as unknown as ServerResponse;
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
