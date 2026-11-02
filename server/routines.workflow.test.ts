import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineManager, WORKFLOW_ROUTINE_BOT, type RoutineRun } from "./routines.ts";

const START = new Date(2026, 9, 19, 8, 0, 0).getTime();
const MINUTE = 60_000, HOUR = 60 * MINUTE;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function harness(file?: string) {
  const dir = mkdtempSync(join(tmpdir(), "omb-wf-routines-"));
  dirs.push(dir);
  let now = START;
  const workflows = new Map<string, "ready" | "busy" | "missing">([["wf-1", "ready"]]);
  const resets = new Map<string, number | null>();
  const started: Array<{ workflowId: string; runId: string; text: string | undefined; source: string }> = [];
  const failed: RoutineRun[] = [];
  const stopped: string[] = [];
  const turns: string[] = [];
  const options = {
    file: file ?? join(dir, "routines.json"),
    now: () => now,
    botState: () => "ready" as const,
    createTask: () => ({ threadId: "t" }),
    startTurn: async (botId: string) => { turns.push(botId); },
    workflowState: (id: string) => workflows.get(id) ?? "missing",
    startWorkflow: (workflowId: string, runId: string, text: string | undefined, _onError: (message: string) => void, source: string) => {
      started.push({ workflowId, runId, text, source });
    },
    stopWorkflow: (runId: string) => { stopped.push(runId); },
    onRunFailed: (run: RoutineRun) => failed.push(run),
    limitResetAt: (engine: string) => resets.get(engine) ?? null,
  };
  const manager = new RoutineManager(options);
  return {
    manager, started, failed, stopped, turns, workflows, file: options.file, options,
    at: (next: number) => { now = next; },
    reset: (engine: string, at: number | null) => resets.set(engine, at),
    daily: (time = "09:00") => manager.create({ name: "Morning digest", prompt: "", target: "workflow", workflowId: "wf-1", botId: WORKFLOW_ROUTINE_BOT, schedule: { type: "daily", time, weekdays: [0, 1, 2, 3, 4, 5, 6] } }),
  };
}

