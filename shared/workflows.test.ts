import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMITS, MAX_EDGES, MAX_IO_CHARS, MAX_NAME_CHARS, MAX_NODES, MAX_TEXT_CHARS, NODE_PORTS,
  cleanText, stepRunSchema, workflowRunSchema, workflowSchema,
} from "./workflows.ts";

const trigger = { id: "t", kind: "trigger", x: 0, y: 0, data: { mode: "manual" } };
const ai = { id: "a", kind: "ai", x: 200, y: 0, data: { prompt: "Résume" } };
const base = { id: "w1", name: "Matin", nodes: [trigger, ai], edges: [{ id: "e1", from: { node: "t", port: "out" }, to: { node: "a", port: "in" } }], createdAt: 1, updatedAt: 1 };

describe("workflow schema", () => {
  it("parses a minimal workflow and fills defaults", () => {
    const w = workflowSchema.parse(base);
    expect(w.limits).toEqual({ maxSteps: 20, maxCostUsd: 1 });
    expect(DEFAULT_LIMITS).toEqual({ maxSteps: 20, maxCostUsd: 1 });
    expect(w.rev).toBe(0);
    expect(w.annotations).toEqual([]);
    expect(w.nodes[1]).toEqual({ id: "a", kind: "ai", x: 200, y: 0, data: { prompt: "Résume" } });
  });

  it("accepts every block kind with its settings", () => {
    const nodes = [
      { id: "t", kind: "trigger", x: 0, y: 0, data: { mode: "schedule", schedule: { kind: "weekdays", at: "08:30", days: [1, 2, 3] } } },
      { id: "a", kind: "ai", x: 0, y: 0, data: { prompt: "p", system: "s", model: "m" } },
      { id: "b", kind: "bot", x: 0, y: 0, data: { instruction: "i", botId: "bot1", model: "m" } },
      { id: "c", kind: "condition", x: 0, y: 0, data: { question: "q ?" } },
      { id: "p", kind: "approval", x: 0, y: 0, data: { message: "ok ?" } },
      { id: "s", kind: "send", x: 0, y: 0, data: { to: "bot-chat", botId: "bot1", text: "t" } },
      { id: "n", kind: "note", x: 0, y: 0, data: { text: "note" } },
    ];
    expect(workflowSchema.parse({ ...base, nodes, edges: [] }).nodes).toHaveLength(7);
  });

  it("an AI-limit-reset trigger keeps the engine it waits for, cleaned", () => {
    const parse = (data: Record<string, unknown>) => workflowSchema.parse({ ...base, nodes: [{ ...trigger, data }, ai] }).nodes[0]!.data;
    expect(parse({ mode: "ai-reset", engine: " codex " })).toEqual({ mode: "ai-reset", engine: "codex" });
    expect(parse({ mode: "ai-reset" })).toEqual({ mode: "ai-reset" });
    expect(() => parse({ mode: "ai-reset", engine: "a b" })).toThrow();
  });

  it("keeps settings optional so a draft with empty fields still saves (graph.ts reports them)", () => {
    const w = workflowSchema.parse({ ...base, nodes: [trigger, { id: "b", kind: "bot", x: 0, y: 0, data: {} }], edges: [] });
    expect(w.nodes[1]!.data).toEqual({ instruction: "", botId: "" });
  });

  it("refuses an unknown kind, an unknown port, and a schedule time that is not HH:MM", () => {
    expect(workflowSchema.safeParse({ ...base, nodes: [{ ...trigger, kind: "http" }] }).success).toBe(false);
    expect(workflowSchema.safeParse({ ...base, edges: [{ id: "e", from: { node: "t", port: "maybe" }, to: { node: "a", port: "in" } }] }).success).toBe(false);
    expect(workflowSchema.safeParse({ ...base, nodes: [{ ...trigger, data: { mode: "schedule", schedule: { kind: "daily", at: "25:00" } } }] }).success).toBe(false);
  });

  it("refuses non-finite positions and duplicate node or edge ids", () => {
    expect(workflowSchema.safeParse({ ...base, nodes: [{ ...trigger, x: Number.NaN }] }).success).toBe(false);
    expect(workflowSchema.safeParse({ ...base, nodes: [trigger, { ...ai, id: "t" }] }).success).toBe(false);
    const e = base.edges[0]!;
    expect(workflowSchema.safeParse({ ...base, edges: [e, e] }).success).toBe(false);
  });

  it("caps nodes at 200 and edges at 400", () => {
    const many = Array.from({ length: MAX_NODES + 1 }, (_, i) => ({ id: `n${i}`, kind: "note", x: 0, y: 0, data: { text: "" } }));
    expect(MAX_NODES).toBe(200);
    expect(workflowSchema.safeParse({ ...base, nodes: many, edges: [] }).success).toBe(false);
    expect(workflowSchema.safeParse({ ...base, nodes: many.slice(0, MAX_NODES), edges: [] }).success).toBe(true);
    const edges = Array.from({ length: MAX_EDGES + 1 }, (_, i) => ({ id: `e${i}`, from: { node: "t", port: "out" }, to: { node: "a", port: "in" } }));
    expect(MAX_EDGES).toBe(400);
    expect(workflowSchema.safeParse({ ...base, edges }).success).toBe(false);
  });

  it("cuts long text to 8000 chars and names to 120, and strips control characters but keeps new lines", () => {
    const w = workflowSchema.parse({
      ...base,
      name: `  ${"n".repeat(500)}`,
      nodes: [trigger, { ...ai, data: { prompt: `a\u0000b\u0007c\r\nd\te${"x".repeat(10_000)}` } }],
    });
    expect(w.name).toHaveLength(MAX_NAME_CHARS);
    const prompt = (w.nodes[1]!.data as { prompt: string }).prompt;
    expect(prompt).toHaveLength(MAX_TEXT_CHARS);
    expect(prompt.startsWith("abc\nd e")).toBe(true);
  });

  it("refuses an empty name after cleaning", () => {
    expect(workflowSchema.safeParse({ ...base, name: " \u0001 " }).success).toBe(false);
  });

  it("bounds limits: maxSteps 1..200 and maxCostUsd 0..100", () => {
    expect(workflowSchema.safeParse({ ...base, limits: { maxSteps: 0, maxCostUsd: 1 } }).success).toBe(false);
    expect(workflowSchema.safeParse({ ...base, limits: { maxSteps: 201, maxCostUsd: 1 } }).success).toBe(false);
    expect(workflowSchema.safeParse({ ...base, limits: { maxSteps: 5, maxCostUsd: 101 } }).success).toBe(false);
    expect(workflowSchema.safeParse({ ...base, limits: { maxSteps: 5, maxCostUsd: -1 } }).success).toBe(false);
    expect(workflowSchema.parse({ ...base, limits: { maxSteps: 200, maxCostUsd: 0 } }).limits).toEqual({ maxSteps: 200, maxCostUsd: 0 });
  });

  it("keeps at most 500 annotations", () => {
    const annotations = Array.from({ length: 600 }, (_, i) => ({ id: `a${i}` }));
    expect(workflowSchema.parse({ ...base, annotations }).annotations).toHaveLength(500);
  });
});

