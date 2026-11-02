// Runs a workflow one block at a time in wire order, keeping each step in workflow-runs.json as it goes. Limits are
// checked before every step: the run's step count, its known cost (an unknown cost is never counted as zero, and never
// added), and the app's own spend limit. Everything outside this file comes in through the deps.
import { randomUUID } from "node:crypto";

import { cut, MAX_IO_CHARS, type OutputPort, type StepRun, type Workflow, type WorkflowRun } from "../../shared/workflows.ts";
import { serverLine, type ServerLineKey } from "../server-lines.ts";
import { downstreamOf, edgesInto, topoOrder, validateWorkflow, type Problem } from "./graph.ts";
import { runStep, StepError, type Cost, type StepDeps } from "./steps.ts";
import type { WorkflowStore } from "./store.ts";

export type TriggerSource = "manual" | "schedule" | "ai-reset";

export interface WorkflowTrigger {
  source: TriggerSource;
  /** What the Trigger block hands on. */
  text?: string;
  routineRunId?: string;
}

export interface WorkflowRunnerDeps {
  store: WorkflowStore;
  steps: StepDeps;
  botExists(id: string): boolean;
  /** False once the app's monthly spend limit is reached. */
  budgetAllows(): boolean;
  /** The language of the reasons a run writes; undefined reads as English. */
  language?(): string | undefined;
  now?(): number;
  newId?(): string;
  onRunChanged?(run: WorkflowRun): void;
  /** Once per run that ends failed (never for a cancelled one); `step` is the step that failed or was stopped. */
  onRunFailed?(run: WorkflowRun, step: StepRun | null, workflow: Workflow, trigger: WorkflowTrigger): void;
}

export class WorkflowNotFoundError extends Error {
  readonly status = 404;
  constructor(what: string) {
    super(`Unknown ${what}`);
    this.name = "WorkflowNotFoundError";
  }
}

/** The workflow has problems; nothing was run. */
export class WorkflowInvalidError extends Error {
  readonly status = 400;
  readonly problems: Problem[];
  constructor(problems: Problem[]) {
    super("This workflow has problems to fix before it can run");
    this.name = "WorkflowInvalidError";
    this.problems = problems;
  }
}

/** The workflow is already running; `runId` is that run. */
export class WorkflowBusyError extends Error {
  readonly status = 409;
  readonly runId: string;
  constructor(runId: string) {
    super("This workflow is already running");
    this.name = "WorkflowBusyError";
    this.runId = runId;
  }
}

export interface WorkflowRunner {
  /** Starts a run of the whole workflow; returns it running. */
  start(workflowId: string, trigger: WorkflowTrigger): WorkflowRun;
  /** Runs one block alone, on the input it had in the workflow's last run that reached it. */
  runStep(workflowId: string, nodeId: string): WorkflowRun;
  /** A new run that keeps `runId`'s steps and runs `nodeId` and everything downstream of it again. */
  retryFrom(runId: string, nodeId: string): WorkflowRun;
  /** False when the run is not running here. */
  cancel(runId: string): boolean;
  /** Ids of the runs going on now. */
  active(): string[];
  /** The run once it has ended (at once for a run that is not going on). */
  settled(runId: string): Promise<WorkflowRun>;
}

interface Active {
  run: WorkflowRun;
  workflow: Workflow;
  trigger: WorkflowTrigger;
  controller: AbortController;
  /** Full text each step produced; the run keeps only MAX_IO_CHARS of it. */
  outputs: Map<string, string>;
  /** Only this block runs, on this input. */
  single?: { nodeId: string; input: string };
  ended: Promise<WorkflowRun>;
  end: (run: WorkflowRun) => void;
  done: boolean;
}

const SEPARATOR = "\n\n";

