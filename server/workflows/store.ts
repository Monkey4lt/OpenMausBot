// Workflows and their runs, kept in the data dir: workflows.json (the person's workflows) and workflow-runs.json
// (the last 500 runs, written often by the runner). A save carries the rev it was based on; an older rev is refused
// with a conflict, like the projects map. A file that cannot be read is backed up and the store starts empty.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { z } from "zod";

import { workflowRunSchema, workflowSchema, type Workflow, type WorkflowRun } from "../../shared/workflows.ts";
import { writeFileAtomic } from "../atomic.ts";

export const MAX_RUNS = 500;
const VERSION = 1;

export function workflowsPath(dataDir: string): string {
  return join(dataDir, "workflows.json");
}

export function runsPath(dataDir: string): string {
  return join(dataDir, "workflow-runs.json");
}

/** The save was based on an older rev than the one saved; `rev` is the saved one (0: it no longer exists). */
export class WorkflowConflictError extends Error {
  readonly status = 409;
  readonly rev: number;
  constructor(rev: number) {
    super("The workflow changed since it was loaded");
    this.name = "WorkflowConflictError";
    this.rev = rev;
  }
}

export class WorkflowInputError extends Error {
  readonly status = 400;
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid workflow: ${issues.slice(0, 3).join("; ")}`);
    this.name = "WorkflowInputError";
    this.issues = issues;
  }
}

export interface WorkflowStore {
  list(): Workflow[];
  get(id: string): Workflow | null;
  /** Creates (baseRev 0, id optional) or replaces (baseRev = the saved rev); returns what was written, rev bumped. */
  save(input: unknown, baseRev: number): Workflow;
  /** false when there was nothing to delete; a given baseRev must match the saved rev. */
  delete(id: string, baseRev?: number): boolean;
  /** Newest first, optionally only one workflow's runs. */
  listRuns(workflowId?: string): WorkflowRun[];
  getRun(id: string): WorkflowRun | null;
  /** Adds or replaces a run by id; past MAX_RUNS the oldest finished runs are dropped first. */
  saveRun(run: WorkflowRun): WorkflowRun;
  deleteRuns(workflowId: string): number;
  /** At start: runs still marked running were cut by a restart. Returns how many were marked failed. */
  failInterruptedRuns(reason: string): number;
}

export interface WorkflowStoreOptions {
  now?: () => number;
  newId?: () => string;
}

type Loaded<T> = { items: T[]; writable: boolean };

function load<T>(path: string, key: string, schema: z.ZodType<T>, now: () => number): Loaded<T> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { items: [], writable: true };
    // Unreadable (permissions, a folder in the way): nothing to back up, so never overwrite it.
    console.error(`workflows: cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? "error"}; changes will not be saved`);
    return { items: [], writable: false };
  }
  /** Keeps the original beside the file, then rewrites the file with what could be read, so the copy is made once.
   * When no copy can be made, the file is left as it is and never overwritten. */
  const recover = (why: string, items: T[]): Loaded<T> => {
    const copy = `${path}.corrupt-${now()}`;
    try {
      writeFileAtomic(copy, raw, { mode: 0o600 });
      writeFileAtomic(path, JSON.stringify({ version: VERSION, [key]: items }, null, 2), { mode: 0o600 });
      console.error(`workflows: ${why} in ${path}; kept a copy at ${copy}`);
      return { items, writable: true };
    } catch {
      console.error(`workflows: ${why} in ${path}; could not keep a copy, so changes will not be saved`);
      return { items, writable: false };
    }
  };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // JSON.parse errors can echo a fragment of the file, so they never reach the log.
    return recover("invalid JSON", []);
  }
  const list = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>)[key] : undefined;
  if ((data as { version?: unknown } | null)?.version !== VERSION || !Array.isArray(list)) {
    return recover("unexpected file shape", []);
  }
  const items: T[] = [];
  let dropped = 0;
  for (const entry of list) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) items.push(parsed.data);
    else dropped += 1;
  }
  return dropped ? recover(`${dropped} unreadable ${key === "runs" ? "run(s)" : "workflow(s)"}`, items) : { items, writable: true };
}

const issuesOf = (error: z.ZodError) => error.issues.map((issue) => `${issue.path.join(".") || "workflow"}: ${issue.message}`);

export function createWorkflowStore(dataDir: string, options: WorkflowStoreOptions = {}): WorkflowStore {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const wfFile = workflowsPath(dataDir);
  const runFile = runsPath(dataDir);
  const workflowsLoaded = load(wfFile, "workflows", workflowSchema, now);
  const runsLoaded = load(runFile, "runs", workflowRunSchema, now);
  let workflows = workflowsLoaded.items;
  let runs = runsLoaded.items;

  const write = (path: string, writable: boolean, body: object, durable: boolean) => {
    if (!writable) throw new Error(`Cannot save: ${path} could not be read at start`);
    mkdirSync(dataDir, { recursive: true });
    writeFileAtomic(path, JSON.stringify({ version: VERSION, ...body }, null, 2), { mode: 0o600, durable });
  };
  const commitWorkflows = (next: Workflow[]) => {
    write(wfFile, workflowsLoaded.writable, { workflows: next }, true);
    workflows = next;
  };
  const commitRuns = (next: WorkflowRun[]) => {
    write(runFile, runsLoaded.writable, { runs: next }, false);
    runs = next;
  };
  const copy = <T>(value: T): T => structuredClone(value);

  return {
    list: () => workflows.map(copy),
    get: (id) => {
      const found = workflows.find((w) => w.id === id);
      return found ? copy(found) : null;
    },
    save(input, baseRev) {
      if (input === null || typeof input !== "object" || Array.isArray(input)) throw new WorkflowInputError(["workflow: expected an object"]);
      const given = (input as { id?: unknown }).id;
      const existing = typeof given === "string" ? workflows.find((w) => w.id === given) : undefined;
      if ((existing?.rev ?? 0) !== baseRev) throw new WorkflowConflictError(existing?.rev ?? 0);
      const at = now();
      const parsed = workflowSchema.safeParse({
        ...input,
        id: typeof given === "string" ? given : newId(),
        rev: baseRev + 1,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      });
      if (!parsed.success) throw new WorkflowInputError(issuesOf(parsed.error));
      const saved = parsed.data;
      commitWorkflows(existing ? workflows.map((w) => (w.id === saved.id ? saved : w)) : [...workflows, saved]);
      return copy(saved);
    },
    delete(id, baseRev) {
      const existing = workflows.find((w) => w.id === id);
      if (!existing) return false;
      if (baseRev !== undefined && baseRev !== existing.rev) throw new WorkflowConflictError(existing.rev);
      commitWorkflows(workflows.filter((w) => w.id !== id));
      return true;
    },
    listRuns: (workflowId) => runs
      .filter((r) => workflowId === undefined || r.workflowId === workflowId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(copy),
    getRun: (id) => {
      const found = runs.find((r) => r.id === id);
      return found ? copy(found) : null;
    },
    saveRun(run) {
      const parsed = workflowRunSchema.safeParse(run);
      if (!parsed.success) throw new WorkflowInputError(issuesOf(parsed.error));
      const saved = parsed.data;
      const next = runs.some((r) => r.id === saved.id) ? runs.map((r) => (r.id === saved.id ? saved : r)) : [...runs, saved];
      while (next.length > MAX_RUNS) {
        const byAge = next.map((r, index) => ({ r, index })).sort((a, b) => a.r.startedAt - b.r.startedAt);
        const victim = byAge.find(({ r }) => r.status !== "running" && r.id !== saved.id) ?? byAge.find(({ r }) => r.id !== saved.id)!;
        next.splice(victim.index, 1);
      }
      commitRuns(next);
      return copy(saved);
    },
    deleteRuns(workflowId) {
      const kept = runs.filter((r) => r.workflowId !== workflowId);
      const removed = runs.length - kept.length;
      if (removed) commitRuns(kept);
      return removed;
    },
    failInterruptedRuns(reason) {
      const at = now();
      let count = 0;
      const next = runs.map((r) => {
        if (r.status !== "running") return r;
        count += 1;
        return {
          ...r, status: "failed" as const, reason, endedAt: at,
          steps: r.steps.map((s) => s.status === "running" ? { ...s, status: "failed" as const, error: reason, endedAt: at }
            : s.status === "pending" ? { ...s, status: "skipped" as const } : s),
        };
      });
      if (count) commitRuns(next);
      return count;
    },
  };
}
