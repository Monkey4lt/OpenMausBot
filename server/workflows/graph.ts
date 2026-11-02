// Pure checks and walks over a workflow's blocks and wires. Problems are written for someone outside tech, in French
// and English; the editor shows them on the block or wire they name, and nothing invalid is run.
import { NODE_PORTS, type NodeKind, type OutputPort, type Workflow, type WorkflowEdge, type WorkflowNode } from "../../shared/workflows.ts";

export type ProblemCode =
  | "missing-setting" | "unknown-bot" | "edge-to-note" | "edge-from-note" | "cycle" | "two-triggers"
  | "no-trigger" | "bad-port" | "dangling-edge" | "duplicate-edge" | "self-loop";

export interface Problem {
  nodeId?: string;
  edgeId?: string;
  code: ProblemCode;
  message_fr: string;
  message_en: string;
}

export interface GraphContext {
  botExists(id: string): boolean;
}

export const KIND_NAME: Record<NodeKind, { fr: string; en: string }> = {
  trigger: { fr: "Déclencheur", en: "Trigger" },
  ai: { fr: "IA", en: "AI" },
  bot: { fr: "Bot", en: "Bot" },
  condition: { fr: "Condition", en: "Condition" },
  approval: { fr: "Approbation", en: "Approval" },
  send: { fr: "Envoyer", en: "Send" },
  note: { fr: "Note", en: "Note" },
};

const blank = (value: string | undefined) => !value || !value.trim();

/** What each kind of block must have filled in before it can run, as [French, English] sentences. */
function missingSettings(node: WorkflowNode): [string, string][] {
  const out: [string, string][] = [];
  switch (node.kind) {
    case "trigger": {
      if (node.data.mode !== "schedule") break;
      const s = node.data.schedule;
      if (!s) { out.push(["Choisis quand ce déclencheur doit se lancer.", "Choose when this trigger should start."]); break; }
      const needsTime = s.kind === "once" || s.kind === "daily" || s.kind === "weekdays";
      if (needsTime && !s.at) out.push(["Indique l'heure de lancement.", "Set the start time."]);
      if (s.kind === "once" && !s.date) out.push(["Indique le jour de lancement.", "Set the start day."]);
      if (s.kind === "weekdays" && !s.days?.length) out.push(["Choisis au moins un jour de la semaine.", "Pick at least one day of the week."]);
      if (s.kind === "interval" && !s.everyMinutes) out.push(["Indique tous les combien de minutes le lancer.", "Set how many minutes between runs."]);
      break;
    }
    case "ai":
      if (blank(node.data.prompt)) out.push(["Écris la consigne pour l'IA.", "Write the instruction for the AI."]);
      break;
    case "bot":
      if (blank(node.data.instruction)) out.push(["Écris ce que le bot doit faire.", "Write what the bot should do."]);
      if (blank(node.data.botId)) out.push(["Choisis le bot qui doit le faire.", "Choose the bot that should do it."]);
      break;
    case "condition":
      if (blank(node.data.question)) out.push(["Écris la question à laquelle répondre par oui ou non.", "Write the yes-or-no question."]);
      break;
    case "approval":
      if (blank(node.data.message)) out.push(["Écris le message à afficher avant de demander ton accord.", "Write the message shown when asking for your approval."]);
      break;
    case "send":
      if (node.data.to === "bot-chat" && blank(node.data.botId)) out.push(["Choisis dans la discussion de quel bot envoyer le message.", "Choose which bot's chat to send to."]);
      break;
    case "note":
      break;
  }
  return out;
}

type EdgeVerdict = { ok: true } | { ok: false; code: ProblemCode; fr: string; en: string };

