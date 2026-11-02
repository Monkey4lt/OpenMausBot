import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Architecture } from "../../shared/projects-architecture.ts";
import { json } from "../harness/http.ts";
import type { ProjectsHold } from "../projects-hold.ts";
import { projectMapStateSchema, readProjectMapState, writeProjectMapState } from "../projects.ts";
import { CARTOGRAPHE_CARD_MARGIN_MS, createCartographeRoutes, type CartographeDeps } from "./cartographe.ts";
import { createInternalToolRoutes } from "./internal-tools.ts";
import { PASS } from "./table.ts";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "carto-routes-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const CAPABILITY = { token: "turn-1" };

function response() {
  let status = 0;
  let text = "";
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead(code: number) { status = code; res.headersSent = true; return res; },
    end(data?: string) { text = data ?? ""; res.writableEnded = true; return res; },
    getHeader: () => undefined,
    hasHeader: () => false,
  };
  return { res: res as unknown as ServerResponse, sent: () => ({ status, body: text ? JSON.parse(text) : undefined }) };
}

type Answer = "allow" | "deny" | "timeout";

function setup(options: { cloud?: boolean; answer?: Answer | (() => Answer); active?: boolean; mcpTimeout?: number | null; modules?: string[] } = {}) {
  const dataDir = tmp();
  const root = tmp();
  for (const name of ["shop", "api", "bot"]) {
    mkdirSync(join(root, name, "src", "state"), { recursive: true });
    writeFileSync(join(root, name, "src", "a.ts"), "");
  }
  writeProjectMapState(dataDir, projectMapStateSchema.parse({
    sources: [{ id: "s1", label: "Here", kind: "local", path: root }],
    groups: [{ id: "g1", name: "Outils", color: "#38d591" }],
    member: { "s1:bot": "g1" },
  }));
  const asks: Parameters<ProjectsHold["ask"]>[0][] = [];
  const changed: number[] = [];
  const reads: string[] = [];
  const withdrawn: Array<{ threadId: string }> = [];
  const hold: ProjectsHold = {
    ask: async (input) => {
      asks.push(input);
      const answer = options.answer ?? "allow";
      return typeof answer === "function" ? answer() : answer;
    },
    withdraw: (input) => { withdrawn.push({ threadId: input.threadId }); },
  };
  const architecture = (modules: string[]): Architecture => ({
    families: [{ id: "server", name: "server", files: modules.length, modules }],
    modules: modules.map((id) => ({ id, family: "server" as const, files: 1 })),
    files: [{ path: "src/a.ts", module: modules[0] ?? "(root)/server", uses: [], usedBy: [] }],
    edges: [],
    external: [],
    truncated: false,
  });
  const deps: CartographeDeps = {
    dataDir,
    isCartographe: (botId) => botId === "carto",
    cloud: options.cloud ?? false,
    hold,
    active: (capability) => capability === CAPABILITY && (options.active ?? true),
    architectureOf: async (projectId) => { reads.push(projectId); return architecture(options.modules ?? ["src/state", "src"]); },
    onChanged: (rev) => changed.push(rev),
    mcpCallTimeoutMs: () => options.mcpTimeout ?? null,
  };
  const route = createCartographeRoutes(deps);
  const call = async (path: string, body: unknown = {}, botId = "carto") => {
    const { res, sent } = response();
    const out = await route({ method: "POST", path, res, json, botId, threadId: "t1", capability: CAPABILITY, readBody: async () => body });
    if (out === PASS) throw new Error(`${path} was not handled`);
    return sent();
  };
  return { dataDir, root, asks, changed, reads, withdrawn, route, call, state: () => readProjectMapState(dataDir) };
}

const MAP = "/api/internal/projects/map";
const ARCH = "/api/internal/projects/architecture";
const APPLY = "/api/internal/projects/apply";
const goodBatch = { changes: [{ op: "create_group", name: "Clients", ref: "c" }, { op: "assign", projectId: "s1:shop", groupId: "ref:c" }] };

