// The workflow pieces of the server, built from what server/index.ts already has.
import { serverLine } from "../server-lines.ts";
import { createWorkflowRoutes } from "./routes.ts";
import { createWorkflowStore } from "./store.ts";

export interface WorkflowHostDeps {
  dataDir: string;
  language(): string | undefined;
  botExists(id: string): boolean;
  broadcast(payload: Record<string, unknown>, options?: { adminOnly?: boolean }): void;
}

export function createWorkflowHost(deps: WorkflowHostDeps) {
  const store = createWorkflowStore(deps.dataDir);
  try {
    store.failInterruptedRuns(serverLine(deps.language(), "server.workflow.restart"));
  } catch (error) {
    console.error("workflows: could not close the runs a restart cut", error);
  }
  const routes = createWorkflowRoutes({
    store,
    botExists: deps.botExists,
    onChanged: (id, rev) => deps.broadcast({ kind: "workflow", id, rev }, { adminOnly: true }),
  });
  return { store, routes };
}
