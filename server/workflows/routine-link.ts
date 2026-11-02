// Workflows and the routines engine (server/routines.ts). The Trigger block is the source of truth: saving a workflow
// whose trigger runs on a schedule creates or updates its own routine (target "workflow"), a manual trigger removes it,
// and the routines engine then schedules, catches up and lists those runs as it does every routine. The other way,
// RoutineManager starts a workflow through `workflowState` / `startWorkflow` / `stopWorkflow` and hears back through
// `finishWorkflowRun`. Bot routines show in the Atelier as read-only mini-workflows (Trigger → Bot).
import { WORKFLOW_ROUTINE_BOT } from "../../shared/routines.ts";
import type { NodeData, Workflow, WorkflowEdge, WorkflowNode, WorkflowSchedule } from "../../shared/workflows.ts";
import type { Routine, RoutineInput, RoutineManager, RoutineRun, RoutineScheduleInput, RoutineWorkflowStatus } from "../routines.ts";
import { WorkflowBusyError, WorkflowInvalidError, type TriggerSource, type WorkflowRunner } from "./runner.ts";
import type { WorkflowStore } from "./store.ts";

/** What the link needs of RoutineManager. */
export type WorkflowRoutines = Pick<RoutineManager, "listRoutines" | "create" | "update" | "remove" | "finishWorkflowRun">;

/** A workflow's routine as the editor shows it ("Prochaine exécution"). */
export interface WorkflowRoutineState {
  id: string;
  enabled: boolean;
  nextRunAt: number | null;
}

export interface WorkflowRoutineSync {
  /** null: the workflow has no routine (manual trigger, or its schedule is not filled in). */
  routine: WorkflowRoutineState | null;
  /** In plain words, when the schedule could not be kept by the routines engine (the routine is then removed). */
  routineError?: string;
}

