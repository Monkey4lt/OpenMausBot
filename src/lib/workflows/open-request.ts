import { WORKFLOW_ROUTINE_BOT } from "../../../shared/routines";

let pending: string | null = null;
const listeners = new Set<(id: string) => void>();

/** The workflow a routine starts (target "workflow"), or null for any other routine. */
export function workflowOfRoutine(routine: { target?: string; workflowId?: unknown; botId?: string } | null | undefined): string | null {
  if (!routine || routine.target !== "workflow") return null;
  return typeof routine.workflowId === "string" && routine.workflowId ? routine.workflowId : null;
}

export function isWorkflowRoutineBot(botId: string | undefined): boolean {
  return botId === WORKFLOW_ROUTINE_BOT;
}

/** Asks the Atelier to open a workflow: the one on screen hears it now, one opened later takes it on mount. */
export function requestOpenWorkflow(id: string): void {
  pending = id;
  for (const listener of listeners) listener(id);
}

export function takeOpenWorkflowRequest(): string | null {
  const id = pending;
  pending = null;
  return id;
}

export function onOpenWorkflowRequest(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
