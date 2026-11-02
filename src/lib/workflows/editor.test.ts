import { describe, expect, it } from "vitest";

import type { Workflow } from "../../../shared/workflows";
import {
  addNode, connect, defaultData, duplicateNode, hasBlockOfKind, moveNode, newWorkflowInput, portsFor, problemsByTarget,
  insertApprovalBefore, modelOptions, nodeSummary, openingView, removeEdge, removeNode, updateNodeData, wouldCycle,
} from "./editor";

const empty: Workflow = { id: "w", name: "Matin", nodes: [], edges: [], annotations: [], limits: { maxSteps: 20, maxCostUsd: 1 }, rev: 1, createdAt: 1, updatedAt: 1 };

function chain(): Workflow {
  let w = addNode(empty, "trigger", { x: 0, y: 0 }, "t");
  w = addNode(w, "ai", { x: 400, y: 0 }, "a");
  w = addNode(w, "bot", { x: 800, y: 0 }, "b");
  w = addNode(w, "note", { x: 0, y: 300 }, "n");
  w = addNode(w, "send", { x: 1200, y: 0 }, "s");
  w = addNode(w, "condition", { x: 1200, y: 300 }, "c");
  const one = connect(w, { node: "t", port: "out" }, { node: "a" }, "e1");
  if ("refused" in one) throw new Error(one.refused);
  const two = connect(one, { node: "a", port: "out" }, { node: "b" }, "e2");
  if ("refused" in two) throw new Error(two.refused);
  return two;
}