/** A bot routine shown in the Atelier as Trigger → Bot, read only. */
export interface RoutineMiniWorkflow {
  id: string;
  routineId: string;
  name: string;
  readOnly: true;
  enabled: boolean;
  nextRunAt: number | null;
  /** The routine's own schedule, for the schedules a Trigger block cannot hold (cron). */
  routineSchedule: Routine["schedule"];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

/** The routine schedule a Trigger block asks for; null when it runs by hand or is not filled in yet. */
export function routineScheduleOf(trigger: NodeData<"trigger"> | undefined, anchorAt: number): RoutineScheduleInput | null {
  if (!trigger) return null;
  if (trigger.mode === "ai-reset") {
    const engine = trigger.engine?.trim();
    return engine ? { type: "limit_reset", engine, repeat: "every_reset" } : null;
  }
  if (trigger.mode !== "schedule" || !trigger.schedule) return null;
  const s = trigger.schedule;
  const days = s.days?.length ? [...new Set(s.days)].sort() : undefined;
  if (s.kind === "once") {
    if (!s.date || !s.at) return null;
    const at = new Date(`${s.date}T${s.at}:00`).getTime();
    return Number.isFinite(at) ? { type: "once", at } : null;
  }
  if (s.kind === "daily") return s.at ? { type: "daily", time: s.at, weekdays: days ?? ALL_DAYS } : null;
  if (s.kind === "weekdays") return s.at ? { type: "daily", time: s.at, weekdays: days ?? WEEKDAYS } : null;
  if (!s.everyMinutes) return null;
  const anchor = s.date && s.at ? new Date(`${s.date}T${s.at}:00`).getTime() : anchorAt;
  return { type: "interval", everyMinutes: s.everyMinutes, anchorAt: Number.isFinite(anchor) ? anchor : anchorAt, ...(days ? { weekdays: days } : {}) };
}

/** The Trigger block data a routine schedule reads as; null for a schedule a Trigger block cannot hold. */
export function triggerOfRoutine(schedule: Routine["schedule"]): NodeData<"trigger"> | null {
  if (schedule.type === "limit_reset") return { mode: "ai-reset", engine: schedule.engine };
  if (schedule.type === "once") {
    const d = new Date(schedule.at);
    return { mode: "schedule", schedule: { kind: "once", date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, at: `${pad(d.getHours())}:${pad(d.getMinutes())}` } };
  }
  if (schedule.type === "daily") {
    const every = ALL_DAYS.every((day) => schedule.weekdays.includes(day));
    const sched: WorkflowSchedule = every ? { kind: "daily", at: schedule.time } : { kind: "weekdays", at: schedule.time, days: [...schedule.weekdays] };
    return { mode: "schedule", schedule: sched };
  }
  if (schedule.type === "interval") {
    return { mode: "schedule", schedule: { kind: "interval", everyMinutes: schedule.everyMinutes, ...(schedule.weekdays ? { days: [...schedule.weekdays] } : {}) } };
  }
  return null;
}

/** Whether the routine already has this schedule (so a save that changes nothing leaves its next run alone). */
function sameSchedule(current: Routine["schedule"], wanted: RoutineScheduleInput): boolean {
  if (current.type !== wanted.type) return false;
  if (current.type === "once" && wanted.type === "once") return current.at === wanted.at;
  if (current.type === "daily" && wanted.type === "daily") return current.time === wanted.time && JSON.stringify(current.weekdays) === JSON.stringify([...wanted.weekdays].sort());
  if (current.type === "interval" && wanted.type === "interval") {
    return current.everyMinutes === wanted.everyMinutes && current.anchorAt === wanted.anchorAt && JSON.stringify(current.weekdays ?? null) === JSON.stringify(wanted.weekdays ?? null);
  }
  if (current.type === "limit_reset" && wanted.type === "limit_reset") return current.engine === wanted.engine && current.repeat === (wanted.repeat ?? "once");
  return false;
}

const stateOf = (routine: Routine): WorkflowRoutineState => ({ id: routine.id, enabled: routine.enabled, nextRunAt: routine.nextRunAt });

export interface WorkflowRoutineLinkDeps {
  /** Null until the routines engine is up (or where it never runs). */
  routines(): WorkflowRoutines | null;
  store: WorkflowStore;
  runner: WorkflowRunner;
}

export function createWorkflowRoutineLink(deps: WorkflowRoutineLinkDeps) {
  const { store, runner } = deps;
  /** Routine run id → the workflow run it started. */
  const started = new Map<string, string>();

  const routinesOf = (workflowId: string): Routine[] =>
    deps.routines()?.listRoutines().filter((r) => r.target === "workflow" && r.workflowId === workflowId) ?? [];

  const remove = (workflowId: string) => {
    const routines = deps.routines();
    for (const routine of routinesOf(workflowId)) routines?.remove(routine.id);
  };

  /** After a workflow was saved: its routine follows its Trigger block. */
  const sync = (workflow: Workflow): WorkflowRoutineSync => {
    const routines = deps.routines();
    if (!routines) return { routine: null };
    const trigger = workflow.nodes.find((n): n is Extract<WorkflowNode, { kind: "trigger" }> => n.kind === "trigger");
    const schedule = routineScheduleOf(trigger?.data, workflow.createdAt);
    const [current, ...extra] = routinesOf(workflow.id);
    for (const routine of extra) routines.remove(routine.id);
    if (!schedule) {
      if (current) routines.remove(current.id);
      return { routine: null };
    }
    const name = workflow.name.slice(0, 80);
    try {
      if (!current) {
        const input: RoutineInput = { name, prompt: "", target: "workflow", workflowId: workflow.id, botId: WORKFLOW_ROUTINE_BOT, schedule };
        return { routine: stateOf(routines.create(input)) };
      }
      const changed = !sameSchedule(current.schedule, schedule);
      if (!changed && current.name === name) return { routine: stateOf(current) };
      const updated = routines.update(current.id, { name, ...(changed ? { schedule, enabled: true } : {}) });
      return { routine: updated ? stateOf(updated) : null };
    } catch (error) {
      if (current) routines.remove(current.id);
      return { routine: null, routineError: error instanceof Error ? error.message : String(error) };
    }
  };

  const routineOf = (workflowId: string): WorkflowRoutineState | null => {
    const routine = routinesOf(workflowId)[0];
    return routine ? stateOf(routine) : null;
  };

  /** At start: each workflow's routine follows its trigger, and the routines of deleted workflows go. */
  const reconcile = () => {
    const routines = deps.routines();
    if (!routines) return;
    const ids = new Set(store.list().map((w) => w.id));
    for (const routine of routines.listRoutines()) {
      if (routine.target === "workflow" && (!routine.workflowId || !ids.has(routine.workflowId))) routines.remove(routine.id);
    }
    for (const workflow of store.list()) {
      const result = sync(workflow);
      if (result.routineError) console.warn(`workflows: the schedule of ${workflow.id} could not be kept: ${result.routineError}`);
    }
  };

  const busy = (workflowId: string) => runner.active().some((runId) => store.getRun(runId)?.workflowId === workflowId);

  /** RoutineManagerOptions.workflowState */
  const workflowState = (workflowId: string): "ready" | "busy" | "missing" =>
    !store.get(workflowId) ? "missing" : busy(workflowId) ? "busy" : "ready";

  /** RoutineManagerOptions.startWorkflow */
  const startWorkflow = (workflowId: string, routineRunId: string, text: string | undefined, onDispatchError: (message: string) => void, source: TriggerSource) => {
    let run;
    try {
      run = runner.start(workflowId, { source, routineRunId, ...(text ? { text } : {}) });
    } catch (error) {
      if (error instanceof WorkflowInvalidError) {
        const first = error.problems[0];
        return onDispatchError([error.message, first?.message_en].filter(Boolean).join(": "));
      }
      if (error instanceof WorkflowBusyError) return onDispatchError(error.message);
      return onDispatchError(error instanceof Error ? error.message : String(error));
    }
    started.set(routineRunId, run.id);
    void runner.settled(run.id).then((ended) => {
      const status: RoutineWorkflowStatus = ended.status === "succeeded" ? "succeeded" : ended.status === "cancelled" ? "cancelled" : "failed";
      try { deps.routines()?.finishWorkflowRun(routineRunId, status, ended.reason ?? ""); }
      finally { started.delete(routineRunId); }
    }).catch((error: unknown) => console.error("workflows: could not close a routine run", error));
  };

  /** RoutineManagerOptions.stopWorkflow */
  const stopWorkflow = (routineRunId: string) => {
    const runId = started.get(routineRunId);
    if (runId) runner.cancel(runId);
  };

  /** Whether a failed routine run started its workflow (whose own failure notice is then already out). */
  const startedRun = (routineRun: Pick<RoutineRun, "id">) => started.has(routineRun.id);

  /** Bot routines as read-only mini-workflows (Trigger → Bot). */
  const automations = (): RoutineMiniWorkflow[] => (deps.routines()?.listRoutines() ?? [])
    .filter((routine) => routine.target === "bot")
    .map((routine) => {
      const trigger = triggerOfRoutine(routine.schedule) ?? { mode: "schedule" as const };
      const id = `routine-${routine.id}`.slice(0, 64).replace(/[^\w-]/g, "-");
      return {
        id, routineId: routine.id, name: routine.name, readOnly: true as const, enabled: routine.enabled, nextRunAt: routine.nextRunAt, routineSchedule: routine.schedule,
        nodes: [
          { id: "trigger", kind: "trigger", x: 0, y: 0, data: trigger },
          { id: "bot", kind: "bot", x: 320, y: 0, data: { instruction: routine.prompt, botId: routine.botId } },
        ] as WorkflowNode[],
        edges: [{ id: "wire", from: { node: "trigger", port: "out" }, to: { node: "bot", port: "in" } }],
      };
    });

  return { sync, remove, routineOf, reconcile, workflowState, startWorkflow, stopWorkflow, startedRun, automations };
}

export type WorkflowRoutineLink = ReturnType<typeof createWorkflowRoutineLink>;