describe("ports", () => {
  it("names each kind's inputs and outputs", () => {
    expect(NODE_PORTS.trigger).toEqual({ inputs: [], outputs: ["out"] });
    expect(NODE_PORTS.ai).toEqual({ inputs: ["in"], outputs: ["out"] });
    expect(NODE_PORTS.condition).toEqual({ inputs: ["in"], outputs: ["yes", "no"] });
    expect(NODE_PORTS.approval).toEqual({ inputs: ["in"], outputs: ["yes", "no"] });
    expect(NODE_PORTS.send).toEqual({ inputs: ["in"], outputs: [] });
    expect(NODE_PORTS.note).toEqual({ inputs: [], outputs: [] });
  });
});

describe("runs", () => {
  it("cuts a step's input and output to 4096 chars and keeps an unknown cost as null", () => {
    const step = stepRunSchema.parse({ nodeId: "a", status: "succeeded", input: "i".repeat(5000), output: "o".repeat(5000), costUsd: null });
    expect(MAX_IO_CHARS).toBe(4096);
    expect(step.input).toHaveLength(4096);
    expect(step.output).toHaveLength(4096);
    expect(step.costUsd).toBeNull();
  });

  it("parses a run and refuses an unknown status", () => {
    const run = { id: "r1", workflowId: "w1", status: "running", steps: [{ nodeId: "t", status: "pending" }], startedAt: 5 };
    expect(workflowRunSchema.parse(run).steps).toHaveLength(1);
    expect(workflowRunSchema.safeParse({ ...run, status: "paused" }).success).toBe(false);
    expect(stepRunSchema.safeParse({ nodeId: "t", status: "done" }).success).toBe(false);
  });
});

describe("cleanText", () => {
  it("drops control and bidi characters, normalises line ends, and truncates", () => {
    expect(cleanText("a\r\nb\rc\u001bd‮e", 100)).toBe("a\nb\ncde");
    expect(cleanText("abcdef", 3)).toBe("abc");
  });
});
