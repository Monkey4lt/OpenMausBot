import type { RunStatus, Workflow } from "../../shared/workflows.ts";
import { PASS, type RouteContext, type RouteHandler } from "../routes/table.ts";
import { validateWorkflow, type Problem } from "./graph.ts";
import { WorkflowBusyError, WorkflowInvalidError, WorkflowNotFoundError, type WorkflowRunner } from "./runner.ts";
import { WorkflowConflictError, WorkflowInputError, type WorkflowStore } from "./store.ts";
import type { WorkflowRoutineLink, WorkflowRoutineState } from "./routine-link.ts";

export interface WorkflowSummary {
  id: string;
  name: string;
  projectId?: string;
  rev: number;
  updatedAt: number;
  lastRun?: { status: RunStatus; startedAt: number };
  /** Its routine's next run, when its trigger runs on a schedule. */
  nextRunAt?: number | null;
}

export interface WorkflowRouteDeps {
  store: WorkflowStore;
  botExists(id: string): boolean;
  /** Absent: the run routes answer 503. */
  runner?: WorkflowRunner;
  /** After a save or a delete; `rev` 0 means the workflow is gone. */
  onChanged?(id: string, rev: number): void;
  /** The routines engine: a scheduled trigger's routine follows each save. */
  routines?: Pick<WorkflowRoutineLink, "sync" | "remove" | "routineOf" | "automations">;
}

const MAX_BODY = 2_000_000;
const ID = /^[\w-]{1,64}$/;

/**
 * Owner only: none of these paths is in CLIENT_ALLOW (server/request-auth.ts).
 * GET    /api/workflows                    → { workflows: WorkflowSummary[] }
 * POST   /api/workflows {workflow}         → 200 { workflow, problems } | 400 { error, issues }
 * GET    /api/workflows/:id                → { workflow, problems } | 404
 * PUT    /api/workflows/:id {workflow, baseRev} → 200 { workflow, problems } | 409 { error, rev } | 400 { error, issues }
 * DELETE /api/workflows/:id?baseRev=       → { ok: true } | 404 | 409 { error, rev }; stops its run, its runs go with it
 * A draft with problems is saved and its problems returned; only running it is refused.
 * Save and GET answers also carry `routine: { id, enabled, nextRunAt } | null` (the routine a scheduled trigger made)
 * and, when the routines engine refused the schedule, `routineError` in plain words.
 * GET    /api/workflows/automations         → { automations: RoutineMiniWorkflow[] }: bot routines as Trigger → Bot, read only
 *
 * POST /api/workflows/:id/run {text?}            → { run } | 400 { error, problems } | 404 | 409 { error, runId }
 * POST /api/workflows/:id/run-step {nodeId}      → { run }: that block alone, on its input from the last run
 * POST /api/workflows/runs/:runId/retry {nodeId} → { run }: a new run, that block and everything after it again
 * POST /api/workflows/runs/:runId/cancel         → { ok: true } | 404 when the run is not going on
 * GET  /api/workflows/:id/runs                   → { runs } newest first
 * GET  /api/workflows/runs/:runId                → { run } | 404
 * Runs move on as `{ kind: "workflow-run", run }` frames.
 */
