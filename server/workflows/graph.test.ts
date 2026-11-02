import { describe, expect, it } from "vitest";

import type { Workflow, WorkflowEdge, WorkflowNode } from "../../shared/workflows.ts";
import { downstreamOf, edgesInto, nextNodes, topoOrder, validateWorkflow, type Problem } from "./graph.ts";

const n = (id: string, kind: WorkflowNode["kind"], data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, kind, x: 0, y: 0, data: { ...defaults[kind], ...data } }) as WorkflowNode;
const defaults: Record<WorkflowNode["kind"], Record<string, unknown>> = {
  trigger: { mode: "manual" },
  ai: { prompt: "Résume le texte" },
  bot: { instruction: "Fais-le", botId: "bot1" },
  condition: { question: "Est-ce urgent ?" },
  approval: { message: "On envoie ?" },
  send: { to: "notification" },
  note: { text: "" },
};
let seq = 0;
const e = (from: string, to: string, port: "out" | "yes" | "no" = "out", toPort = "in"): WorkflowEdge =>
  ({ id: `e${++seq}`, from: { node: from, port }, to: { node: to, port: toPort } }) as WorkflowEdge;
const wf = (nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow => ({
  id: "w", name: "W", nodes, edges, annotations: [], limits: { maxSteps: 20, maxCostUsd: 1 }, rev: 0, createdAt: 0, updatedAt: 0,
});
const ctx = { botExists: (id: string) => id === "bot1" };
const codes = (problems: Problem[]) => problems.map((p) => p.code);

describe("validateWorkflow", () => {
  it("finds nothing wrong in a simple valid chain", () => {
    const w = wf([n("t", "trigger"), n("a", "ai"), n("c", "condition"), n("s", "send"), n("b", "bot")],
      [e("t", "a"), e("a", "c"), e("c", "s", "yes"), e("c", "b", "no")]);
    expect(validateWorkflow(w, ctx)).toEqual([]);
  });

  it("writes every problem in plain French and English", () => {
    const problems = validateWorkflow(wf([n("a", "ai", { prompt: "" })], []), ctx);
    expect(problems.length).toBeGreaterThan(0);
    for (const p of problems) {
      expect(p.message_fr.length).toBeGreaterThan(5);
      expect(p.message_en.length).toBeGreaterThan(5);
    }
  });

  it("needs exactly one trigger", () => {
    expect(codes(validateWorkflow(wf([n("a", "ai")], []), ctx))).toContain("no-trigger");
    const two = validateWorkflow(wf([n("t1", "trigger"), n("t2", "trigger")], []), ctx);
    expect(two.filter((p) => p.code === "two-triggers")).toEqual([expect.objectContaining({ nodeId: "t2" })]);
  });

  it("refuses a cycle and names an edge that closes it", () => {
    const w = wf([n("t", "trigger"), n("a", "ai"), n("b", "ai")], [e("t", "a"), e("a", "b"), e("b", "a")]);
    const cycle = validateWorkflow(w, ctx).filter((p) => p.code === "cycle");
    expect(cycle).toHaveLength(1);
    expect(cycle[0]!.edgeId).toBe(w.edges[2]!.id);
  });

  it("refuses a link from a block to itself", () => {
    const w = wf([n("t", "trigger"), n("a", "ai")], [e("t", "a"), e("a", "a")]);
    expect(codes(validateWorkflow(w, ctx))).toEqual(["self-loop"]);
  });

  it("refuses ports a block does not have", () => {
    const w = wf([n("t", "trigger"), n("a", "ai"), n("c", "condition"), n("s", "send"), n("x", "ai")], [
      e("t", "a", "yes"), // ai-like output has no "yes"
      e("t", "c"),
      e("c", "x", "out"), // a condition answers yes or no
      e("s", "x"), // send has no output
      e("a", "t"), // a trigger has no input
    ]);
    const bad = validateWorkflow(w, ctx).filter((p) => p.code === "bad-port");
    expect(bad.map((p) => p.edgeId)).toEqual([w.edges[0]!.id, w.edges[2]!.id, w.edges[3]!.id, w.edges[4]!.id]);
  });

  it("refuses links to or from a note", () => {
    const w = wf([n("t", "trigger"), n("note", "note"), n("a", "ai")], [e("t", "note"), e("note", "a"), e("t", "a")]);
    expect(codes(validateWorkflow(w, ctx))).toEqual(["edge-to-note", "edge-from-note"]);
  });

  it("refuses a link to a block that no longer exists, and a duplicate link", () => {
    const w = wf([n("t", "trigger"), n("a", "ai")], [e("t", "a"), e("t", "gone"), e("t", "a")]);
    expect(codes(validateWorkflow(w, ctx))).toEqual(["dangling-edge", "duplicate-edge"]);
  });

  it("names missing settings for each kind", () => {
    const w = wf([
      n("t", "trigger", { mode: "schedule" }),
      n("a", "ai", { prompt: "  " }),
      n("b", "bot", { instruction: "", botId: "" }),
      n("c", "condition", { question: "" }),
      n("p", "approval", { message: "" }),
      n("s", "send", { to: "bot-chat" }),
      n("note", "note", { text: "" }),
    ], []);
    const missing = validateWorkflow(w, ctx).filter((p) => p.code === "missing-setting").map((p) => p.nodeId);
    expect([...new Set(missing)]).toEqual(["t", "a", "b", "c", "p", "s"]);
  });

  it.each([
    [{ kind: "once", at: "08:00" }, false],
    [{ kind: "once", at: "08:00", date: "2026-11-03" }, true],
    [{ kind: "daily" }, false],
    [{ kind: "daily", at: "08:00" }, true],
    [{ kind: "weekdays", at: "08:00", days: [] }, false],
    [{ kind: "weekdays", at: "08:00", days: [1, 5] }, true],
    [{ kind: "interval" }, false],
    [{ kind: "interval", everyMinutes: 30 }, true],
  ])("schedule %o complete: %s", (schedule, ok) => {
    const w = wf([n("t", "trigger", { mode: "schedule", schedule })], []);
    expect(codes(validateWorkflow(w, ctx)).includes("missing-setting")).toBe(!ok);
  });

  it("names a bot that cannot be found, in a Bot block and in a send to a bot's chat", () => {
    const w = wf([n("t", "trigger"), n("b", "bot", { botId: "ghost" }), n("s", "send", { to: "bot-chat", botId: "ghost" })], []);
    expect(validateWorkflow(w, ctx).filter((p) => p.code === "unknown-bot").map((p) => p.nodeId)).toEqual(["b", "s"]);
  });
});

describe("order and walking", () => {
  const w = wf([n("s", "send"), n("note", "note"), n("c", "condition"), n("a", "ai"), n("t", "trigger"), n("b", "bot")],
    [e("t", "a"), e("a", "c"), e("c", "s", "yes"), e("c", "b", "no"), e("b", "s")]);

  it("orders blocks so each comes after the blocks that feed it, notes left out", () => {
    const order = topoOrder(w);
    expect(order).not.toContain("note");
    expect(order).toHaveLength(5);
    const at = (id: string) => order.indexOf(id);
    for (const edge of w.edges) expect(at(edge.from.node)).toBeLessThan(at(edge.to.node));
  });

  it("keeps the blocks' own order when nothing ties them", () => {
    expect(topoOrder(wf([n("t", "trigger"), n("x", "ai"), n("y", "ai")], []))).toEqual(["t", "x", "y"]);
  });

  it("leaves out blocks caught in a cycle instead of looping", () => {
    expect(topoOrder(wf([n("t", "trigger"), n("a", "ai"), n("b", "ai")], [e("a", "b"), e("b", "a")]))).toEqual(["t"]);
  });

  it("finds everything downstream of a block", () => {
    expect(downstreamOf(w, "c")).toEqual(new Set(["s", "b"]));
    expect(downstreamOf(w, "t")).toEqual(new Set(["a", "c", "s", "b"]));
    expect(downstreamOf(w, "s")).toEqual(new Set());
  });

  it("follows one port to the next blocks", () => {
    expect(nextNodes(w, "c", "yes")).toEqual(["s"]);
    expect(nextNodes(w, "c", "no")).toEqual(["b"]);
    expect(nextNodes(w, "c", "out")).toEqual([]);
    expect(nextNodes(w, "a", "out")).toEqual(["c"]);
  });

  it("lists the links coming into a block", () => {
    expect(edgesInto(w, "s").map((edge) => edge.from.node)).toEqual(["c", "b"]);
  });
});