describe("workflow routines", () => {
  it("a workflow routine fires on schedule and starts the workflow", async () => {
    const h = harness();
    const routine = h.daily();
    expect(routine.target).toBe("workflow");
    expect(routine.workflowId).toBe("wf-1");
    expect(routine.nextRunAt).toBe(START + HOUR);
    await h.manager.tick();
    expect(h.started).toEqual([]);
    h.at(START + HOUR + MINUTE);
    await h.manager.tick();
    expect(h.started).toHaveLength(1);
    expect(h.started[0]).toMatchObject({ workflowId: "wf-1", source: "schedule" });
    const run = h.manager.listRuns()[0]!;
    expect(run).toMatchObject({ status: "running", target: "workflow", workflowId: "wf-1" });
    expect(run.threadId).toBeUndefined();
    expect(h.turns).toEqual([]);
    const done = h.manager.finishWorkflowRun(run.id, "succeeded", "All steps done");
    expect(done).toMatchObject({ status: "completed", output: "All steps done" });
    expect(h.manager.finishWorkflowRun(run.id, "failed", "late")).toBeNull();
  });

  it("a failed or cancelled workflow run closes its routine run", async () => {
    const h = harness();
    h.daily();
    h.at(START + HOUR + MINUTE);
    await h.manager.tick();
    const run = h.manager.listRuns()[0]!;
    expect(h.manager.finishWorkflowRun(run.id, "failed", "The bot step failed")).toMatchObject({ status: "failed", error: "The bot step failed" });
    expect(h.failed).toHaveLength(1);
  });

  it("a busy workflow waits instead of starting twice", async () => {
    const h = harness();
    h.daily();
    h.workflows.set("wf-1", "busy");
    h.at(START + HOUR + MINUTE);
    await h.manager.tick();
    expect(h.started).toEqual([]);
    expect(h.manager.listRuns()[0]).toMatchObject({ status: "queued" });
    h.workflows.set("wf-1", "ready");
    await h.manager.tick();
    expect(h.started).toHaveLength(1);
  });

  it("a missed workflow run is caught up like a routine", async () => {
    const h = harness();
    h.daily();
    h.at(START + HOUR + 2 * HOUR);
    await h.manager.tick();
    expect(h.started).toHaveLength(1);
    const later = harness();
    later.daily();
    later.at(START + HOUR + 13 * HOUR);
    await later.manager.tick();
    expect(later.started).toEqual([]);
    expect(later.manager.listRuns()[0]).toMatchObject({ status: "missed", target: "workflow" });
  });

  it("a missing workflow fails the routine run in plain words", async () => {
    const h = harness();
    const routine = h.daily();
    const run = h.manager.runNow(routine.id)!;
    h.workflows.delete("wf-1");
    await h.manager.tick();
    expect(h.started).toEqual([]);
    const failed = h.manager.listRuns().find((r) => r.id === run.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("The workflow no longer exists");
    expect(() => h.daily()).toThrow("The workflow no longer exists");
  });

  it("cancelling a running workflow routine run stops the workflow", async () => {
    const h = harness();
    const routine = h.daily();
    const run = h.manager.runNow(routine.id)!;
    await h.manager.tick();
    expect(h.started[0]).toMatchObject({ source: "manual" });
    await h.manager.cancelRun(run.id);
    expect(h.stopped).toEqual([run.id]);
  });

  it("refuses a workflow routine without a workflow, or with parts only a bot routine has", () => {
    const h = harness();
    const base = { name: "x", prompt: "", target: "workflow" as const, botId: WORKFLOW_ROUTINE_BOT, schedule: { type: "daily" as const, time: "09:00", weekdays: [1] } };
    expect(() => h.manager.create(base)).toThrow("Choose a workflow");
    expect(() => h.manager.create({ ...base, workflowId: "wf-1", runOn: "cloud" })).toThrow();
    expect(() => h.manager.create({ ...base, workflowId: "wf-1", continuity: true })).toThrow();
    expect(() => h.manager.create({ name: "x", prompt: "", botId: "scout", schedule: base.schedule })).toThrow("Tell the bot what to do");
  });

  it("a restart during a workflow routine run fails it, never starts it again", async () => {
    const h = harness();
    const routine = h.daily();
    h.manager.runNow(routine.id);
    await h.manager.tick();
    const again = harness(h.file);
    expect(again.manager.listRuns()[0]).toMatchObject({ status: "failed" });
    await again.manager.tick();
    expect(again.started).toEqual([]);
  });

  it("an unknown target is kept on disk and not scheduled", async () => {
    const h = harness();
    const routine = h.daily();
    const disk = JSON.parse(readFileSync(h.file, "utf8"));
    disk.routines.push({ ...disk.routines[0], id: "from-the-future", target: "spaceship", nextRunAt: START + MINUTE });
    disk.runs.push({ id: "future-run", routineId: "from-the-future", routineName: "x", target: "spaceship", botId: "b", runOn: "maus", scheduledFor: START, status: "queued", manual: true, createdAt: START });
    writeFileSync(h.file, JSON.stringify(disk));
    const later = harness(h.file);
    expect(later.manager.listRoutines().map((r) => r.id)).toEqual([routine.id]);
    expect(later.manager.listRuns()).toEqual([]);
    later.at(START + 2 * MINUTE);
    await later.manager.tick();
    expect(later.started).toEqual([]);
    expect(later.turns).toEqual([]);
    later.manager.update(routine.id, { name: "Renamed" });
    const saved = JSON.parse(readFileSync(h.file, "utf8"));
    expect(saved.routines.find((r: { id: string }) => r.id === "from-the-future")).toMatchObject({ target: "spaceship" });
    expect(saved.runs.find((r: { id: string }) => r.id === "future-run")).toMatchObject({ target: "spaceship" });
  });

  it("a workflow routine an older version rewrote as a bot routine comes back as a workflow one", () => {
    const h = harness();
    const routine = h.daily();
    const disk = JSON.parse(readFileSync(h.file, "utf8"));
    disk.routines[0].target = "bot";
    writeFileSync(h.file, JSON.stringify(disk));
    const later = harness(h.file);
    expect(later.manager.listRoutines()[0]).toMatchObject({ id: routine.id, target: "workflow", workflowId: "wf-1" });
  });

  it("an older version never runs a workflow routine on a bot: its bot does not exist", () => {
    // Older versions read an unknown target as "bot"; the routine's bot is a name no bot can have, so they see it missing.
    expect(WORKFLOW_ROUTINE_BOT).toMatch(/[^\w-]/);
  });
});