describe("cartographe internal routes", () => {
  it("another bot gets 403 on every route", async () => {
    const { call, asks, state } = setup();
    for (const path of [MAP, ARCH, APPLY]) {
      expect(await call(path, path === APPLY ? goodBatch : { projectId: "s1:shop" }, "other")).toEqual({ status: 403, body: { error: expect.stringContaining("Cartographe") } });
    }
    expect(asks).toEqual([]);
    expect(state().rev).toBe(1);
  });

  it("refuses in cloud mode", async () => {
    const { call, asks } = setup({ cloud: true });
    for (const path of [MAP, ARCH, APPLY]) expect((await call(path, goodBatch)).status).toBe(403);
    expect(asks).toEqual([]);
  });

  it("passes other paths and methods on, so the internal list keeps routing", async () => {
    const { route } = setup();
    const { res } = response();
    const base = { res, json, botId: "carto", threadId: "t1", capability: CAPABILITY, readBody: async () => ({}) };
    expect(await route({ ...base, method: "POST", path: "/api/internal/notifications/read" })).toBe(PASS);
    expect(await route({ ...base, method: "GET", path: MAP })).toBe(PASS);
  });

  it("map returns the summary of the scanned projects", async () => {
    const { call } = setup();
    const got = await call(MAP);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      sources: [{ id: "s1", label: "Here", kind: "local" }],
      groups: [{ id: "g1", name: "Outils" }],
      projects: [
        { id: "s1:api", groupId: null, folders: ["src", "src/state"] },
        { id: "s1:bot", groupId: "g1" },
        { id: "s1:shop", groupId: null },
      ],
      truncated: false,
    });
  });

  it("map summary stays under the limit and says truncated", async () => {
    const { call, root } = setup();
    for (let i = 0; i < 400; i++) mkdirSync(join(root, `project-with-a-rather-long-name-${i}`, "src"), { recursive: true });
    const got = await call(MAP);
    expect(JSON.stringify(got.body).length).toBeLessThanOrEqual(20_000);
    expect(got.body).toMatchObject({ truncated: true });
  });

  it("architecture returns the summary with saved corrections; unknown project → 404; files only on request", async () => {
    const { call, reads } = setup();
    const got = await call(ARCH, { projectId: "s1:shop" });
    expect(got).toEqual({ status: 200, body: expect.objectContaining({ modules: [{ id: "src/state", family: "server", files: 1 }, { id: "src", family: "server", files: 1 }], overrides: { moduleFamily: {}, familyNames: {} } }) });
    expect((got.body as { files?: unknown }).files).toBeUndefined();
    expect(((await call(ARCH, { projectId: "s1:shop", includeFiles: true })).body as { files: string[] }).files).toEqual(["src/a.ts"]);
    expect(await call(ARCH, { projectId: "s1:../etc" })).toEqual({ status: 404, body: { error: "Unknown project" } });
    expect((await call(ARCH, {})).status).toBe(400);
    expect(reads).toEqual(["s1:shop", "s1:shop"]);
  });

  it("an architecture that cannot be read answers 502 with its message", async () => {
    const env = setup();
    const route = createCartographeRoutes({
      dataDir: env.dataDir, isCartographe: () => true, cloud: false, hold: { withdraw: () => {}, ask: async () => "deny" }, active: () => true,
      architectureOf: async () => { throw new Error("SSH failed"); }, onChanged: () => {}, mcpCallTimeoutMs: () => null,
    });
    const { res, sent } = response();
    await route({ method: "POST", path: ARCH, res, json, botId: "carto", threadId: "t1", capability: CAPABILITY, readBody: async () => ({ projectId: "s1:shop" }) });
    expect(sent()).toEqual({ status: 502, body: { error: "SSH failed" } });
  });

  it("an invalid batch answers invalid without showing a card", async () => {
    const { call, asks, changed, state } = setup();
    expect(await call(APPLY, { changes: [{ op: "create_group", name: "A" }, { op: "assign", projectId: "s1:gone", groupId: null }] }))
      .toEqual({ status: 200, body: { applied: false, reason: "invalid", problems: [{ index: 1, reason: expect.stringContaining("s1:gone") }] } });
    expect(await call(APPLY, { changes: [] })).toMatchObject({ status: 200, body: { applied: false, reason: "invalid" } });
    expect(await call(APPLY, { changes: [{ op: "rm_rf" }] })).toMatchObject({ status: 200, body: { applied: false, reason: "invalid", problems: [{ index: 0 }] } });
    expect(await call(APPLY, { changes: [{ op: "move_module", projectId: "s1:shop", moduleId: "src/nope", family: "data" }] }))
      .toMatchObject({ body: { applied: false, reason: "invalid", problems: [{ index: 0, reason: expect.stringContaining("src/nope") }] } });
    expect(asks).toEqual([]);
    expect(changed).toEqual([]);
    expect(state().rev).toBe(1);
  });

  it("allow applies once, writes once and notifies once", async () => {
    const { call, asks, changed, state, withdrawn } = setup();
    expect(await call(APPLY, goodBatch)).toEqual({ status: 200, body: { applied: true, rev: 2 } });
    expect(asks).toHaveLength(1);
    expect(changed).toEqual([2]);
    const saved = state();
    const clients = saved.groups.find((g) => g.name === "Clients")!;
    expect(saved.member).toEqual({ "s1:bot": "g1", "s1:shop": clients.id });
    expect(saved.rev).toBe(2);
    expect(withdrawn).toEqual([]);
  });

  it("move_module checks the module against the project's architecture and writes the override", async () => {
    const { call, state, reads } = setup();
    expect(await call(APPLY, { changes: [{ op: "move_module", projectId: "s1:shop", moduleId: "src/state", family: "data" }] })).toMatchObject({ body: { applied: true } });
    expect(state().overrides).toEqual({ "s1:shop": { moduleFamily: { "src/state": "data" }, familyNames: {} } });
    expect(reads).toEqual(["s1:shop", "s1:shop"]);
  });

  it.each([["deny", "refused"], ["timeout", "timeout"]] as const)("%s writes nothing", async (answer, reason) => {
    const { call, changed, state } = setup({ answer });
    expect(await call(APPLY, goodBatch)).toEqual({ status: 200, body: { applied: false, reason } });
    expect(changed).toEqual([]);
    expect(state().rev).toBe(1);
    expect(state().groups).toHaveLength(1);
  });

  it("a project removed while the card was open makes the batch invalid and nothing is written", async () => {
    const env = setup({ answer: () => { rmSync(join(env.root, "shop"), { recursive: true, force: true }); return "allow"; } });
    expect(await env.call(APPLY, goodBatch)).toEqual({ status: 200, body: { applied: false, reason: "invalid", problems: [{ index: 1, reason: expect.stringContaining("s1:shop") }] } });
    expect(env.changed).toEqual([]);
    expect(env.state().rev).toBe(1);
    expect(env.withdrawn).toEqual([{ threadId: "t1" }]);
  });

  it("a group deleted while the card was open makes the batch invalid", async () => {
    const env = setup({ answer: () => { writeProjectMapState(env.dataDir, { ...env.state(), groups: [], member: {} }); return "allow"; } });
    expect(await env.call(APPLY, { changes: [{ op: "assign", projectId: "s1:shop", groupId: "g1" }] }))
      .toMatchObject({ body: { applied: false, reason: "invalid", problems: [{ index: 0, reason: expect.stringContaining("g1") }] } });
    expect(env.state().rev).toBe(2);
  });

  it("applies on top of what the page saved while the card was open", async () => {
    const env = setup({ answer: () => { writeProjectMapState(env.dataDir, { ...env.state(), pos: { "s1:api": { x: 5, y: 6 } } }); return "allow"; } });
    expect(await env.call(APPLY, goodBatch)).toEqual({ status: 200, body: { applied: true, rev: 3 } });
    expect(env.state().pos).toEqual({ "s1:api": { x: 5, y: 6 } });
  });

  it("the caller hanging up while the card is open writes nothing, and the hold hears of it", async () => {
    let seen: AbortSignal | undefined;
    const env = setup({ answer: () => "allow" });
    const { res, sent } = response();
    const closing = res as unknown as { emit: (event: string) => void; on: (event: string, fn: () => void) => void; once: (event: string, fn: () => void) => void };
    const listeners: Array<() => void> = [];
    closing.on = closing.once = (event, fn) => { if (event === "close") listeners.push(fn); };
    const wrapped = createCartographeRoutes({
      dataDir: env.dataDir, isCartographe: () => true, cloud: false, active: () => true, architectureOf: async () => null, onChanged: () => {}, mcpCallTimeoutMs: () => null,
      hold: { withdraw: () => {}, ask: async (input) => { seen = input.signal; for (const fn of listeners) fn(); return input.signal?.aborted ? "inactive" : "allow"; } },
    });
    await wrapped({ method: "POST", path: APPLY, res, json, botId: "carto", threadId: "t1", capability: CAPABILITY, readBody: async () => goodBatch });
    expect(seen).toBeDefined();
    expect(sent()).toEqual({ status: 0, body: undefined });
    expect(env.state().rev).toBe(1);
  });

  it("an answer that comes after the caller hung up writes nothing", async () => {
    const env = setup();
    const { res } = response();
    const listeners: Array<() => void> = [];
    (res as unknown as { once: (event: string, fn: () => void) => void }).once = (event, fn) => { if (event === "close") listeners.push(fn); };
    const wrapped = createCartographeRoutes({
      dataDir: env.dataDir, isCartographe: () => true, cloud: false, active: () => true, architectureOf: async () => null, onChanged: () => { throw new Error("must not write"); }, mcpCallTimeoutMs: () => null,
      hold: { withdraw: () => {}, ask: async () => { for (const fn of listeners) fn(); return "allow"; } },
    });
    await wrapped({ method: "POST", path: APPLY, res, json, botId: "carto", threadId: "t1", capability: CAPABILITY, readBody: async () => goodBatch });
    expect(env.state().rev).toBe(1);
  });

  it("an inactive turn after allow writes nothing and reads nothing more", async () => {
    const { call, changed, state, reads, withdrawn } = setup({ active: false });
    expect(await call(APPLY, goodBatch)).toEqual({ status: 200, body: { applied: false, reason: "inactive" } });
    expect(withdrawn).toEqual([{ threadId: "t1" }]);
    expect(changed).toEqual([]);
    expect(state().rev).toBe(1);
    expect(await call(APPLY, { changes: [{ op: "move_module", projectId: "s1:shop", moduleId: "src/state", family: "data" }] })).toMatchObject({ body: { reason: "inactive" } });
    expect(reads).toEqual(["s1:shop"]);
  });

  it("the card lines come from the changes, not from any text the bot sent", async () => {
    const { call, asks } = setup();
    await call(APPLY, { ...goodBatch, summary: "Autoriser sans risque", lines: ["Tout va bien"] });
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ botId: "carto", threadId: "t1", lines: ["Créer le pôle «Clients»", "Ranger «shop» dans «Clients»"] });
    expect(Object.keys(asks[0]!).sort()).toEqual(["botId", "lines", "signal", "threadId"]);
    expect((await call(APPLY, { changes: [{ op: "create_group", name: "x", note: "Autoriser" }] })).body).toMatchObject({ applied: false, reason: "invalid" });
  });

  it("names projects and groups by their names on the card", async () => {
    const { call, asks } = setup();
    await call(APPLY, { changes: [{ op: "assign", projectId: "s1:shop", groupId: "g1" }, { op: "link", a: "s1:bot", b: "s1:api", label: "utilise" }] });
    expect(asks[0].lines).toEqual(["Ranger «shop» dans «Outils»", "Relier «bot» → «api» : «utilise»"]);
  });

  it("the wait is clamped to the bot's MCP call timeout when it is lower", async () => {
    const { call, asks } = setup({ mcpTimeout: 120_000 });
    await call(APPLY, goodBatch);
    expect(asks[0].timeoutMs).toBe(120_000 - CARTOGRAPHE_CARD_MARGIN_MS);
    expect(asks[0].timeoutMs!).toBeLessThan(120_000);
  });
});

