import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { WorkflowRun } from "../../shared/workflows.ts";
import { MAX_RUNS, WorkflowConflictError, WorkflowInputError, createWorkflowStore, runsPath, workflowsPath } from "./store.ts";

const ROOT = process.env.OMB_DATA_DIR ?? join(process.env.TMPDIR ?? "/tmp", "wf-data");
mkdirSync(ROOT, { recursive: true });
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(ROOT, "store-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

let clock = 1000;
const now = () => clock;
let ids = 0;
const newId = () => `id${++ids}`;
const draft = (extra: Record<string, unknown> = {}) => ({
  name: "Matin",
  nodes: [{ id: "t", kind: "trigger", x: 0, y: 0, data: { mode: "manual" } }],
  edges: [],
  ...extra,
});
const run = (id: string, startedAt: number, status: WorkflowRun["status"] = "succeeded"): WorkflowRun =>
  ({ id, workflowId: "w", status, steps: [], startedAt, ...(status === "running" ? {} : { endedAt: startedAt + 1 }) });

describe("workflow store", () => {
  it("starts empty when there is no file and keeps files in the data dir", () => {
    const dir = tmp();
    const store = createWorkflowStore(dir, { now, newId });
    expect(store.list()).toEqual([]);
    expect(workflowsPath(dir)).toBe(join(dir, "workflows.json"));
    expect(runsPath(dir)).toBe(join(dir, "workflow-runs.json"));
  });

  it("creates a workflow with an id, rev 1 and timestamps, and writes version 1 to disk", () => {
    const dir = tmp();
    clock = 5000;
    const saved = createWorkflowStore(dir, { now, newId }).save(draft(), 0);
    expect(saved).toMatchObject({ name: "Matin", rev: 1, createdAt: 5000, updatedAt: 5000 });
    expect(saved.id).toMatch(/^id\d+$/);
    const disk = JSON.parse(readFileSync(workflowsPath(dir), "utf8"));
    expect(disk.version).toBe(1);
    expect(disk.workflows).toHaveLength(1);
    expect(createWorkflowStore(dir).get(saved.id)).toEqual(saved);
  });

  it("updates with the saved rev and refuses an older rev with a conflict carrying the current rev", () => {
    const dir = tmp();
    const store = createWorkflowStore(dir, { now, newId });
    const first = store.save(draft(), 0);
    clock = 9000;
    const second = store.save({ ...first, name: "Soir" }, 1);
    expect(second).toMatchObject({ id: first.id, name: "Soir", rev: 2, createdAt: first.createdAt, updatedAt: 9000 });
    let conflict: unknown;
    try { store.save({ ...first, name: "Perdu" }, 1); } catch (error) { conflict = error; }
    expect(conflict).toBeInstanceOf(WorkflowConflictError);
    expect((conflict as WorkflowConflictError).rev).toBe(2);
    expect((conflict as WorkflowConflictError).status).toBe(409);
    expect(store.get(first.id)!.name).toBe("Soir");
  });

  it("refuses to create over an id that does not exist with a non-zero rev", () => {
    const store = createWorkflowStore(tmp(), { now, newId });
    expect(() => store.save({ ...draft(), id: "nope" }, 3)).toThrow(WorkflowConflictError);
  });

  it("refuses an invalid workflow without touching the file", () => {
    const dir = tmp();
    const store = createWorkflowStore(dir, { now, newId });
    expect(() => store.save({ name: "", nodes: [], edges: [] }, 0)).toThrow(WorkflowInputError);
    expect(existsSync(workflowsPath(dir))).toBe(false);
  });

  it("deletes a workflow, with a rev check when given", () => {
    const dir = tmp();
    const store = createWorkflowStore(dir, { now, newId });
    const w = store.save(draft(), 0);
    expect(() => store.delete(w.id, 7)).toThrow(WorkflowConflictError);
    expect(store.delete(w.id, 1)).toBe(true);
    expect(store.delete(w.id)).toBe(false);
    expect(createWorkflowStore(dir).list()).toEqual([]);
  });

  it("backs up a corrupt file and starts empty instead of crashing", () => {
    const dir = tmp();
    writeFileSync(workflowsPath(dir), "{ not json");
    writeFileSync(runsPath(dir), JSON.stringify({ version: 1, runs: "nope" }));
    const store = createWorkflowStore(dir, { now, newId });
    expect(store.list()).toEqual([]);
    expect(store.listRuns()).toEqual([]);
    const backups = readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    expect(backups.length).toBe(2);
    expect(readFileSync(join(dir, backups.find((f) => f.startsWith("workflows.json"))!), "utf8")).toBe("{ not json");
    store.save(draft(), 0);
    expect(createWorkflowStore(dir).list()).toHaveLength(1);
    expect(readdirSync(dir).filter((f) => f.includes(".corrupt-")).length, "a later start makes no second copy").toBe(2);
  });

  it("never overwrites a file written by a newer version", () => {
    const dir = tmp();
    const newer = JSON.stringify({ version: 2, workflows: [{ future: true }] });
    writeFileSync(workflowsPath(dir), newer);
    const store = createWorkflowStore(dir, { now, newId });
    expect(store.list()).toEqual([]);
    expect(() => store.save(draft(), 0)).toThrow("could not be read");
    expect(readFileSync(workflowsPath(dir), "utf8")).toBe(newer);
  });

  it("refuses to save over a file it could not read at all", () => {
    const dir = tmp();
    mkdirSync(workflowsPath(dir)); // a folder where the file should be
    const store = createWorkflowStore(dir, { now, newId });
    expect(store.list()).toEqual([]);
    expect(() => store.save(draft(), 0)).toThrow("could not be read");
  });

  it("keeps the valid workflows of a file with one bad entry, and backs the file up", () => {
    const dir = tmp();
    const good = createWorkflowStore(dir, { now, newId }).save(draft(), 0);
    writeFileSync(workflowsPath(dir), JSON.stringify({ version: 1, workflows: [good, { id: "bad", nodes: "x" }] }));
    expect(createWorkflowStore(dir).list().map((w) => w.id)).toEqual([good.id]);
    expect(readdirSync(dir).some((f) => f.startsWith("workflows.json.corrupt-"))).toBe(true);
  });

  it("leaves no temp file behind after a write", () => {
    const dir = tmp();
    createWorkflowStore(dir, { now, newId }).save(draft(), 0);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("workflow runs", () => {
  it("saves and replaces runs by id, newest first, filtered by workflow", () => {
    const dir = tmp();
    const store = createWorkflowStore(dir, { now, newId });
    store.saveRun(run("r1", 10, "running"));
    store.saveRun(run("r2", 20));
    store.saveRun({ ...run("r1", 10), status: "failed", reason: "x" });
    store.saveRun({ ...run("r3", 30), workflowId: "other" });
    const again = createWorkflowStore(dir);
    expect(again.listRuns("w").map((r) => [r.id, r.status])).toEqual([["r2", "succeeded"], ["r1", "failed"]]);
    expect(again.getRun("r3")!.workflowId).toBe("other");
  });

  it("keeps 500 runs: the 501st drops the oldest", () => {
    const dir = tmp();
    const store = createWorkflowStore(dir, { now, newId });
    expect(MAX_RUNS).toBe(500);
    for (let i = 1; i <= 501; i++) store.saveRun(run(`r${i}`, i));
    const runs = createWorkflowStore(dir).listRuns();
    expect(runs).toHaveLength(500);
    expect(runs.some((r) => r.id === "r1")).toBe(false);
    expect(runs[0]!.id).toBe("r501");
  });

  it("drops a finished run before an older run that is still going", () => {
    const store = createWorkflowStore(tmp(), { now, newId });
    store.saveRun(run("live", 0, "running"));
    for (let i = 1; i <= 500; i++) store.saveRun(run(`r${i}`, i));
    const ids = store.listRuns().map((r) => r.id);
    expect(ids).toContain("live");
    expect(ids).not.toContain("r1");
  });

  it("marks runs left running by a restart as failed", () => {
    const dir = tmp();
    clock = 777;
    const store = createWorkflowStore(dir, { now, newId });
    store.saveRun({ ...run("r1", 1, "running"), steps: [{ nodeId: "a", status: "running" }, { nodeId: "b", status: "pending" }] });
    store.saveRun(run("r2", 2));
    expect(createWorkflowStore(dir, { now }).failInterruptedRuns("restart")).toBe(1);
    const r1 = createWorkflowStore(dir).getRun("r1")!;
    expect(r1).toMatchObject({ status: "failed", reason: "restart", endedAt: 777 });
    expect(r1.steps.map((s) => s.status)).toEqual(["failed", "skipped"]);
    expect(createWorkflowStore(dir).getRun("r2")!.status).toBe("succeeded");
  });

  it("removes a workflow's runs when asked", () => {
    const store = createWorkflowStore(tmp(), { now, newId });
    store.saveRun(run("r1", 1));
    store.saveRun({ ...run("r2", 2), workflowId: "other" });
    expect(store.deleteRuns("w")).toBe(1);
    expect(store.listRuns().map((r) => r.id)).toEqual(["r2"]);
  });
});
