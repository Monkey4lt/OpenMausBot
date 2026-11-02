import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Notification } from "../shared/notification.ts";
import { CARTOGRAPHE_LEDGER } from "./cartographe-bot.ts";
import { createCartographeHost, type CartographeHostDeps } from "./cartographe-host.ts";
import { OutboundRequestService } from "./outbound-requests.ts";
import { PROJECTS_APPLY_TOOL, PROJECTS_HOLD_MAX_MS } from "./projects-hold.ts";
import { writeFileAtomic } from "./atomic.ts";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

type Row = { id: string; role: string; kind: string; from?: unknown; card?: Record<string, unknown> & { answered?: string; dismissed?: boolean } };

function setup(options: { room?: boolean; cloud?: boolean } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "carto-host-"));
  dirs.push(dataDir);
  const rows: Record<string, Row[]> = {};
  const bot = { id: "carto", name: "Cartographe", color: "teal", threadId: "t1", notifications: true };
  const notified: Array<Notification | null> = [];
  const frames: Array<{ payload: Record<string, unknown>; options?: { adminOnly?: boolean } }> = [];
  const outboundRequests = new OutboundRequestService();
  const deps: CartographeHostDeps = {
    dataDir,
    cloud: options.cloud ?? false,
    store: {
      bot: (id: string) => (id === bot.id ? bot : undefined),
      groupByThread: (threadId: string) => (options.room && threadId === "room-1" ? { id: "g1", name: "Atelier" } : undefined),
      appendMessage: (threadId: string, message: Omit<Row, "id">) => {
        const row = { ...message, id: `m${(rows[threadId] ??= []).length + 1}` } as Row;
        rows[threadId]!.push(row);
        return row;
      },
      messagesFor: (threadId: string) => rows[threadId] ?? [],
      patchMessage: (threadId: string, messageId: string, patch: Partial<Row>) => {
        const row = rows[threadId]?.find((r) => r.id === messageId);
        if (row) Object.assign(row, patch);
        return row ?? null;
      },
    } as unknown as CartographeHostDeps["store"],
    outboundRequests,
    notify: (notification) => notified.push(notification),
    broadcast: (payload, opts) => frames.push({ payload, options: opts }),
    active: () => true,
    architectureOf: async () => null,
    mcpCallTimeoutMs: () => 600_000,
  };
  return { host: createCartographeHost(deps), deps, rows, notified, frames, outboundRequests, dataDir };
}