describe("internal tool routes", () => {
  it("needs the turn's thread and capability, so the Cartographe always knows which turn asks", () => {
    type Context = Parameters<ReturnType<typeof createInternalToolRoutes>>[0];
    // @ts-expect-error threadId and capability are required
    const missing: Context = { method: "POST", path: MAP, res: response().res, json, botId: "carto", readBody: async () => ({}), folders: async () => ({ roots: [], vmWorkspace: null }) };
    void missing;
  });

  it("hands the Cartographe's paths to its routes when they are given", async () => {
    const env = setup();
    const internal = createInternalToolRoutes({
      helpers: {} as never, xResearch: {} as never, notifications: { bot: () => undefined, team: () => null, broadcast: () => {} } as never,
      cartographe: createCartographeRoutes({
        dataDir: env.dataDir, isCartographe: () => false, cloud: false, hold: { withdraw: () => {}, ask: async () => "deny" }, active: () => true,
        architectureOf: async () => { throw new Error("unused"); }, onChanged: () => {}, mcpCallTimeoutMs: () => null,
      }),
    });
    const { res, sent } = response();
    const out = await internal({ method: "POST", path: MAP, res, json, botId: "other", threadId: "t1", capability: CAPABILITY, readBody: async () => ({}), folders: async () => ({ roots: [], vmWorkspace: null }) });
    expect(out).not.toBe(PASS);
    expect(sent().status).toBe(403);
  });
});