describe("workflow editor", () => {
  it("adds a block with default settings at the given point", () => {
    const w = addNode(empty, "bot", { x: 120.4, y: 80.6 }, "b1");
    expect(w.nodes).toEqual([{ id: "b1", kind: "bot", x: 120, y: 81, data: { instruction: "", botId: "" } }]);
    expect(defaultData("trigger")).toEqual({ mode: "manual" });
    expect(defaultData("send")).toEqual({ to: "notification" });
    expect(empty.nodes).toEqual([]);
  });

  it("gives each kind its ports: input on the left, outputs on the right, yes and no for a choice", () => {
    expect(portsFor("trigger")).toEqual([{ side: "right", id: "out", kind: "text" }]);
    expect(portsFor("ai")).toEqual([{ side: "left", id: "in", kind: "text" }, { side: "right", id: "out", kind: "text" }]);
    expect(portsFor("condition")).toEqual([{ side: "left", id: "in", kind: "text" }, { side: "right", id: "yes", kind: "yes" }, { side: "right", id: "no", kind: "no" }]);
    expect(portsFor("send")).toEqual([{ side: "left", id: "in", kind: "text" }]);
    expect(portsFor("note")).toEqual([]);
  });

  it("wires an output to an input", () => {
    const w = chain();
    expect(w.edges).toEqual([
      { id: "e1", from: { node: "t", port: "out" }, to: { node: "a", port: "in" } },
      { id: "e2", from: { node: "a", port: "out" }, to: { node: "b", port: "in" } },
    ]);
  });

  it("refuses a wire to a note, to a trigger, from a send block", () => {
    const w = chain();
    expect(connect(w, { node: "a", port: "out" }, { node: "n" }, "x")).toEqual({ refused: "edge-to-note" });
    expect(connect(w, { node: "n", port: "out" }, { node: "b" }, "x")).toEqual({ refused: "edge-from-note" });
    expect(connect(w, { node: "a", port: "out" }, { node: "t" }, "x")).toEqual({ refused: "bad-port" });
    expect(connect(w, { node: "s", port: "out" }, { node: "c" }, "x")).toEqual({ refused: "bad-port" });
    expect(connect(w, { node: "a", port: "yes" }, { node: "c" }, "x")).toEqual({ refused: "bad-port" });
    expect(connect(w, { node: "a", port: "out" }, { node: "a" }, "x")).toEqual({ refused: "self-loop" });
    expect(connect(w, { node: "a", port: "out" }, { node: "gone" }, "x")).toEqual({ refused: "dangling-edge" });
    expect(connect(w, { node: "a", port: "out" }, { node: "b" }, "x")).toEqual({ refused: "duplicate-edge" });
  });

  it("refuses a wire that would close a loop", () => {
    let w = chain();
    const ok = connect(w, { node: "b", port: "out" }, { node: "c" }, "e3");
    if ("refused" in ok) throw new Error(ok.refused);
    w = ok;
    expect(wouldCycle(w, "c", "a")).toBe(true);
    expect(wouldCycle(w, "a", "s")).toBe(false);
    expect(connect(w, { node: "c", port: "no" }, { node: "a" }, "x")).toEqual({ refused: "cycle" });
    const fine = connect(w, { node: "c", port: "yes" }, { node: "s" }, "e4");
    expect("refused" in fine).toBe(false);
  });

  it("removing a block removes its wires", () => {
    const w = removeNode(chain(), "a");
    expect(w.nodes.map((n) => n.id)).toEqual(["t", "b", "n", "s", "c"]);
    expect(w.edges).toEqual([]);
    expect(removeEdge(chain(), "e1").edges.map((e) => e.id)).toEqual(["e2"]);
  });

  it("duplicate keeps settings and gets a new id, no wires", () => {
    let w = updateNodeData(chain(), "b", { instruction: "Range les factures", botId: "bot1" });
    w = duplicateNode(w, "b", "b2");
    const copy = w.nodes.find((n) => n.id === "b2")!;
    expect(copy).toEqual({ id: "b2", kind: "bot", x: 840, y: 40, data: { instruction: "Range les factures", botId: "bot1" } });
    expect(w.edges.some((e) => e.from.node === "b2" || e.to.node === "b2")).toBe(false);
    expect(duplicateNode(w, "nope", "z")).toBe(w);
  });

  it("moves a block to a rounded position and updates its settings without touching others", () => {
    const w = moveNode(chain(), "a", 10.6, -3.2);
    expect(w.nodes.find((n) => n.id === "a")).toMatchObject({ x: 11, y: -3 });
    const u = updateNodeData(w, "t", { mode: "schedule", schedule: { kind: "daily", at: "09:00" } });
    expect(u.nodes.find((n) => n.id === "t")!.data).toEqual({ mode: "schedule", schedule: { kind: "daily", at: "09:00" } });
    expect(u.nodes.find((n) => n.id === "a")).toBe(w.nodes.find((n) => n.id === "a"));
  });

  it("groups problems by block and wire", () => {
    const p = (extra: object) => ({ code: "missing-setting", message_fr: "fr", message_en: "en", ...extra });
    const grouped = problemsByTarget([p({ nodeId: "a" }), p({ nodeId: "a", code: "unknown-bot" }), p({ edgeId: "e1" }), p({ edgeId: "e2", nodeId: "b", code: "cycle" }), p({ code: "no-trigger" })]);
    expect(Object.keys(grouped.nodes)).toEqual(["a"]);
    expect(grouped.nodes.a).toHaveLength(2);
    expect(Object.keys(grouped.edges)).toEqual(["e1", "e2"]);
    expect(grouped.general.map((x) => x.code)).toEqual(["no-trigger"]);
  });

  it("knows when a workflow has a bot block or an approval", () => {
    const w = chain();
    expect(hasBlockOfKind(w, "bot")).toBe(true);
    expect(hasBlockOfKind(w, "approval")).toBe(false);
  });

  it("a new workflow starts with one manual trigger", () => {
    const input = newWorkflowInput("  Rapport du matin ", "t1");
    expect(input).toEqual({ name: "Rapport du matin", nodes: [{ id: "t1", kind: "trigger", x: 80, y: 120, data: { mode: "manual" } }], edges: [], annotations: [] });
  });

  it("sums a block up by the first line of what it says", () => {
    const w = updateNodeData(chain(), "b", { instruction: "\n  Range les factures du mois\npuis envoie-les" });
    expect(nodeSummary(w.nodes.find((n) => n.id === "b")!)).toBe("Range les factures du mois");
    expect(nodeSummary(w.nodes.find((n) => n.id === "t")!)).toBe("");
  });

  it("puts an approval in front of a bot: the wires that reached the bot now reach the approval, whose Yes goes on to the bot", () => {
    const w = insertApprovalBefore(chain(), "b", "p", "e9");
    const approval = w.nodes.find((n) => n.id === "p")!;
    expect(approval).toMatchObject({ kind: "approval", data: { message: "" } });
    expect(w.edges).toEqual([
      { id: "e1", from: { node: "t", port: "out" }, to: { node: "a", port: "in" } },
      { id: "e2", from: { node: "a", port: "out" }, to: { node: "p", port: "in" } },
      { id: "e9", from: { node: "p", port: "yes" }, to: { node: "b", port: "in" } },
    ]);
    expect(approval.x).toBe(800);
    expect(approval.y).toBeGreaterThan(0);
    expect(insertApprovalBefore(chain(), "nope", "p", "e9")).toEqual(chain());
  });

  it("offers the models of every AI that is set up, each named by its AI", () => {
    const instance = (instanceId: string, displayName: string, state: "available" | "unavailable", models: string[]) =>
      ({ instanceId, displayName, snapshot: { state }, models: { default: models[0] ?? "", options: models.map((id) => ({ id, label: id.toUpperCase() })) } });
    expect(modelOptions([instance("claude", "Claude", "available", ["opus", "haiku"]), instance("off", "Off", "unavailable", ["x"]), instance("empty", "Empty", "available", [])])).toEqual([
      { value: "claude/opus", label: "OPUS", group: "Claude" },
      { value: "claude/haiku", label: "HAIKU", group: "Claude" },
    ]);
  });

  it("opens on the whole workflow when it fits at a readable size, else at the start of it", () => {
    const viewport = { w: 1000, h: 600 };
    expect(openingView([{ x: 0, y: 0, w: 400, h: 200 }], viewport)).toEqual({ x: 300, y: 200, scale: 1 });
    const wide = openingView([{ x: 0, y: 0, w: 300, h: 200 }, { x: 2700, y: 0, w: 300, h: 200 }], viewport);
    expect(wide.scale).toBe(0.75);
    expect(wide.x).toBe(80);
    expect(wide.y).toBe(225);
  });
});
