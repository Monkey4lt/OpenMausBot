import { afterEach, describe, expect, it, vi } from "vitest";

import { OutboundRequestService } from "./outbound-requests.ts";
import { PROJECTS_APPLY_TOOL, PROJECTS_HOLD_MAX_MS, createProjectsHold, projectsCardMessage, projectsCardTitle } from "./projects-hold.ts";

afterEach(() => { vi.useRealTimers(); });

function setup(maxMs = 1_000) {
  const outboundRequests = new OutboundRequestService();
  const cards: Array<{ threadId: string; card: { title: string; lines: string[]; requestId: string } }> = [];
  const dismissed: Array<{ threadId: string; requestId: string }> = [];
  const notified: Array<{ botId: string; text: string }> = [];
  const withdrawnCards: Array<{ threadId: string; requestId: string }> = [];
  const hold = createProjectsHold({
    outboundRequests,
    appendCard: (threadId, card) => { cards.push({ threadId, card }); },
    dismissCard: (threadId, requestId) => { dismissed.push({ threadId, requestId }); },
    notify: (botId, text) => { notified.push({ botId, text }); },
    withdrawCard: (threadId, requestId) => { withdrawnCards.push({ threadId, requestId }); },
    maxMs,
  });
  const answer = (behavior: "allow" | "deny", index = 0) =>
    outboundRequests.resolve({ threadId: cards[index].threadId, requestId: cards[index].card.requestId, behavior });
  return { hold, outboundRequests, cards, dismissed, notified, withdrawnCards, answer };
}

const input = { botId: "carto", threadId: "t1", lines: ["Créer le pôle Clients", "Ranger shop dans Clients"] };
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("createProjectsHold", () => {
  it("never reads an access level: its inputs hold none, and one passed anyway changes nothing", async () => {
    type Keys = keyof import("./projects-hold.ts").ProjectsHoldDeps | keyof Parameters<import("./projects-hold.ts").ProjectsHold["ask"]>[0];
    type AccessKeys = Extract<Keys, "fullAccess" | "approvalMode" | "autoApprove" | "outbound" | "alwaysAllow" | "bot" | "store">;
    const none: [AccessKeys] extends [never] ? true : false = true;
    expect(none).toBe(true);
    const { hold, cards, notified, answer } = setup();
    const full = { ...input, fullAccess: true, approvalMode: "full", autoApprove: true } as typeof input;
    const pending = hold.ask(full);
    expect(cards).toEqual([{ threadId: "t1", card: { title: "Appliquer ces 2 changements à la carte ?", lines: input.lines, requestId: expect.any(String) } }]);
    expect(notified).toEqual([{ botId: "carto", text: "Appliquer ces 2 changements à la carte ?" }]);
    answer("deny");
    await pending;
  });

  it("allow resolves 'allow'; deny resolves 'deny'", async () => {
    const { hold, answer, dismissed } = setup();
    const allowed = hold.ask(input);
    expect(answer("allow")).toEqual({ claimed: true, state: "allowed" });
    await expect(allowed).resolves.toBe("allow");
    const denied = hold.ask(input);
    expect(answer("deny", 1)).toEqual({ claimed: true, state: "denied" });
    await expect(denied).resolves.toBe("deny");
    expect(dismissed).toEqual([]);
  });

  it("an answer from another thread does not settle the card", async () => {
    const { hold, cards, outboundRequests, answer } = setup();
    const pending = hold.ask(input);
    expect(outboundRequests.resolve({ threadId: "t2", requestId: cards[0].card.requestId, behavior: "allow" })).toEqual({ claimed: false });
    answer("deny");
    await expect(pending).resolves.toBe("deny");
  });

  it("no answer resolves 'timeout' after the effective delay and dismisses the card", async () => {
    vi.useFakeTimers();
    const { hold, cards, dismissed } = setup(1_000);
    let settled: string | null = null;
    void hold.ask({ ...input, timeoutMs: 500 }).then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe("timeout");
    expect(dismissed).toEqual([{ threadId: "t1", requestId: cards[0].card.requestId }]);
  });

  it("the delay is clamped to maxMs", async () => {
    vi.useFakeTimers();
    const { hold } = setup(1_000);
    let settled: string | null = null;
    void hold.ask({ ...input, timeoutMs: 60_000 }).then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe("timeout");
    let fallback: string | null = null;
    void hold.ask(input).then((value) => { fallback = value; });
    await vi.advanceTimersByTimeAsync(999);
    expect(fallback).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(fallback).toBe("timeout");
  });

  it("a second answer to the same card is ignored", async () => {
    const { hold, answer } = setup();
    const pending = hold.ask(input);
    answer("allow");
    await expect(pending).resolves.toBe("allow");
    await tick();
    expect(answer("deny").claimed).toBe(false);
    expect(answer("allow").claimed).toBe(false);
  });

  it("a double click before the answer is read settles once", async () => {
    const { hold, answer } = setup();
    const pending = hold.ask(input);
    expect(answer("allow")).toEqual({ claimed: true, state: "allowed" });
    expect(answer("deny")).toEqual({ claimed: true, state: "already_settled", behavior: "allow" });
    await expect(pending).resolves.toBe("allow");
  });

  it("leaves no request held once settled", async () => {
    const { hold, outboundRequests, answer } = setup();
    const pending = hold.ask(input);
    expect(outboundRequests.pending("t1")).toHaveLength(1);
    answer("deny");
    await pending;
    expect(outboundRequests.pending("t1")).toEqual([]);
  });

  it("an abort while waiting forgets the request, dismisses the card and answers inactive", async () => {
    const { hold, cards, dismissed, outboundRequests } = setup();
    const abort = new AbortController();
    const pending = hold.ask({ ...input, signal: abort.signal });
    abort.abort();
    await expect(pending).resolves.toBe("inactive");
    expect(dismissed).toEqual([{ threadId: "t1", requestId: cards[0]!.card.requestId }]);
    expect(outboundRequests.pending("t1")).toEqual([]);
    expect(outboundRequests.resolve({ threadId: "t1", requestId: cards[0]!.card.requestId, behavior: "allow" })).toEqual({ claimed: false });
  });

  it("an already aborted call shows no card", async () => {
    const { hold, cards } = setup();
    const abort = new AbortController();
    abort.abort();
    await expect(hold.ask({ ...input, signal: abort.signal })).resolves.toBe("inactive");
    expect(cards).toEqual([]);
  });

  it("withdraw marks the card it allowed as unavailable", async () => {
    const { hold, cards, answer, withdrawnCards } = setup();
    const input1 = { ...input };
    const pending = hold.ask(input1);
    answer("allow");
    await expect(pending).resolves.toBe("allow");
    hold.withdraw(input1);
    hold.withdraw({ ...input });
    expect(withdrawnCards).toEqual([{ threadId: "t1", requestId: cards[0]!.card.requestId }]);
  });

  it("waits at most nine minutes", () => {
    expect(PROJECTS_HOLD_MAX_MS).toBe(9 * 60_000);
  });
});

