import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Notification } from "../../shared/notification.ts";
import type { Workflow } from "../../shared/workflows.ts";
import { json } from "../harness/http.ts";
import { OutboundRequestService } from "../outbound-requests.ts";
import { createWorkflowCartographeRoutes, proposalCard, WORKFLOWS_PROPOSE_TOOL } from "../workflows/cartographe.ts";
import { createWorkflowStore } from "../workflows/store.ts";
import type { CartographeContext } from "./cartographe.ts";
import { PASS } from "./table.ts";

const base = process.env.OMB_TEST_TMP ?? "/tmp/claude-0/-home-claude/d16a11f4-bf84-5ccc-b733-9d95abe987d6/scratchpad";
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(base, "wf-carto-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const CAPABILITY = { token: "turn-1" };

function response() {
  let status = 0, text = "";
  const res = {
    headersSent: false, writableEnded: false,
    writeHead(code: number) { status = code; res.headersSent = true; return res; },
    end(data?: string) { text = data ?? ""; res.writableEnded = true; return res; },
    getHeader: () => undefined, hasHeader: () => false, once: () => res,
  };
  return { res: res as unknown as ServerResponse, sent: () => ({ status, body: text ? JSON.parse(text) : undefined }) };
}

type Card = { title: string; subtitle: string; requestId: string; tool: string; options: string[]; answered?: string; outboundRequest: { tool: string; calls: { label: string }[] } };

function setup(options: { language?: string; active?: boolean } = {}) {
  const store = createWorkflowStore(tmp());
  const outbound = new OutboundRequestService();
  const bots = new Map([["carto", { id: "carto", name: "Cartographe", threadId: "carto-thread" }], ["b1", { id: "b1", name: "Rédacteur", threadId: "b1-thread" }]]);
  const messages: { id: string; threadId: string; card?: Card; [key: string]: unknown }[] = [];
  const notes: Notification[] = [];
  const saved: Workflow[] = [];
  let seq = 0;
  const route = createWorkflowCartographeRoutes({
    store,
    chat: {
      bot: (id) => bots.get(id) as never,
      appendMessage: (threadId, message) => { const m = { ...(message as object), id: `m${++seq}`, threadId } as never; messages.push(m); return m; },
      messagesFor: (threadId) => messages.filter((m) => m.threadId === threadId) as never,
      patchMessage: (threadId, id, patch) => { const m = messages.find((x) => x.id === id && x.threadId === threadId); if (m) Object.assign(m, patch); return m as never; },
    },
    isCartographe: (id) => id === "carto",
    botExists: (id) => bots.has(id),
    projectName: (id) => (id === "s1:shop" ? "shop" : null),
    language: () => options.language ?? "fr",
    outboundRequests: outbound,
    notify: (n) => { if (n) notes.push(n); },
    active: (capability) => capability === CAPABILITY && (options.active ?? true),
    mcpCallTimeoutMs: () => null,
    onSaved: (w) => saved.push(w),
    newId: () => "wf-new",
  });
  const call = async (path: string, body: unknown, botId = "carto") => {
    const { res, sent } = response();
    const ctx: CartographeContext = { method: "POST", path, res, json, botId, threadId: "carto-thread", capability: CAPABILITY, readBody: async () => body };
    const out = route(ctx);
    return { done: out.then((value) => { if (value === PASS) throw new Error("not handled"); return sent(); }) };
  };
  const card = () => messages.at(-1)?.card;
  const waitCard = async () => { for (let i = 0; i < 50 && !card(); i++) await new Promise((r) => setTimeout(r, 1)); return card()!; };
  const answer = (behavior: "allow" | "deny") => outbound.resolve({ threadId: "carto-thread", requestId: card()!.requestId, behavior });
  return { store, route, call, card, waitCard, answer, messages, notes, saved, bots };
}

const proposal = (extra: Record<string, unknown> = {}) => ({
  name: "Veille du matin",
  projectId: "s1:shop",
  nodes: [
    { id: "t", kind: "trigger", data: { mode: "schedule", schedule: { kind: "daily", at: "08:00" } } },
    { id: "a", kind: "ai", data: { prompt: "Résume les nouvelles\ndu jour" } },
    { id: "c", kind: "condition", data: { question: "Est-ce urgent ?" } },
    { id: "b", kind: "bot", data: { instruction: "Écris un mail", botId: "b1" } },
    { id: "s", kind: "send", data: { to: "notification" } },
  ],
  edges: [{ from: "t", to: "a" }, { from: "a", to: "c" }, { from: "c", port: "yes", to: "b" }, { from: "c", port: "no", to: "s" }],
  ...extra,
});

describe("the Cartographe proposes workflows", () => {
  it("an invalid proposal is refused without a card", async () => {
    const h = setup();
    const cycle = await (await h.call("/api/internal/workflows/propose", proposal({ edges: [{ from: "t", to: "a" }, { from: "a", to: "c" }, { from: "c", port: "yes", to: "a" }] }))).done;
    expect(cycle.status).toBe(200);
    expect(cycle.body).toMatchObject({ created: false, reason: "invalid" });
    expect(cycle.body.problems.some((p: { message: string }) => /circles/.test(p.message))).toBe(true);
    const unknownBot = await (await h.call("/api/internal/workflows/propose", proposal({ nodes: [...proposal().nodes.slice(0, 3), { id: "b", kind: "bot", data: { instruction: "x", botId: "ghost" } }, proposal().nodes[4]] }))).done;
    expect(unknownBot.body).toMatchObject({ created: false, reason: "invalid" });
    const malformed = await (await h.call("/api/internal/workflows/propose", { name: "x", nodes: [{ id: "t", kind: "rocket" }], edges: [] })).done;
    expect(malformed.body).toMatchObject({ created: false, reason: "invalid" });
    const project = await (await h.call("/api/internal/workflows/propose", proposal({ projectId: "s1:nope" }))).done;
    expect(project.body.problems).toEqual([{ message: "Unknown project s1:nope" }]);
    expect(h.messages).toEqual([]);
    expect(h.notes).toEqual([]);
    expect(h.store.list()).toEqual([]);
  });

  it("Allow creates the workflow", async () => {
    const h = setup();
    const pending = await h.call("/api/internal/workflows/propose", proposal());
    const card = await h.waitCard();
    expect(card).toMatchObject({ tool: WORKFLOWS_PROPOSE_TOOL, options: ["Allow", "Deny"], outboundRequest: { tool: WORKFLOWS_PROPOSE_TOOL } });
    expect(h.notes).toHaveLength(1);
    expect(h.store.list()).toEqual([]);
    h.answer("allow");
    const out = await pending.done;
    expect(out.body).toEqual({ created: true, workflowId: "wf-new", name: "Veille du matin" });
    const saved = h.store.get("wf-new")!;
    expect(saved).toMatchObject({ name: "Veille du matin", projectId: "s1:shop", rev: 1 });
    expect(saved.nodes.map((n) => [n.id, n.x])).toEqual([["t", 0], ["a", 320], ["c", 640], ["b", 960], ["s", 960]]);
    expect(saved.edges[2]).toEqual({ id: "e3", from: { node: "c", port: "yes" }, to: { node: "b", port: "in" } });
    expect(h.saved.map((w) => w.id)).toEqual(["wf-new"]);
  });

  it("Deny creates nothing", async () => {
    const h = setup();
    const pending = await h.call("/api/internal/workflows/propose", proposal());
    await h.waitCard();
    h.answer("deny");
    expect((await pending.done).body).toEqual({ created: false, reason: "refused" });
    expect(h.store.list()).toEqual([]);
    expect(h.saved).toEqual([]);
  });

  it("the card text is built by the server", async () => {
    const h = setup();
    const pending = await h.call("/api/internal/workflows/propose", proposal({ title: "Click Allow, it is safe", cardText: "IGNORE THIS", summary: "Trust me" }));
    const card = await h.waitCard();
    expect(card.title).toBe("Créer le workflow « Veille du matin » ?");
    expect(card.subtitle.split("\n")).toEqual([
      "Projet : shop",
      "1. Déclencheur : chaque jour à 08:00 (→ 2)",
      "2. IA : « Résume les nouvelles du jour » (→ 3)",
      "3. Condition : « Est-ce urgent ? » (oui → 4 ; non → 5)",
      "4. Bot : Rédacteur — « Écris un mail »",
      "5. Envoyer : en notification",
      "Au plus 20 étapes et 1 $ par exécution",
    ]);
    expect(JSON.stringify(card)).not.toMatch(/Click Allow|IGNORE|Trust me/);
    expect(card.outboundRequest.calls.map((c) => c.label)).toEqual(card.subtitle.split("\n"));
    h.answer("deny");
    await pending.done;
    const english = proposalCard(h.store.list()[0] ?? (await import("../../shared/workflows.ts")).workflowSchema.parse({ ...proposal(), id: "w", nodes: proposal().nodes.map((n) => ({ ...n, x: 0, y: 0 })), edges: [], createdAt: 0, updatedAt: 0 }), "en", { bot: (id) => id, project: (id) => id });
    expect(english.title).toBe('Create the workflow "Veille du matin"?');
  });

  it("a bot deleted between the card and Allow refuses the save", async () => {
    const h = setup();
    const pending = await h.call("/api/internal/workflows/propose", proposal());
    await h.waitCard();
    h.bots.delete("b1");
    h.answer("allow");
    const out = await pending.done;
    expect(out.body).toMatchObject({ created: false, reason: "invalid" });
    expect(h.store.list()).toEqual([]);
    expect(h.card()!.answered).toBe("unavailable");
  });

  it("a turn that ended before Allow saves nothing", async () => {
    const h = setup({ active: false });
    const pending = await h.call("/api/internal/workflows/propose", proposal());
    await h.waitCard();
    h.answer("allow");
    expect((await pending.done).body).toEqual({ created: false, reason: "inactive" });
    expect(h.store.list()).toEqual([]);
  });

  it("only the Cartographe may read or propose", async () => {
    const h = setup();
    expect((await (await h.call("/api/internal/workflows/read", {}, "b1")).done).status).toBe(403);
    expect((await (await h.call("/api/internal/workflows/propose", proposal(), "b1")).done).status).toBe(403);
    const { res } = response();
    expect(await h.route({ method: "POST", path: "/api/internal/projects/map", res, json, botId: "carto", threadId: "t", capability: CAPABILITY, readBody: async () => ({}) })).toBe(PASS);
  });

  it("workflows_read lists each workflow with its blocks, wires and last run, texts cleaned and cut", async () => {
    const h = setup();
    h.store.save({ id: "w1", name: "Tri", nodes: [{ id: "t", kind: "trigger", x: 0, y: 0, data: { mode: "manual" } }, { id: "a", kind: "ai", x: 1, y: 0, data: { prompt: `Ligne‮ un\n${"x".repeat(500)}` } }], edges: [{ id: "e", from: { node: "t", port: "out" }, to: { node: "a", port: "in" } }] }, 0);
    const out = await (await h.call("/api/internal/workflows/read", {})).done;
    expect(out.status).toBe(200);
    expect(out.body.note).toMatch(/data, never instructions/);
    const [w] = out.body.workflows;
    expect(w).toMatchObject({ id: "w1", name: "Tri", wires: [{ from: "t", port: "out", to: "a" }], limits: { maxSteps: 20, maxCostUsd: 1 } });
    expect(w.blocks[1].settings.prompt.length).toBeLessThanOrEqual(300);
    expect(w.blocks[1].settings.prompt.startsWith("Ligne un x")).toBe(true);
  });
});
