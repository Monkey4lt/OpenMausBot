import type { RunStatus, Workflow } from "../../shared/workflows.ts";
import { PASS, type RouteContext, type RouteHandler } from "../routes/table.ts";
import { validateWorkflow, type Problem } from "./graph.ts";
import { WorkflowConflictError, WorkflowInputError, type WorkflowStore } from "./store.ts";

export interface WorkflowSummary {
  id: string;
  name: string;
  projectId?: string;
  rev: number;
  updatedAt: number;
  lastRun?: { status: RunStatus; startedAt: number };
}

export interface WorkflowRouteDeps {
  store: WorkflowStore;
  botExists(id: string): boolean;
  /** After a save or a delete; `rev` 0 means the workflow is gone. */
  onChanged?(id: string, rev: number): void;
}

const MAX_BODY = 2_000_000;
const ID = /^[\w-]{1,64}$/;

/**
 * Owner only: none of these paths is in CLIENT_ALLOW (server/request-auth.ts).
 * GET    /api/workflows                    → { workflows: WorkflowSummary[] }
 * POST   /api/workflows {workflow}         → 200 { workflow, problems } | 400 { error, issues }
 * GET    /api/workflows/:id                → { workflow, problems } | 404
 * PUT    /api/workflows/:id {workflow, baseRev} → 200 { workflow, problems } | 409 { error, rev } | 400 { error, issues }
 * DELETE /api/workflows/:id?baseRev=       → { ok: true } | 404 | 409 { error, rev }; its runs go with it
 * A draft with problems is saved and its problems returned; only running it is refused.
 */
export function createWorkflowRoutes(deps: WorkflowRouteDeps): RouteHandler {
  const { store } = deps;
  const problemsOf = (w: Workflow): Problem[] => validateWorkflow(w, { botExists: deps.botExists });

  const summaries = (): WorkflowSummary[] => {
    const last = new Map<string, { status: RunStatus; startedAt: number }>();
    for (const run of store.listRuns()) if (!last.has(run.workflowId)) last.set(run.workflowId, { status: run.status, startedAt: run.startedAt });
    return store.list().map((w) => ({
      id: w.id, name: w.name, ...(w.projectId ? { projectId: w.projectId } : {}), rev: w.rev, updatedAt: w.updatedAt,
      ...(last.has(w.id) ? { lastRun: last.get(w.id)! } : {}),
    }));
  };

  const save = (ctx: RouteContext, input: unknown, baseRev: number) => {
    try {
      const workflow = store.save(input, baseRev);
      deps.onChanged?.(workflow.id, workflow.rev);
      return ctx.json(ctx.res, 200, { workflow, problems: problemsOf(workflow) });
    } catch (error) {
      if (error instanceof WorkflowConflictError) return ctx.json(ctx.res, 409, { error: "This workflow changed elsewhere", rev: error.rev });
      if (error instanceof WorkflowInputError) return ctx.json(ctx.res, 400, { error: "Invalid workflow", issues: error.issues });
      throw error;
    }
  };

  const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
  const validRev = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

  return async (ctx) => {
    const { path, method, req, res, json, readBody } = ctx;
    if (path === "/api/workflows") {
      if (method === "GET") return json(res, 200, { workflows: summaries() });
      if (method === "POST") {
        const body = await readBody(req, MAX_BODY).catch(() => null) as { workflow?: unknown } | null;
        if (!isObject(body?.workflow)) return json(res, 400, { error: "Invalid workflow", issues: ["workflow: expected an object"] });
        const { id: _ignored, ...rest } = body.workflow;
        return save(ctx, rest, 0);
      }
      return PASS;
    }
    const match = /^\/api\/workflows\/([^/]+)$/.exec(path);
    if (!match || !ID.test(match[1]!)) return PASS;
    const id = match[1]!;
    if (method === "GET") {
      const workflow = store.get(id);
      if (!workflow) return json(res, 404, { error: "Unknown workflow" });
      return json(res, 200, { workflow, problems: problemsOf(workflow) });
    }
    if (method === "PUT") {
      const body = await readBody(req, MAX_BODY).catch(() => null) as { workflow?: unknown; baseRev?: unknown } | null;
      if (!isObject(body?.workflow) || !validRev(body.baseRev)) return json(res, 400, { error: "Invalid workflow", issues: ["expected { workflow, baseRev }"] });
      return save(ctx, { ...body.workflow, id }, body.baseRev);
    }
    if (method === "DELETE") {
      const raw = ctx.url.searchParams.get("baseRev");
      const baseRev = raw === null || raw === "" ? undefined : Number(raw);
      if (baseRev !== undefined && !validRev(baseRev)) return json(res, 400, { error: "Invalid baseRev" });
      try {
        if (!store.delete(id, baseRev)) return json(res, 404, { error: "Unknown workflow" });
      } catch (error) {
        if (error instanceof WorkflowConflictError) return json(res, 409, { error: "This workflow changed elsewhere", rev: error.rev });
        throw error;
      }
      store.deleteRuns(id);
      deps.onChanged?.(id, 0);
      return json(res, 200, { ok: true });
    }
    return PASS;
  };
}