/** Judges each wire on its own (duplicates against the wires before it); usable wires are the ones that pass. */
function judgeEdges(w: Workflow): Map<string, EdgeVerdict> {
  const byId = new Map(w.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const verdicts = new Map<string, EdgeVerdict>();
  for (const edge of w.edges) {
    const from = byId.get(edge.from.node), to = byId.get(edge.to.node);
    let verdict: EdgeVerdict = { ok: true };
    if (!from || !to) {
      verdict = { ok: false, code: "dangling-edge", fr: "Ce fil mène à un bloc qui n'existe plus. Supprime-le.", en: "This wire leads to a block that no longer exists. Delete it." };
    } else if (from.id === to.id) {
      verdict = { ok: false, code: "self-loop", fr: "Un bloc ne peut pas être relié à lui-même.", en: "A block cannot be wired to itself." };
    } else if (to.kind === "note") {
      verdict = { ok: false, code: "edge-to-note", fr: "Une note ne reçoit rien : ce fil ne peut pas y arriver.", en: "A note takes nothing in: this wire cannot end on it." };
    } else if (from.kind === "note") {
      verdict = { ok: false, code: "edge-from-note", fr: "Une note ne fait rien : aucun fil ne peut en partir.", en: "A note does nothing: no wire can start from it." };
    } else if (!NODE_PORTS[from.kind].outputs.includes(edge.from.port) || !NODE_PORTS[to.kind].inputs.includes(edge.to.port)) {
      verdict = {
        ok: false, code: "bad-port",
        fr: `Ce fil n'est pas branché au bon endroit (de « ${KIND_NAME[from.kind].fr} » vers « ${KIND_NAME[to.kind].fr} »).`,
        en: `This wire is not plugged into the right place (from "${KIND_NAME[from.kind].en}" to "${KIND_NAME[to.kind].en}").`,
      };
    } else {
      const key = `${edge.from.node}\u0000${edge.from.port}\u0000${edge.to.node}\u0000${edge.to.port}`;
      if (seen.has(key)) verdict = { ok: false, code: "duplicate-edge", fr: "Ces deux blocs sont déjà reliés par ce fil.", en: "These two blocks are already wired this way." };
      seen.add(key);
    }
    verdicts.set(edge.id, verdict);
  }
  return verdicts;
}

function usableEdges(w: Workflow): WorkflowEdge[] {
  const verdicts = judgeEdges(w);
  return w.edges.filter((edge) => verdicts.get(edge.id)?.ok);
}

export function validateWorkflow(w: Workflow, ctx: GraphContext): Problem[] {
  const problems: Problem[] = [];
  const triggers = w.nodes.filter((n) => n.kind === "trigger");
  if (!triggers.length) {
    problems.push({ code: "no-trigger", message_fr: "Ajoute un bloc Déclencheur : c'est lui qui lance le workflow.", message_en: "Add a Trigger block: it is what starts the workflow." });
  }
  for (const extra of triggers.slice(1)) {
    problems.push({ nodeId: extra.id, code: "two-triggers", message_fr: "Un workflow n'a qu'un seul déclencheur. Supprime celui-ci ou fais-en un autre workflow.", message_en: "A workflow has only one trigger. Delete this one or make it a separate workflow." });
  }
  for (const node of w.nodes) {
    for (const [fr, en] of missingSettings(node)) {
      problems.push({ nodeId: node.id, code: "missing-setting", message_fr: `${KIND_NAME[node.kind].fr} : ${fr}`, message_en: `${KIND_NAME[node.kind].en}: ${en}` });
    }
    const botId = node.kind === "bot" ? node.data.botId : node.kind === "send" && node.data.to === "bot-chat" ? node.data.botId : undefined;
    if (!blank(botId) && !ctx.botExists(botId!)) {
      problems.push({ nodeId: node.id, code: "unknown-bot", message_fr: "Le bot choisi est introuvable (supprimé ?). Choisis-en un autre.", message_en: "The chosen bot cannot be found (deleted?). Choose another one." });
    }
  }
  const verdicts = judgeEdges(w);
  for (const edge of w.edges) {
    const verdict = verdicts.get(edge.id)!;
    if (!verdict.ok) problems.push({ edgeId: edge.id, code: verdict.code, message_fr: verdict.fr, message_en: verdict.en });
  }
  for (const back of backEdges(w, w.edges.filter((edge) => verdicts.get(edge.id)?.ok))) {
    problems.push({
      edgeId: back.id, nodeId: back.to.node, code: "cycle",
      message_fr: "Ce fil fait revenir le workflow en arrière, ce qui le ferait tourner en rond. Supprime-le.",
      message_en: "This wire sends the workflow back to an earlier block, so it would go round in circles. Delete it.",
    });
  }
  return problems;
}

/** Wires that close a loop, found by a depth-first walk in block order. */
function backEdges(w: Workflow, edges: WorkflowEdge[]): WorkflowEdge[] {
  const out = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) out.set(edge.from.node, [...(out.get(edge.from.node) ?? []), edge]);
  const state = new Map<string, 1 | 2>(); // 1: on the current path, 2: done
  const found: WorkflowEdge[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const edge of out.get(id) ?? []) {
      const next = state.get(edge.to.node);
      if (next === 1) found.push(edge);
      else if (next === undefined) visit(edge.to.node);
    }
    state.set(id, 2);
  };
  for (const node of w.nodes) if (!state.has(node.id)) visit(node.id);
  return found;
}

/** Blocks in run order (each after every block wired into it), ties kept in the blocks' own order. Notes and blocks
 * caught in a loop are left out. */
export function topoOrder(w: Workflow): string[] {
  const ids = w.nodes.filter((n) => n.kind !== "note").map((n) => n.id);
  const edges = usableEdges(w);
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) indegree.set(edge.to.node, (indegree.get(edge.to.node) ?? 0) + 1);
  const order: string[] = [];
  const placed = new Set<string>();
  for (;;) {
    const next = ids.find((id) => !placed.has(id) && indegree.get(id) === 0);
    if (next === undefined) return order;
    placed.add(next);
    order.push(next);
    for (const edge of edges) if (edge.from.node === next) indegree.set(edge.to.node, indegree.get(edge.to.node)! - 1);
  }
}

/** Every block reachable from `nodeId` along usable wires, the block itself excluded. */
export function downstreamOf(w: Workflow, nodeId: string): Set<string> {
  const edges = usableEdges(w);
  const found = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.from.node !== id || edge.to.node === nodeId || found.has(edge.to.node)) continue;
      found.add(edge.to.node);
      queue.push(edge.to.node);
    }
  }
  return found;
}

/** The blocks wired to `port` of `nodeId`, in wire order, each once. */
export function nextNodes(w: Workflow, nodeId: string, port: OutputPort): string[] {
  const out: string[] = [];
  for (const edge of usableEdges(w)) {
    if (edge.from.node === nodeId && edge.from.port === port && !out.includes(edge.to.node)) out.push(edge.to.node);
  }
  return out;
}

/** The usable wires that end on `nodeId`, in wire order: where a block's input text comes from. */
export function edgesInto(w: Workflow, nodeId: string): WorkflowEdge[] {
  return usableEdges(w).filter((edge) => edge.to.node === nodeId);
}