export function createWorkflowRunner(deps: WorkflowRunnerDeps): WorkflowRunner {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const byWorkflow = new Map<string, Active>();
  const byRun = new Map<string, Active>();
  const line = (key: ServerLineKey, params?: Record<string, string | number>) => serverLine(deps.language?.(), key, params);

  const save = (state: Active) => {
    try {
      store.saveRun(state.run);
    } catch (error) {
      console.error("workflows: could not save a run", error instanceof Error ? error.message : error);
    }
    deps.onRunChanged?.(structuredClone(state.run));
  };

  const stepOf = (state: Active, nodeId: string) => state.run.steps.find((s) => s.nodeId === nodeId);

  const workflowOf = (id: string): Workflow => {
    const workflow = store.get(id);
    if (!workflow) throw new WorkflowNotFoundError("workflow");
    return workflow;
  };

  const assertFree = (workflowId: string) => {
    const busy = byWorkflow.get(workflowId);
    if (busy) throw new WorkflowBusyError(busy.run.id);
  };

  const assertValid = (workflow: Workflow, only?: string) => {
    const problems = validateWorkflow(workflow, { botExists: deps.botExists }).filter((p) => only === undefined || p.nodeId === only);
    if (problems.length) throw new WorkflowInvalidError(problems);
  };

  function finish(state: Active, status: WorkflowRun["status"], reason?: string, failedStep?: StepRun | null) {
    if (state.done) return;
    state.done = true;
    const at = now();
    state.run.status = status;
    state.run.endedAt = at;
    if (reason) state.run.reason = cut(reason, 2000);
    for (const step of state.run.steps) {
      if (step.status === "pending") step.status = "skipped";
    }
    byWorkflow.delete(state.workflow.id);
    byRun.delete(state.run.id);
    save(state);
    const ended = structuredClone(state.run);
    state.end(ended);
    if (status === "failed") {
      try {
        deps.onRunFailed?.(ended, failedStep ? structuredClone(failedStep) : null, state.workflow, state.trigger);
      } catch (error) {
        console.error("workflows: could not tell about a failed run", error);
      }
    }
  }

  /** The text each taken wire brings into `nodeId`, joined in wire order; null when no wire into it was taken. */
  function inputOf(state: Active, nodeId: string): string | null {
    const taken = edgesInto(state.workflow, nodeId).filter((edge) => {
      const from = stepOf(state, edge.from.node);
      return from?.status === "succeeded" && from.port === edge.from.port;
    });
    if (!taken.length) return null;
    return taken.map((edge) => state.outputs.get(edge.from.node) ?? stepOf(state, edge.from.node)?.output ?? "").join(SEPARATOR);
  }

  /** Why the next step may not run, or null. */
  function limitReached(state: Active, executed: number, knownCost: number): string | null {
    const { maxSteps, maxCostUsd } = state.workflow.limits;
    if (executed >= maxSteps) return line("server.workflow.maxSteps", { count: maxSteps });
    if (knownCost > maxCostUsd) return line("server.workflow.maxCost", { amount: String(maxCostUsd) });
    if (!deps.budgetAllows()) return line("server.workflow.budget");
    return null;
  }

  async function execute(state: Active) {
    const { workflow, controller } = state;
    const nodes = new Map(workflow.nodes.map((n) => [n.id, n]));
    let executed = 0;
    let knownCost = 0;
    const order = state.single ? [state.single.nodeId] : topoOrder(workflow);
    for (const nodeId of order) {
      if (state.done) return;
      const step = stepOf(state, nodeId);
      const node = nodes.get(nodeId);
      if (!step || !node || step.status !== "pending") continue;
      const input = state.single ? state.single.input : node.kind === "trigger" ? state.trigger.text ?? "" : inputOf(state, nodeId);
      if (input === null) {
        step.status = "skipped";
        save(state);
        continue;
      }
      const stop = limitReached(state, executed, knownCost);
      if (stop) return finish(state, "failed", stop, step);

      step.status = "running";
      step.input = cut(input, MAX_IO_CHARS);
      step.startedAt = now();
      save(state);
      let result: { port: OutputPort | null; output: string; costUsd: Cost };
      try {
        const stopped = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(controller.signal.reason);
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
        });
        stopped.catch(() => {});
        result = await Promise.race([
          runStep(node, input, deps.steps, { runId: state.run.id, workflowName: workflow.name, signal: controller.signal, language: deps.language?.() }),
          stopped,
        ]);
      } catch (error) {
        if (state.done) return;
        step.status = "failed";
        step.endedAt = now();
        step.error = cut(error instanceof Error ? error.message : String(error), 2000);
        step.costUsd = error instanceof StepError ? error.costUsd : null;
        return finish(state, "failed", step.error, step);
      }
      if (state.done) return;
      executed += 1;
      if (result.costUsd !== null) knownCost += result.costUsd;
      step.status = "succeeded";
      step.endedAt = now();
      step.output = cut(result.output, MAX_IO_CHARS);
      step.costUsd = result.costUsd;
      if (result.port) step.port = result.port;
      state.outputs.set(nodeId, result.output);
      save(state);
    }
    finish(state, "succeeded");
  }

  function launch(workflow: Workflow, trigger: WorkflowTrigger, steps: StepRun[], seed: Map<string, string>, single?: Active["single"]): WorkflowRun {
    let end!: (run: WorkflowRun) => void;
    const ended = new Promise<WorkflowRun>((resolve) => { end = resolve; });
    const state: Active = {
      run: { id: newId(), workflowId: workflow.id, status: "running", steps, startedAt: now() },
      workflow, trigger, controller: new AbortController(), outputs: seed, ended, end, done: false,
      ...(single ? { single } : {}),
    };
    store.saveRun(state.run);
    byWorkflow.set(workflow.id, state);
    byRun.set(state.run.id, state);
    deps.onRunChanged?.(structuredClone(state.run));
    void execute(state).catch((error: unknown) => {
      console.error("workflows: a run stopped on an error", error);
      finish(state, "failed", error instanceof Error ? error.message : String(error));
    });
    return structuredClone(state.run);
  }

  const freshSteps = (workflow: Workflow): StepRun[] => topoOrder(workflow).map((nodeId) => ({ nodeId, status: "pending" as const }));

  return {
    start(workflowId, trigger) {
      const workflow = workflowOf(workflowId);
      assertFree(workflowId);
      assertValid(workflow);
      return launch(workflow, trigger, freshSteps(workflow), new Map());
    },

    runStep(workflowId, nodeId) {
      const workflow = workflowOf(workflowId);
      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node || node.kind === "note") throw new WorkflowNotFoundError("step");
      assertFree(workflowId);
      assertValid(workflow, nodeId);
      const last = store.listRuns(workflowId)
        .map((run) => run.steps.find((s) => s.nodeId === nodeId))
        .find((s) => s?.input !== undefined);
      return launch(workflow, { source: "manual" }, [{ nodeId, status: "pending" }], new Map(), { nodeId, input: last?.input ?? "" });
    },

    retryFrom(runId, nodeId) {
      const previous = store.getRun(runId);
      if (!previous) throw new WorkflowNotFoundError("run");
      const workflow = workflowOf(previous.workflowId);
      if (!workflow.nodes.some((n) => n.id === nodeId && n.kind !== "note")) throw new WorkflowNotFoundError("step");
      assertFree(workflow.id);
      assertValid(workflow);
      const again = downstreamOf(workflow, nodeId).add(nodeId);
      const kept = new Map(previous.steps.map((s) => [s.nodeId, s]));
      const steps = freshSteps(workflow).map((fresh): StepRun => {
        if (again.has(fresh.nodeId)) return fresh;
        const old = kept.get(fresh.nodeId);
        return old && old.status !== "running" && old.status !== "pending" ? structuredClone(old) : { nodeId: fresh.nodeId, status: "skipped" };
      });
      const triggerStep = workflow.nodes.find((n) => n.kind === "trigger");
      const triggerText = triggerStep ? kept.get(triggerStep.id)?.input : undefined;
      return launch(workflow, { source: "manual", ...(triggerText !== undefined ? { text: triggerText } : {}) }, steps, new Map());
    },

    cancel(runId) {
      const state = byRun.get(runId);
      if (!state || state.done) return false;
      const stopped = line("server.workflow.stopped");
      state.controller.abort(new Error(stopped));
      const at = now();
      for (const step of state.run.steps) {
        if (step.status !== "running") continue;
        step.status = "failed";
        step.error = stopped;
        step.costUsd = null;
        step.endedAt = at;
      }
      finish(state, "cancelled", stopped);
      return true;
    },

    active: () => [...byRun.keys()],

    settled(runId) {
      const state = byRun.get(runId);
      if (state) return state.ended;
      const run = store.getRun(runId);
      return run ? Promise.resolve(run) : Promise.reject(new WorkflowNotFoundError("run"));
    },
  };
}