export function createWorkflowRoutes(deps: WorkflowRouteDeps): RouteHandler {
  const { store } = deps;
  const problemsOf = (w: Workflow): Problem[] => validateWorkflow(w, { botExists: deps.botExists });

  const summaries = (): WorkflowSummary[] => {
    const last = new Map<string, { status: RunStatus; startedAt: number }>();
    for (const run of store.listRuns()) if (!last.has(run.workflowId)) last.set(run.workflowId, { status: run.status, startedAt: run.startedAt });
    return store.list().map((w) => {
      const routine = deps.routines?.routineOf(w.id);
      return {
        id: w.id, name: w.name, ...(w.projectId ? { projectId: w.projectId } : {}), rev: w.rev, updatedAt: w.updatedAt,
        ...(last.has(w.id) ? { lastRun: last.get(w.id)! } : {}),
        ...(routine ? { nextRunAt: routine.nextRunAt } : {}),
      };
    });
  };

  const save = (ctx: RouteContext, input: unknown, baseRev: number) => {
    try {
      const workflow = store.save(input, baseRev);
      deps.onChanged?.(workflow.id, workflow.rev);
      return ctx.json(ctx.res, 200, { workflow, problems: problemsOf(workflow), ...syncRoutine(workflow) });
    } catch (error) {
      if (error instanceof WorkflowConflictError) return ctx.json(ctx.res, 409, { error: "This workflow changed elsewhere", rev: error.rev });
      if (error instanceof WorkflowInputError) return ctx.json(ctx.res, 400, { error: "Invalid workflow", issues: error.issues });
      throw error;
    }
  };

  const syncRoutine = (workflow: Workflow): { routine?: WorkflowRoutineState | null; routineError?: string } => {
    if (!deps.routines) return {};
    try {
      return deps.routines.sync(workflow);
    } catch (error) {
      console.error("workflows: could not update a workflow's routine", error);
      return { routine: deps.routines.routineOf(workflow.id), routineError: error instanceof Error ? error.message : String(error) };
    }
  };

  /** Answers the runner's refusals; anything else is thrown on. */
  const runAnswer = (ctx: RouteContext, act: () => unknown) => {
    if (!deps.runner) return ctx.json(ctx.res, 503, { error: "Workflows cannot run here" });
    try {
      return ctx.json(ctx.res, 200, { run: act() });
    } catch (error) {
      if (error instanceof WorkflowInvalidError) return ctx.json(ctx.res, 400, { error: error.message, problems: error.problems });
      if (error instanceof WorkflowBusyError) return ctx.json(ctx.res, 409, { error: error.message, runId: error.runId });
      if (error instanceof WorkflowNotFoundError) return ctx.json(ctx.res, 404, { error: error.message });
      throw error;
    }
  };

  const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
  const validRev = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
  const readObject = async (ctx: RouteContext): Promise<Record<string, unknown>> => {
    const body = await ctx.readBody(ctx.req, MAX_BODY).catch(() => null);
    return isObject(body) ? body : {};
  };
  const nodeIdOf = (body: Record<string, unknown>) => (typeof body.nodeId === "string" && ID.test(body.nodeId) ? body.nodeId : null);

  return async (ctx) => {
    const { path, method, req, res, json, readBody } = ctx;
    if (path === "/api/workflows/automations") {
      if (method !== "GET") return PASS;
      return json(res, 200, { automations: deps.routines?.automations() ?? [] });
    }
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

    const runPath = /^\/api\/workflows\/runs\/([\w-]{1,64})(?:\/(retry|cancel))?$/.exec(path);
    if (runPath) {
      const [, runId, action] = runPath as unknown as [string, string, "retry" | "cancel" | undefined];
      if (!action && method === "GET") {
        const run = store.getRun(runId);
        return run ? json(res, 200, { run }) : json(res, 404, { error: "Unknown run" });
      }
      if (action === "cancel" && method === "POST") {
        if (!deps.runner) return json(res, 503, { error: "Workflows cannot run here" });
        return deps.runner.cancel(runId) ? json(res, 200, { ok: true }) : json(res, 404, { error: "This run is not going on" });
      }
      if (action === "retry" && method === "POST") {
        const nodeId = nodeIdOf(await readObject(ctx));
        if (!nodeId) return json(res, 400, { error: "Expected { nodeId }" });
        return runAnswer(ctx, () => deps.runner!.retryFrom(runId, nodeId));
      }
      return PASS;
    }

    const workflowPath = /^\/api\/workflows\/([\w-]{1,64})(?:\/(run|run-step|runs))?$/.exec(path);
    if (!workflowPath) return PASS;
    const [, id, action] = workflowPath as unknown as [string, string, "run" | "run-step" | "runs" | undefined];
    if (action === "runs" && method === "GET") {
      if (!store.get(id)) return json(res, 404, { error: "Unknown workflow" });
      return json(res, 200, { runs: store.listRuns(id) });
    }
    if (action === "run" && method === "POST") {
      const body = await readObject(ctx);
      const text = typeof body.text === "string" ? body.text : undefined;
      return runAnswer(ctx, () => deps.runner!.start(id, { source: "manual", ...(text !== undefined ? { text } : {}) }));
    }
    if (action === "run-step" && method === "POST") {
      const nodeId = nodeIdOf(await readObject(ctx));
      if (!nodeId) return json(res, 400, { error: "Expected { nodeId }" });
      return runAnswer(ctx, () => deps.runner!.runStep(id, nodeId));
    }
    if (action) return PASS;

    if (method === "GET") {
      const workflow = store.get(id);
      if (!workflow) return json(res, 404, { error: "Unknown workflow" });
      return json(res, 200, { workflow, problems: problemsOf(workflow), ...(deps.routines ? { routine: deps.routines.routineOf(id) } : {}) });
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
      const existing = store.get(id);
      if (!existing) return json(res, 404, { error: "Unknown workflow" });
      if (baseRev !== undefined && baseRev !== existing.rev) return json(res, 409, { error: "This workflow changed elsewhere", rev: existing.rev });
      for (const runId of deps.runner?.active() ?? []) if (store.getRun(runId)?.workflowId === id) deps.runner!.cancel(runId);
      try {
        if (!store.delete(id, baseRev)) return json(res, 404, { error: "Unknown workflow" });
      } catch (error) {
        if (error instanceof WorkflowConflictError) return json(res, 409, { error: "This workflow changed elsewhere", rev: error.rev });
        throw error;
      }
      store.deleteRuns(id);
      try { deps.routines?.remove(id); } catch (error) { console.error("workflows: could not remove a workflow's routine", error); }
      deps.onChanged?.(id, 0);
      return json(res, 200, { ok: true });
    }
    return PASS;
  };
}