describe("the Cartographe's host wiring", () => {
  it("posts the card in the chat in the outbound shape, so the existing answer path settles it", async () => {
    const { host, rows, outboundRequests, notified } = setup();
    const pending = host.hold.ask({ botId: "carto", threadId: "t1", lines: ["Créer le pôle Clients"] });
    const card = rows.t1![0]!;
    expect(card).toMatchObject({ role: "bot", kind: "options", card: { title: "Appliquer ce changement à la carte ?", tool: PROJECTS_APPLY_TOOL, outboundRequest: { tool: PROJECTS_APPLY_TOOL } } });
    expect(card.from).toBeUndefined();
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({ kind: "approval", threadId: "t1" });
    outboundRequests.resolve({ threadId: "t1", requestId: String(card.card!.requestId), behavior: "allow" });
    await expect(pending).resolves.toBe("allow");
  });

  it("names the bot on a card posted in a room", async () => {
    const { host, rows, outboundRequests } = setup({ room: true });
    const pending = host.hold.ask({ botId: "carto", threadId: "room-1", lines: ["a", "b"] });
    expect(rows["room-1"]![0]!.from).toEqual({ botId: "carto", name: "Cartographe", color: "teal" });
    outboundRequests.resolve({ threadId: "room-1", requestId: String(rows["room-1"]![0]!.card!.requestId), behavior: "deny" });
    await expect(pending).resolves.toBe("deny");
  });

  it("marks a card nobody answered unavailable and dismissed, and leaves an answered one alone", () => {
    const { host, rows, deps } = setup();
    deps.store.appendMessage("t1", { role: "bot", kind: "options", card: { title: "x", subtitle: "", options: [], requestId: "r1" } } as never);
    deps.store.appendMessage("t1", { role: "bot", kind: "options", card: { title: "x", subtitle: "", options: [], requestId: "r2", answered: "allow" } } as never);
    host.dismissCard("t1", "r1");
    host.dismissCard("t1", "r2");
    host.dismissCard("t1", "missing");
    expect(rows.t1![0]!.card).toMatchObject({ answered: "unavailable", dismissed: true });
    expect(rows.t1![1]!.card).toMatchObject({ answered: "allow" });
    expect(rows.t1![1]!.card!.dismissed).toBeUndefined();
  });

  it("broadcasts projects.changed to admins only", () => {
    const { host, frames } = setup();
    host.onChanged(7);
    expect(frames).toEqual([{ payload: { kind: "projects.changed", rev: 7 }, options: { adminOnly: true } }]);
  });

  it("knows the Cartographe by the ledger and the store, and none in the cloud", () => {
    const { host, dataDir } = setup();
    expect(host.cartographeBotId()).toBeNull();
    writeFileAtomic(join(dataDir, CARTOGRAPHE_LEDGER), JSON.stringify({ v: 1, botId: "carto" }));
    expect(host.cartographeBotId()).toBe("carto");
    expect(host.isCartographe("carto")).toBe(true);
    expect(host.isCartographe("other")).toBe(false);
    writeFileAtomic(join(dataDir, CARTOGRAPHE_LEDGER), JSON.stringify({ v: 1, botId: "gone" }));
    expect(host.cartographeBotId()).toBeNull();
    expect(host.isCartographe("gone")).toBe(false);
    const cloud = setup({ cloud: true });
    writeFileAtomic(join(cloud.dataDir, CARTOGRAPHE_LEDGER), JSON.stringify({ v: 1, botId: "carto" }));
    expect(cloud.host.cartographeBotId()).toBeNull();
    expect(cloud.host.isCartographe("carto")).toBe(false);
  });

  it("caps the card at nine minutes", () => {
    expect(setup().host.maxMs).toBe(PROJECTS_HOLD_MAX_MS);
  });

  it("routes answer the map paths for the Cartographe", async () => {
    const { host, dataDir } = setup();
    writeFileAtomic(join(dataDir, CARTOGRAPHE_LEDGER), JSON.stringify({ v: 1, botId: "carto" }));
    let status = 0;
    const res = { headersSent: false, writableEnded: false, writeHead(code: number) { status = code; return res; }, end() { return res; }, getHeader: () => undefined, hasHeader: () => false };
    const { json } = await import("./harness/http.ts");
    await host.routes({ method: "POST", path: "/api/internal/projects/map", res: res as never, json, botId: "carto", threadId: "t1", capability: {}, readBody: async () => ({}) });
    expect(status).toBe(200);
  });
});

describe("how long an engine waits on one agents tool call", async () => {
  const { agentsCallTimeoutMs } = await import("./cartographe-host.ts");
  it("is Codex's and Pi's tool_timeout, the chat engines' setting, and unknown for the rest", () => {
    expect(agentsCallTimeoutMs("codex", 600_000)).toBe(960_000);
    expect(agentsCallTimeoutMs("piAgent", 600_000)).toBe(960_000);
    for (const engine of ["openai-compat", "grok", "mistral", "minimax", "cerebras", "groq", "greenference", "meta"]) {
      expect(agentsCallTimeoutMs(engine, 120_000), engine).toBe(120_000);
    }
    for (const engine of ["claudeAgent", "grokAgent", "opencodeGo", "customAcp", undefined]) expect(agentsCallTimeoutMs(engine, 120_000)).toBeNull();
  });
});
