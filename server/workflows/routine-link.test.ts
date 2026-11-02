import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { WorkflowInput } from "../../shared/workflows.ts";
import { RoutineManager, type RoutineRun } from "../routines.ts";
import { createWorkflowRoutineLink, routineScheduleOf, triggerOfRoutine } from "./routine-link.ts";
import { createWorkflowRunner } from "./runner.ts";
import type { StepDeps } from "./steps.ts";
import { createWorkflowStore } from "./store.ts";

const base = process.env.OMB_TEST_TMP ?? "/tmp/claude-0/-home-claude/d16a11f4-bf84-5ccc-b733-9d95abe987d6/scratchpad";
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(base, "wf-link-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const START = new Date(2026, 9, 19, 8, 0, 0).getTime();
const MINUTE = 60_000, HOUR = 60 * MINUTE;

function def(trigger: Record<string, unknown>, extra: Partial<WorkflowInput> = {}): Omit<WorkflowInput, "createdAt" | "updatedAt"> {
  return {
    id: "w1", name: "Veille du matin",
    nodes: [
      { id: "t", kind: "trigger", x: 0, y: 0, data: trigger },
      { id: "a", kind: "ai", x: 200, y: 0, data: { prompt: "Résume" } },
    ] as WorkflowInput["nodes"],
    edges: [{ id: "e", from: { node: "t", port: "out" }, to: { node: "a", port: "in" } }],
    ...extra,
  };
}

function setup() {
  const dir = tmp();
  let now = START;
  const store = createWorkflowStore(dir);
  const prompts: string[] = [];
  let release: () => void = () => {};
  let hold = false;
  const steps: StepDeps = {
    generateText: async ({ prompt }) => {
      prompts.push(prompt);
      if (hold) await new Promise<void>((resolve) => { release = resolve; });
      return { text: "ok", costUsd: 0.01 };
    },
    runBot: async () => ({ text: "", costUsd: 0 }),
    askApproval: async () => "yes",
    notify: async () => {},
    postToBotChat: async () => {},
  };
  const runner = createWorkflowRunner({ store, steps, botExists: () => true, budgetAllows: () => true });
  let manager: RoutineManager | null = null;
  const link = createWorkflowRoutineLink({ routines: () => manager, store, runner });
  const failed: RoutineRun[] = [];
  manager = new RoutineManager({
    file: join(dir, "routines.json"), now: () => now,
    botState: (id) => (id === "scout" ? "ready" : "missing"), createTask: () => ({ threadId: "t" }), startTurn: async () => {},
    workflowState: link.workflowState, startWorkflow: link.startWorkflow, stopWorkflow: link.stopWorkflow,
    onRunFailed: (run) => failed.push(run),
  });
  const save = (input: unknown) => {
    const current = store.get("w1");
    const workflow = store.save(input, current?.rev ?? 0);
    return { workflow, ...link.sync(workflow) };
  };
  return {
    store, runner, link, manager, prompts, failed, save,
    at: (next: number) => { now = next; },
    hold: () => { hold = true; },
    release: () => release(),
    workflowRoutines: () => manager!.listRoutines().filter((r) => r.target === "workflow"),
  };
}

const daily = { mode: "schedule", schedule: { kind: "daily", at: "09:00" } };

describe("a workflow's routine follows its trigger", () => {
  it("saving a scheduled trigger creates its routine, with the next run", () => {
    const h = setup();
    const saved = h.save(def(daily));
    expect(saved.routine).toMatchObject({ enabled: true, nextRunAt: START + HOUR });
    expect(h.workflowRoutines()).toHaveLength(1);
    expect(h.workflowRoutines()[0]).toMatchObject({ workflowId: "w1", name: "Veille du matin", schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] } });
    expect(h.link.routineOf("w1")).toEqual(saved.routine);
  });

  it("a save that changes the time moves the routine; one that changes nothing leaves it alone", () => {
    const h = setup();
    const first = h.save(def(daily));
    const updatedAt = h.workflowRoutines()[0]!.updatedAt;
    const again = h.save(def(daily));
    expect(again.routine).toEqual(first.routine);
    expect(h.workflowRoutines()[0]!.updatedAt).toBe(updatedAt);
    const moved = h.save(def({ mode: "schedule", schedule: { kind: "daily", at: "10:30" } }));
    expect(moved.routine).toMatchObject({ id: first.routine!.id, nextRunAt: START + 2.5 * HOUR });
  });

  it("saving a manual trigger removes the workflow's routine", () => {
    const h = setup();
    h.save(def(daily));
    expect(h.workflowRoutines()).toHaveLength(1);
    const manual = h.save(def({ mode: "manual" }));
    expect(manual.routine).toBeNull();
    expect(h.workflowRoutines()).toEqual([]);
  });

  it("a schedule the routines engine refuses is said in plain words, and leaves no routine", () => {
    const h = setup();
    h.save(def(daily));
    const refused = h.save(def({ mode: "schedule", schedule: { kind: "interval", everyMinutes: 2 } }));
    expect(refused.routine).toBeNull();
    expect(refused.routineError).toMatch(/5 to 1440 minutes/);
    expect(h.workflowRoutines()).toEqual([]);
  });

  it("an AI-limit-reset trigger makes a routine that waits for that AI's reset, every reset", () => {
    const h = setup();
    const saved = h.save(def({ mode: "ai-reset", engine: "codex" }));
    expect(saved.routine).toMatchObject({ nextRunAt: null });
    expect(h.workflowRoutines()[0]!.schedule).toMatchObject({ type: "limit_reset", engine: "codex", repeat: "every_reset" });
    expect(h.save(def({ mode: "ai-reset" })).routine).toBeNull();
    expect(h.workflowRoutines()).toEqual([]);
  });

  it("deleting the workflow removes its routine, and start-up drops routines of workflows that are gone", () => {
    const h = setup();
    h.save(def(daily));
    h.link.remove("w1");
    expect(h.workflowRoutines()).toEqual([]);
    h.save(def({ mode: "schedule", schedule: { kind: "daily", at: "09:00" } }, { name: "Autre" }));
    h.store.delete("w1");
    h.link.reconcile();
    expect(h.workflowRoutines()).toEqual([]);
  });

  it("the routine fires and runs the workflow, then closes with the workflow's outcome", async () => {
    const h = setup();
    h.save(def(daily));
    h.at(START + HOUR + MINUTE);
    await h.manager.tick();
    const run = h.manager.listRuns()[0]!;
    expect(run).toMatchObject({ target: "workflow", status: "running" });
    const wfRun = h.store.listRuns("w1")[0]!;
    await h.runner.settled(wfRun.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.manager.listRuns()[0]).toMatchObject({ id: run.id, status: "completed" });
    expect(h.prompts).toHaveLength(1);
  });

  it("an invalid workflow fails its routine run in plain words", async () => {
    const h = setup();
    h.save(def(daily, { nodes: [{ id: "t", kind: "trigger", x: 0, y: 0, data: daily }, { id: "a", kind: "ai", x: 200, y: 0, data: { prompt: "" } }] as WorkflowInput["nodes"] }));
    h.at(START + HOUR + MINUTE);
    await h.manager.tick();
    const run = h.manager.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/problems to fix/);
    expect(h.link.startedRun(run)).toBe(false);
  });

  it("stopping the routine run stops the workflow run", async () => {
    const h = setup();
    h.hold();
    h.save(def(daily));
    h.at(START + HOUR + MINUTE);
    await h.manager.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const routineRun = h.manager.listRuns()[0]!;
    expect(h.link.workflowState("w1")).toBe("busy");
    await h.manager.cancelRun(routineRun.id);
    const wfRun = await h.runner.settled(h.store.listRuns("w1")[0]!.id);
    expect(wfRun.status).toBe("cancelled");
    expect(h.link.workflowState("w1")).toBe("ready");
    expect(h.link.workflowState("gone")).toBe("missing");
  });
});

