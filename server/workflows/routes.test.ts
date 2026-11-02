import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope } from "../request-auth.ts";
import { PASS, type RouteContext, type RouteHandler } from "../routes/table.ts";
import { createWorkflowRoutes } from "./routes.ts";
import { createWorkflowStore } from "./store.ts";

const base = process.env.OMB_TEST_TMP ?? "/tmp/claude-0/-home-claude/d16a11f4-bf84-5ccc-b733-9d95abe987d6/scratchpad";
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(base, "wf-routes-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function ctx(method: string, path: string, body?: unknown): RouteContext & { sent: () => { status: number; body: any } } {
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

async function call(route: RouteHandler, method: string, path: string, body?: unknown) {
  const c = ctx(method, path, body);
  const out = await route(c);
  if (out === PASS) throw new Error(`${method} ${path} was not handled`);
  return c.sent();
}

const draft = (extra: Record<string, unknown> = {}) => ({
  name: "Veille",
  nodes: [
    { id: "t", kind: "trigger", x: 0, y: 0, data: { mode: "manual" } },
    { id: "a", kind: "ai", x: 200, y: 0, data: { prompt: "" } },
  ],
  edges: [{ id: "e1", from: { node: "t", port: "out" }, to: { node: "a", port: "in" } }],
  ...extra,
});

function setup() {
  const store = createWorkflowStore(tmp());
  const changed: [string, number][] = [];
  const route = createWorkflowRoutes({ store, botExists: (id) => id === "b1", onChanged: (id, rev) => changed.push([id, rev]) });
  return { store, route, changed };
}

describe("workflow edit routes", () => {
  it("saves a draft with problems and returns them", async () => {
    const { route, store, changed } = setup();
    const created = await call(route, "POST", "/api/workflows", { workflow: draft() });
    expect(created.status).toBe(200);
    const id = created.body.workflow.id;
    expect(created.body.workflow.rev).toBe(1);
    expect(created.body.problems.map((p: { code: string }) => p.code)).toEqual(["missing-setting"]);
    expect(store.get(id)?.name).toBe("Veille");

    const put = await call(route, "PUT", `/api/workflows/${id}`, { workflow: { ...created.body.workflow, name: "Veille 2" }, baseRev: 1 });
    expect(put.status).toBe(200);
    expect(put.body.workflow.rev).toBe(2);
    expect(put.body.problems).toHaveLength(1);
    expect(changed).toEqual([[id, 1], [id, 2]]);

    const got = await call(route, "GET", `/api/workflows/${id}`);
    expect(got.body.workflow).toEqual(put.body.workflow);
    expect(got.body.problems).toHaveLength(1);

    const list = await call(route, "GET", "/api/workflows");
    expect(list.body.workflows).toEqual([{ id, name: "Veille 2", rev: 2, updatedAt: put.body.workflow.updatedAt }]);
  });

  it("lists the last run of each workflow", async () => {
    const { route, store } = setup();
    const w = store.save(draft({ projectId: "p1" }), 0);
    store.saveRun({ id: "r1", workflowId: w.id, status: "failed", steps: [], startedAt: 5, endedAt: 6 });
    store.saveRun({ id: "r2", workflowId: w.id, status: "succeeded", steps: [], startedAt: 9, endedAt: 10 });
    const list = await call(route, "GET", "/api/workflows");
    expect(list.body.workflows[0]).toEqual({ id: w.id, name: "Veille", projectId: "p1", rev: 1, updatedAt: w.updatedAt, lastRun: { status: "succeeded", startedAt: 9 } });
  });

  it("answers 409 with the saved rev on a stale baseRev", async () => {
    const { route, store } = setup();
    const w = store.save(draft(), 0);
    store.save({ ...w, name: "Ailleurs" }, 1);
    const put = await call(route, "PUT", `/api/workflows/${w.id}`, { workflow: w, baseRev: 1 });
    expect(put.status).toBe(409);
    expect(put.body.rev).toBe(2);
    expect(typeof put.body.error).toBe("string");
    expect(store.get(w.id)?.name).toBe("Ailleurs");
  });

  it("answers 400 with issues on a malformed workflow", async () => {
    const { route, store } = setup();
    const bad = await call(route, "POST", "/api/workflows", { workflow: { ...draft(), name: "" } });
    expect(bad.status).toBe(400);
    expect(bad.body.issues.length).toBeGreaterThan(0);
    expect(store.list()).toHaveLength(0);
    const noRev = await call(route, "PUT", "/api/workflows/x", { workflow: draft() });
    expect(noRev.status).toBe(400);
    const notObject = await call(route, "POST", "/api/workflows", { workflow: "nope" });
    expect(notObject.status).toBe(400);
  });

  it("the id in the path wins over the id in the body", async () => {
    const { route, store } = setup();
    const w = store.save(draft(), 0);
    const put = await call(route, "PUT", `/api/workflows/${w.id}`, { workflow: { ...w, id: "other" }, baseRev: 1 });
    expect(put.status).toBe(200);
    expect(put.body.workflow.id).toBe(w.id);
    expect(store.list()).toHaveLength(1);
  });

  it("answers 404 for an unknown workflow", async () => {
    const { route } = setup();
    expect((await call(route, "GET", "/api/workflows/nope")).status).toBe(404);
    expect((await call(route, "DELETE", "/api/workflows/nope")).status).toBe(404);
  });

  it("deletes a workflow and its runs", async () => {
    const { route, store, changed } = setup();
    const w = store.save(draft(), 0);
    store.saveRun({ id: "r1", workflowId: w.id, status: "succeeded", steps: [], startedAt: 1, endedAt: 2 });
    expect((await call(route, "DELETE", `/api/workflows/${w.id}?baseRev=0`)).status).toBe(409);
    const del = await call(route, "DELETE", `/api/workflows/${w.id}?baseRev=1`);
    expect(del).toEqual({ status: 200, body: { ok: true } });
    expect(store.get(w.id)).toBeNull();
    expect(store.listRuns(w.id)).toEqual([]);
    expect(changed).toEqual([[w.id, 0]]);
  });

  it("passes on other paths", async () => {
    const { route } = setup();
    expect(await route(ctx("GET", "/api/projects"))).toBe(PASS);
    expect(await route(ctx("PATCH", "/api/workflows/x"))).toBe(PASS);
  });

  it("is not reachable by a client token", () => {
    for (const [method, path] of [
      ["GET", "/api/workflows"], ["POST", "/api/workflows"], ["GET", "/api/workflows/w1"], ["PUT", "/api/workflows/w1"], ["DELETE", "/api/workflows/w1"],
      ["POST", "/api/workflows/w1/run"], ["POST", "/api/workflows/w1/run-step"], ["GET", "/api/workflows/w1/runs"],
      ["GET", "/api/workflows/runs/r1"], ["POST", "/api/workflows/runs/r1/retry"], ["POST", "/api/workflows/runs/r1/cancel"],
    ]) expect(requiredScope(method, path)).toBe("admin");
  });
});
