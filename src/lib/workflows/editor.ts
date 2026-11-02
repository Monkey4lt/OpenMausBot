import { NODE_PORTS, type NodeKind, type OutputPort, type Workflow, type WorkflowEdge, type WorkflowNode } from "../../../shared/workflows";
import { boundsOf, fitRects, type Rect, type View } from "@/lib/canvas/geometry";

/** A validation problem as the server sends it (server/workflows/graph.ts). */
export interface WorkflowProblem {
  nodeId?: string;
  edgeId?: string;
  code: string;
  message_fr: string;
  message_en: string;
}

export type PortId = "in" | OutputPort;
export type EditorPort = { side: "left" | "right"; id: PortId; kind: "text" | "yes" | "no" };
export type ConnectRefusal = "edge-to-note" | "edge-from-note" | "bad-port" | "self-loop" | "cycle" | "duplicate-edge" | "dangling-edge";
type Point = { x: number; y: number };

export const NODE_WIDTH: Record<NodeKind, number> = { trigger: 320, ai: 340, bot: 340, condition: 300, approval: 300, send: 300, note: 260 };
/** Heights before a block is measured: links and fitting use them until the real size is known. */
export const NODE_HEIGHT: Record<NodeKind, number> = { trigger: 190, ai: 250, bot: 250, condition: 210, approval: 210, send: 190, note: 140 };
export const DUPLICATE_OFFSET = 40;

export function portsFor(kind: NodeKind): EditorPort[] {
  const ports: EditorPort[] = NODE_PORTS[kind].inputs.map((id) => ({ side: "left", id, kind: "text" }));
  for (const id of NODE_PORTS[kind].outputs) ports.push({ side: "right", id, kind: id === "out" ? "text" : id });
  return ports;
}

export function defaultData(kind: NodeKind): WorkflowNode["data"] {
  switch (kind) {
    case "trigger": return { mode: "manual" };
    case "ai": return { prompt: "" };
    case "bot": return { instruction: "", botId: "" };
    case "condition": return { question: "" };
    case "approval": return { message: "" };
    case "send": return { to: "notification" };
    case "note": return { text: "" };
  }
}

export function addNode(w: Workflow, kind: NodeKind, at: Point, id: string): Workflow {
  const node = { id, kind, x: Math.round(at.x), y: Math.round(at.y), data: defaultData(kind) } as WorkflowNode;
  return { ...w, nodes: [...w.nodes, node] };
}

/** Whether a wire from `from` to `to` would close a loop: `from` can already be reached from `to`. */
export function wouldCycle(w: Workflow, from: string, to: string): boolean {
  const seen = new Set<string>();
  const queue = [to];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of w.edges) if (edge.from.node === id) queue.push(edge.to.node);
  }
  return false;
}

export function connect(w: Workflow, from: { node: string; port: OutputPort }, to: { node: string }, id: string): Workflow | { refused: ConnectRefusal } {
  const source = w.nodes.find((n) => n.id === from.node), target = w.nodes.find((n) => n.id === to.node);
  if (!source || !target) return { refused: "dangling-edge" };
  if (source.id === target.id) return { refused: "self-loop" };
  if (target.kind === "note") return { refused: "edge-to-note" };
  if (source.kind === "note") return { refused: "edge-from-note" };
  if (!NODE_PORTS[source.kind].outputs.includes(from.port) || !NODE_PORTS[target.kind].inputs.includes("in")) return { refused: "bad-port" };
  if (w.edges.some((e) => e.from.node === from.node && e.from.port === from.port && e.to.node === to.node)) return { refused: "duplicate-edge" };
  if (wouldCycle(w, from.node, to.node)) return { refused: "cycle" };
  const edge: WorkflowEdge = { id, from: { node: from.node, port: from.port }, to: { node: to.node, port: "in" } };
  return { ...w, edges: [...w.edges, edge] };
}

export function removeNode(w: Workflow, id: string): Workflow {
  return { ...w, nodes: w.nodes.filter((n) => n.id !== id), edges: w.edges.filter((e) => e.from.node !== id && e.to.node !== id) };
}

export function removeEdge(w: Workflow, id: string): Workflow {
  return { ...w, edges: w.edges.filter((e) => e.id !== id) };
}