describe("existing automations as mini-workflows", () => {
  it("lists each bot routine as Trigger → Bot, read only", () => {
    const h = setup();
    const routine = h.manager.create({ name: "Mails", prompt: "Trie mes mails", botId: "scout", schedule: { type: "daily", time: "07:15", weekdays: [1, 2, 3, 4, 5] } });
    h.save(def(daily));
    const [mini, ...rest] = h.link.automations();
    expect(rest).toEqual([]);
    expect(mini).toMatchObject({ routineId: routine.id, name: "Mails", readOnly: true, enabled: true });
    expect(mini!.nodes).toEqual([
      { id: "trigger", kind: "trigger", x: 0, y: 0, data: { mode: "schedule", schedule: { kind: "weekdays", at: "07:15", days: [1, 2, 3, 4, 5] } } },
      { id: "bot", kind: "bot", x: 320, y: 0, data: { instruction: "Trie mes mails", botId: "scout" } },
    ]);
    expect(mini!.edges).toHaveLength(1);
    expect(mini!.id).toMatch(/^[\w-]{1,64}$/);
  });

  it("reads routine schedules back as triggers, and a cron one as no trigger schedule", () => {
    expect(triggerOfRoutine({ type: "daily", time: "08:00", weekdays: [0, 1, 2, 3, 4, 5, 6] })).toEqual({ mode: "schedule", schedule: { kind: "daily", at: "08:00" } });
    expect(triggerOfRoutine({ type: "interval", everyMinutes: 30, anchorAt: 0 })).toEqual({ mode: "schedule", schedule: { kind: "interval", everyMinutes: 30 } });
    expect(triggerOfRoutine({ type: "once", at: new Date(2026, 10, 3, 14, 5).getTime() })).toEqual({ mode: "schedule", schedule: { kind: "once", date: "2026-11-03", at: "14:05" } });
    expect(triggerOfRoutine({ type: "limit_reset", engine: "claude", repeat: "once", at: null })).toEqual({ mode: "ai-reset", engine: "claude" });
    expect(triggerOfRoutine({ type: "cron", expression: "0 9 * * 1", timeZone: "UTC" } as never)).toBeNull();
    expect(routineScheduleOf({ mode: "schedule", schedule: { kind: "once", date: "2026-11-03", at: "14:05" } }, 0)).toEqual({ type: "once", at: new Date(2026, 10, 3, 14, 5).getTime() });
    expect(routineScheduleOf({ mode: "schedule", schedule: { kind: "weekdays", at: "08:00" } }, 0)).toEqual({ type: "daily", time: "08:00", weekdays: [1, 2, 3, 4, 5] });
    expect(routineScheduleOf({ mode: "schedule", schedule: { kind: "daily" } }, 0)).toBeNull();
    expect(routineScheduleOf({ mode: "manual" }, 0)).toBeNull();
  });
});
