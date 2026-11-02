// Workflows (Atelier, part B): blocks linked by wires that run one after another. Shared by the server (store, graph,
// runner) and the editor. Text is cleaned and capped on parse, so whatever reaches the disk or a model is bounded.
import { z } from "zod";

export const MAX_NODES = 200;
export const MAX_EDGES = 400;
export const MAX_TEXT_CHARS = 8000;
export const MAX_NAME_CHARS = 120;
export const MAX_ANNOTATIONS = 500;
/** What a run keeps of each step's input and output. */
export const MAX_IO_CHARS = 4096;
export const DEFAULT_LIMITS = { maxSteps: 20, maxCostUsd: 1 } as const;

export const NODE_KINDS = ["trigger", "ai", "bot", "condition", "approval", "send", "note"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export const OUTPUT_PORTS = ["out", "yes", "no"] as const;
export type OutputPort = (typeof OUTPUT_PORTS)[number];
export type InputPort = "in";

/** The ports each kind of block has. "out" carries text; "yes"/"no" carry the block's input on to the branch taken. */
export const NODE_PORTS: Record<NodeKind, { inputs: readonly InputPort[]; outputs: readonly OutputPort[] }> = {
  trigger: { inputs: [], outputs: ["out"] },
  ai: { inputs: ["in"], outputs: ["out"] },
  bot: { inputs: ["in"], outputs: ["out"] },
  condition: { inputs: ["in"], outputs: ["yes", "no"] },
  approval: { inputs: ["in"], outputs: ["yes", "no"] },
  send: { inputs: ["in"], outputs: [] },
  note: { inputs: [], outputs: [] },
};

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text[max - 1] ?? "") ? max - 1 : max;
  return text.slice(0, end);
}

/** Line ends become "\n", a tab a space; other control and bidi-override characters are dropped; then cut to `max`. */
export function cleanText(text: string, max: number): string {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, "");
  return cut(clean, max);
}

const text = (max = MAX_TEXT_CHARS) => z.string().transform((s) => cleanText(s, max));
const optionalText = (max = MAX_TEXT_CHARS) => text(max).optional();
const idSchema = z.string().regex(/^[\w-]{1,64}$/);
const refSchema = z.string().max(200).transform((s) => cleanText(s, 200).trim());
const finite = z.number().finite();

export const scheduleSchema = z.object({
  kind: z.enum(["once", "daily", "weekdays", "interval"]),
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  /** 0 = Sunday … 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  everyMinutes: z.number().int().min(1).max(10_080).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type WorkflowSchedule = z.infer<typeof scheduleSchema>;

const triggerData = z.object({
  mode: z.enum(["manual", "schedule", "ai-reset"]).default("manual"),
  schedule: scheduleSchema.optional(),
  /** Mode "ai-reset": the engine instance id whose usage limit it waits for ("claude", "codex", …). */
  engine: z.string().transform((s) => s.trim()).pipe(z.string().regex(/^[\w.:-]{1,128}$/)).optional(),
});
const aiData = z.object({ prompt: text().default(""), system: optionalText(), model: refSchema.optional() });
const botData = z.object({ instruction: text().default(""), botId: refSchema.default(""), model: refSchema.optional() });
const conditionData = z.object({ question: text().default("") });
const approvalData = z.object({ message: text().default("") });
const sendData = z.object({ to: z.enum(["notification", "bot-chat"]).default("notification"), botId: refSchema.optional(), text: optionalText() });
const noteData = z.object({ text: text().default("") });

const node = <K extends NodeKind, D extends z.ZodType>(kind: K, data: D) =>
  z.object({ id: idSchema, kind: z.literal(kind), x: finite, y: finite, data: data.prefault({} as z.input<D>) });

export const workflowNodeSchema = z.discriminatedUnion("kind", [
  node("trigger", triggerData),
  node("ai", aiData),
  node("bot", botData),
  node("condition", conditionData),
  node("approval", approvalData),
  node("send", sendData),
  node("note", noteData),
]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type NodeData<K extends NodeKind> = Extract<WorkflowNode, { kind: K }>["data"];

export const workflowEdgeSchema = z.object({
  id: idSchema,
  from: z.object({ node: idSchema, port: z.enum(OUTPUT_PORTS) }),
  to: z.object({ node: idSchema, port: z.literal("in") }),
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowLimitsSchema = z.object({
  maxSteps: z.number().int().min(1).max(200).default(DEFAULT_LIMITS.maxSteps),
  maxCostUsd: z.number().finite().min(0).max(100).default(DEFAULT_LIMITS.maxCostUsd),
});

export const workflowSchema = z.object({
  id: idSchema,
  name: z.string().transform((s) => cleanText(s.replace(/\n/g, " "), 10_000).trim().slice(0, MAX_NAME_CHARS).trim()).pipe(z.string().min(1)),
  projectId: z.string().min(1).max(200).optional(),
  nodes: z.array(workflowNodeSchema).max(MAX_NODES),
  edges: z.array(workflowEdgeSchema).max(MAX_EDGES),
  /** Canvas notes and drawings (src/lib/canvas/model.ts shape); kept opaque here, at most 500. */
  annotations: z.array(z.unknown()).transform((list) => list.slice(0, MAX_ANNOTATIONS)).default([]),
  limits: workflowLimitsSchema.prefault({}),
  /** Bumped by every save; a save based on an older rev is refused. */
  rev: z.number().int().nonnegative().default(0),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).superRefine((w, ctx) => {
  const unique = (ids: string[], path: "nodes" | "edges") => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) ctx.addIssue({ code: "custom", path: [path, index, "id"], message: `Duplicate id ${id}` });
      seen.add(id);
    });
  };
  unique(w.nodes.map((n) => n.id), "nodes");
  unique(w.edges.map((e) => e.id), "edges");
});
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowInput = z.input<typeof workflowSchema>;

const io = z.string().transform((s) => cut(s, MAX_IO_CHARS));
export const stepRunSchema = z.object({
  nodeId: idSchema,
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]),
  /** The output port a succeeded step took; absent for a block with no output. */
  port: z.enum(OUTPUT_PORTS).optional(),
  input: io.optional(),
  output: io.optional(),
  error: z.string().transform((s) => cut(s, 2000)).optional(),
  /** null: the step had a cost no one could tell. Never read as zero. */
  costUsd: z.number().finite().nonnegative().nullable().optional(),
  startedAt: z.number().int().nonnegative().optional(),
  endedAt: z.number().int().nonnegative().optional(),
});
export type StepRun = z.infer<typeof stepRunSchema>;
export type StepStatus = StepRun["status"];

export const workflowRunSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  reason: z.string().transform((s) => cut(s, 2000)).optional(),
  steps: z.array(stepRunSchema).max(MAX_NODES),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type RunStatus = WorkflowRun["status"];