export function duplicateNode(w: Workflow, id: string, newId: string): Workflow {
  const node = w.nodes.find((n) => n.id === id);
  if (!node) return w;
  const copy = { ...node, id: newId, x: node.x + DUPLICATE_OFFSET, y: node.y + DUPLICATE_OFFSET, data: structuredClone(node.data) } as WorkflowNode;
  return { ...w, nodes: [...w.nodes, copy] };
}

export function moveNode(w: Workflow, id: string, x: number, y: number): Workflow {
  return { ...w, nodes: w.nodes.map((n) => (n.id === id ? { ...n, x: Math.round(x), y: Math.round(y) } : n)) };
}

export function updateNodeData(w: Workflow, id: string, patch: Record<string, unknown>): Workflow {
  return { ...w, nodes: w.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } as WorkflowNode : n)) };
}

export function problemsByTarget(problems: readonly WorkflowProblem[]) {
  const nodes: Record<string, WorkflowProblem[]> = {};
  const edges: Record<string, WorkflowProblem[]> = {};
  const general: WorkflowProblem[] = [];
  for (const problem of problems) {
    if (problem.edgeId) (edges[problem.edgeId] ??= []).push(problem);
    else if (problem.nodeId) (nodes[problem.nodeId] ??= []).push(problem);
    else general.push(problem);
  }
  return { nodes, edges, general };
}

export function problemText(problem: WorkflowProblem, locale: string): string {
  return locale.toLowerCase().startsWith("fr") ? problem.message_fr : problem.message_en;
}

export function hasBlockOfKind(w: Workflow, kind: NodeKind): boolean {
  return w.nodes.some((n) => n.kind === kind);
}

/** What POST /api/workflows needs for a new workflow: a name and one trigger started by hand. */
export function newWorkflowInput(name: string, triggerId: string) {
  return { name: name.trim(), nodes: [{ id: triggerId, kind: "trigger" as const, x: 80, y: 120, data: { mode: "manual" as const } }], edges: [], annotations: [] };
}

export function newEditorId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** The first line a block shows (its instruction, question, message or note), for lists and search. */
export function nodeSummary(node: WorkflowNode): string {
  const text = node.kind === "ai" ? node.data.prompt
    : node.kind === "bot" ? node.data.instruction
    : node.kind === "condition" ? node.data.question
    : node.kind === "approval" ? node.data.message
    : node.kind === "send" ? node.data.text ?? ""
    : node.kind === "note" ? node.data.text : "";
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

/** Puts an Approval block in front of `nodeId`: the wires that reached it now reach the approval, whose Yes goes on to it. */
export function insertApprovalBefore(w: Workflow, nodeId: string, approvalId: string, edgeId: string): Workflow {
  const target = w.nodes.find((n) => n.id === nodeId);
  if (!target) return w;
  const approval = { id: approvalId, kind: "approval", x: target.x, y: target.y + NODE_HEIGHT[target.kind] + 80, data: { message: "" } } as WorkflowNode;
  const edges = w.edges.map((e) => (e.to.node === nodeId ? { ...e, to: { node: approvalId, port: "in" as const } } : e));
  return { ...w, nodes: [...w.nodes, approval], edges: [...edges, { id: edgeId, from: { node: approvalId, port: "yes" }, to: { node: nodeId, port: "in" } }] };
}

type ModelInstance = { instanceId: string; displayName: string; snapshot: { state: string }; models: { options: readonly { id: string; label: string }[] } };

/** The model choices of a block: every model of every AI that is set up, as "<instanceId>/<model>" (what the server reads). */
export function modelOptions(instances: readonly ModelInstance[]): { value: string; label: string; group: string }[] {
  return instances.filter((i) => i.snapshot.state === "available").flatMap((i) =>
    i.models.options.map((m) => ({ value: `${i.instanceId}/${m.id}`, label: m.label || m.id, group: i.displayName })));
}

export const READABLE_SCALE = 0.75;

/** The first view of a workflow: all of it when that stays readable, else its start at a readable size. */
export function openingView(rects: readonly Rect[], viewport: { w: number; h: number }, padding = 80): View {
  const fit = fitRects([...rects], viewport, padding);
  const bounds = boundsOf([...rects]);
  if (!bounds || fit.scale >= READABLE_SCALE) return fit;
  const scale = READABLE_SCALE;
  const tall = bounds.h * scale > viewport.h - 2 * padding;
  return { scale, x: padding - bounds.x * scale, y: tall ? padding - bounds.y * scale : (viewport.h - bounds.h * scale) / 2 - bounds.y * scale };
}