describe("projects card", () => {
  it("the card title counts the changes", () => {
    expect(projectsCardTitle(1)).toBe("Appliquer ce changement à la carte ?");
    expect(projectsCardTitle(2)).toBe("Appliquer ces 2 changements à la carte ?");
    expect(projectsCardTitle(100)).toBe("Appliquer ces 100 changements à la carte ?");
  });

  it("is an Allow/Deny card in the outbound shape, one call per line, which the existing answer path finds", () => {
    const message = projectsCardMessage({ title: "Appliquer ces 2 changements à la carte ?", lines: input.lines, requestId: "r1" });
    expect(message).toEqual({
      role: "bot",
      kind: "options",
      card: {
        title: "Appliquer ces 2 changements à la carte ?",
        subtitle: "Créer le pôle Clients\nRanger shop dans Clients",
        options: ["Allow", "Deny"],
        requestId: "r1",
        tool: PROJECTS_APPLY_TOOL,
        outboundRequest: { tool: PROJECTS_APPLY_TOOL, app: null, calls: [{ app: null, label: "Créer le pôle Clients" }, { app: null, label: "Ranger shop dans Clients" }] },
      },
    });
    // The predicate resolveAndSendTrust (server/index.ts) finds an outbound card by.
    const found = [message].find((row) => row.card?.requestId === "r1" && row.card.outboundRequest);
    expect(found).toBe(message);
    expect(found!.card.outboundRequest.calls.map((call) => call.label)).toEqual(input.lines);
    expect(Object.keys(message.card).sort()).toEqual(["options", "outboundRequest", "requestId", "subtitle", "title", "tool"]);
  });

  it("names the bot when the card is posted in a room", () => {
    const message = projectsCardMessage({ title: "t", lines: ["a"], requestId: "r1" }, { botId: "carto", name: "Cartographe", color: "blue" });
    expect(message).toMatchObject({ from: { botId: "carto", name: "Cartographe", color: "blue" } });
  });
});
