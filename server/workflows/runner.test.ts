import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { StepRun, WorkflowInput, WorkflowRun } from "../../shared/workflows.ts";
import { createWorkflowRunner, WorkflowBusyError, WorkflowInvalidError, WorkflowNotFoundError, type WorkflowRunnerDeps } from "./runner.ts";
import type { StepDeps } from "./steps.ts";
import { createWorkflowStore, type WorkflowStore } from "./store.ts";

const base = process.env.OMB_TEST_TMP ?? "/tmp/claude-0/-home-claude/d16a11f4-bf84-5ccc-b733-9d95abe987d6/scratchpad";
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(base, "wf-runner-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

type N = { id: string; kind: string; data?: Record<string, unknown> };
function workflow(nodes: N[], wires: [string, string, string?][], extra: Partial<WorkflowInput> = {}): Omit<WorkflowInput, "createdAt" | "updatedAt"> {
  return {
    id: "w1",
    name: "Veille",
    nodes: nodes.map((n, i) => ({ id: n.id, kind: n.kind, x: i * 100, y: 0, data: n.data ?? {} })) as WorkflowInput["nodes"],
    edges: wires.map(([from, to, port], i) => ({ id: `e${i}`, from: { node: from, port: (port ?? "out") as "out" }, to: { node: to, port: "in" as const } })),
    ...extra,
  };
}

const trigger = { id: "t", kind: "trigger" };
const ai = (id: string, prompt = id) => ({ id, kind: "ai", data: { prompt } });

interface Harness {
  store: WorkflowStore;
  runner: ReturnType<typeof createWorkflowRunner>;
  calls: { kind: string; input: Record<string, unknown> }[];
  changes: WorkflowRun[];
  failures: { run: WorkflowRun; step: StepRun | null }[];
}

function setup(def: ReturnType<typeof workflow>, opts: { steps?: Partial<StepDeps>; deps?: Partial<WorkflowRunnerDeps>; dir?: string } = {}): Harness {
  const store = createWorkflowStore(opts.dir ?? tmp());
  store.save(def, 0);
  const calls: Harness["calls"] = [];
  const changes: WorkflowRun[] = [];
  const failures: Harness["failures"] = [];
  let id = 0;
  const steps: StepDeps = {
    generateText: async (input) => {
      calls.push({ kind: "ai", input });
      const prompt = input.prompt as string;
      return { text: `ai(${prompt.split("\n")[0]})`, costUsd: 0.01 };
    },
    runBot: async (input) => { calls.push({ kind: "bot", input }); return { text: "bot done", costUsd: 0.1 }; },
    askApproval: async (input) => { calls.push({ kind: "approval", input }); return "yes"; },
    notify: async (input) => { calls.push({ kind: "notify", input }); },
    postToBotChat: async (input) => { calls.push({ kind: "post", input }); },
    ...opts.steps,
  };
  const runner = createWorkflowRunner({
    store, steps, botExists: (b) => b === "b1", budgetAllows: () => true,
    newId: () => `r${++id}`,
    onRunChanged: (run) => changes.push(run),
    onRunFailed: (run, step) => failures.push({ run, step }),
    ...opts.deps,
  });
  return { store, runner, calls, changes, failures };
}

const statuses = (run: WorkflowRun) => Object.fromEntries(run.steps.map((s) => [s.nodeId, s.status]));
const stepOf = (run: WorkflowRun, id: string) => run.steps.find((s) => s.nodeId === id)!;

describe("workflow runner", () => {
  it("runs blocks in order and passes text along wires", async () => {
    const h = setup(workflow([ai("b", "second"), trigger, ai("a", "first"), { id: "s", kind: "send" }], [["t", "a"], ["a", "b"], ["b", "s"]]));
    const started = h.runner.start("w1", { source: "manual", text: "hello" });
    expect(started.status).toBe("running");
    expect(h.runner.active()).toEqual([started.id]);
    const run = await h.runner.settled(started.id);
    expect(run.status).toBe("succeeded");
    expect(statuses(run)).toEqual({ t: "succeeded", a: "succeeded", b: "succeeded", s: "succeeded" });
    expect(h.calls.map((c) => c.kind)).toEqual(["ai", "ai", "notify"]);
    expect(h.calls[0]!.input.prompt).toContain("hello");
    expect(stepOf(run, "b").input).toBe("ai(first)");
    expect(h.calls[2]!.input).toEqual({ title: "Veille", body: "ai(second)", runId: started.id });
    expect(h.store.getRun(started.id)).toEqual(run);
    expect(h.changes.at(-1)).toEqual(run);
    expect(h.runner.active()).toEqual([]);
    expect(h.failures).toEqual([]);
  });

  it("joins the text of several wires in wire order", async () => {
    const h = setup(workflow([trigger, ai("a"), ai("b"), { id: "s", kind: "send" }], [["t", "a"], ["t", "b"], ["b", "s"], ["a", "s"]]));
    const run = await h.runner.settled(h.runner.start("w1", { source: "manual" }).id);
    expect(stepOf(run, "s").output).toBe("ai(b)\n\nai(a)");
  });

  it("a branch not taken is skipped", async () => {
    const h = setup(workflow(
      [trigger, { id: "c", kind: "condition", data: { question: "Urgent ?" } }, ai("y"), ai("n"), { id: "s", kind: "send" }],
      [["t", "c"], ["c", "y", "yes"], ["c", "n", "no"], ["n", "s"]],
    ), { steps: { generateText: async (input) => ({ text: (input.prompt as string).startsWith("Answer") ? "NON" : "ai", costUsd: 0 }) } });
    const run = await h.runner.settled(h.runner.start("w1", { source: "manual", text: "mail" }).id);
    expect(statuses(run)).toEqual({ t: "succeeded", c: "succeeded", y: "skipped", n: "succeeded", s: "succeeded" });
    expect(stepOf(run, "c").port).toBe("no");
    expect(stepOf(run, "n").input).toBe("mail");
  });

  it("a failed step skips everything downstream", async () => {
    const h = setup(workflow([trigger, ai("a"), ai("b"), ai("c")], [["t", "a"], ["a", "b"], ["b", "c"]]), {
      steps: { generateText: async (input) => { if ((input.prompt as string).startsWith("b")) throw new Error("engine down"); return { text: "ok", costUsd: 0 }; } },
    });
    const run = await h.runner.settled(h.runner.start("w1", { source: "schedule" }).id);
    expect(run.status).toBe("failed");
    expect(statuses(run)).toEqual({ t: "succeeded", a: "succeeded", b: "failed", c: "skipped" });
    expect(stepOf(run, "b").error).toBe("engine down");
    expect(run.reason).toBe("engine down");
  });

  it("retry reruns the step and its downstream only", async () => {
    let fail = true;
    const h = setup(workflow([trigger, ai("a"), ai("b"), ai("c"), ai("x")], [["t", "a"], ["a", "b"], ["b", "c"], ["t", "x"]]), {
      steps: {
        generateText: async (input) => {
          const name = (input.prompt as string).split("\n")[0]!;
          h.calls.push({ kind: name, input });
          if (name === "b" && fail) throw new Error("flaky");
          return { text: `out-${name}`, costUsd: 0.01 };
        },
      },
    });
    const first = await h.runner.settled(h.runner.start("w1", { source: "manual" }).id);
    expect(statuses(first)).toEqual({ t: "succeeded", a: "succeeded", b: "failed", c: "skipped", x: "skipped" });
    fail = false;
    h.calls.length = 0;
    const retried = h.runner.retryFrom(first.id, "b");
    expect(retried.id).not.toBe(first.id);
    const run = await h.runner.settled(retried.id);
    expect(h.calls.map((c) => c.kind)).toEqual(["b", "c"]);
    expect(run.status).toBe("succeeded");
    expect(statuses(run)).toEqual({ t: "succeeded", a: "succeeded", b: "succeeded", c: "succeeded", x: "skipped" });
    expect(stepOf(run, "b").input).toBe("out-a");
    expect(stepOf(run, "c").input).toBe("out-b");
    expect(h.store.getRun(first.id)?.status).toBe("failed");
  });

  it("runs one step with the input of the last run", async () => {
    const h = setup(workflow([trigger, ai("a"), ai("b")], [["t", "a"], ["a", "b"]]));
    expect(() => h.runner.runStep("w1", "b")).not.toThrow();
    await h.runner.settled("r1");
    const before = (await h.runner.settled(h.runner.start("w1", { source: "manual" }).id));
    expect(stepOf(before, "b").input).toBe("ai(a)");
    h.calls.length = 0;
    const one = await h.runner.settled(h.runner.runStep("w1", "b").id);
    expect(one.steps.map((s) => s.nodeId)).toEqual(["b"]);
    expect(stepOf(one, "b")).toMatchObject({ status: "succeeded", input: "ai(a)", output: "ai(b)" });
    expect(h.calls).toHaveLength(1);
    expect(() => h.runner.runStep("w1", "nope")).toThrow(WorkflowNotFoundError);
  });

  it("cancel stops the run and interrupts the bot", async () => {
    let interrupted = false;
    let started!: () => void;
    const botStarted = new Promise<void>((resolve) => { started = resolve; });
    const h = setup(workflow([trigger, { id: "b", kind: "bot", data: { botId: "b1", instruction: "travaille" } }, ai("after")], [["t", "b"], ["b", "after"]]), {
      steps: {
        runBot: (input) => new Promise((_, reject) => {
          started();
          input.signal.addEventListener("abort", () => { interrupted = true; reject(new Error("aborted")); }, { once: true });
        }),
      },
    });
    const run = h.runner.start("w1", { source: "manual" });
    await botStarted;
    expect(h.runner.cancel(run.id)).toBe(true);
    expect(interrupted).toBe(true);
    const done = await h.runner.settled(run.id);
    expect(done.status).toBe("cancelled");
    expect(statuses(done)).toEqual({ t: "succeeded", b: "failed", after: "skipped" });
    expect(stepOf(done, "b").error).toBe("Stopped");
    expect(h.store.getRun(run.id)?.status).toBe("cancelled");
    expect(h.runner.cancel(run.id)).toBe(false);
    expect(h.runner.cancel("unknown")).toBe(false);
    expect(h.failures).toEqual([]);
    expect(h.runner.active()).toEqual([]);
  });

  it("cancel ends the run even when a step ignores the signal", async () => {
    const h = setup(workflow([trigger, { id: "b", kind: "bot", data: { botId: "b1", instruction: "x" } }], [["t", "b"]]), {
      steps: { runBot: () => new Promise(() => {}) },
    });
    const run = h.runner.start("w1", { source: "manual" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.runner.cancel(run.id);
    expect((await h.runner.settled(run.id)).status).toBe("cancelled");
  });

  it("stops at maxSteps", async () => {
    const h = setup(workflow([trigger, ai("a"), ai("b"), ai("c")], [["t", "a"], ["a", "b"], ["b", "c"]], { limits: { maxSteps: 2, maxCostUsd: 1 } }));
    const run = await h.runner.settled(h.runner.start("w1", { source: "manual" }).id);
    expect(run.status).toBe("failed");
    expect(run.reason).toBe("Limit of 2 steps reached");
    expect(statuses(run)).toEqual({ t: "succeeded", a: "succeeded", b: "skipped", c: "skipped" });
    expect(h.failures).toHaveLength(1);
    expect(h.failures[0]!.step?.nodeId).toBe("b");
  });

  it("stops when the known cost passes maxCostUsd, unknown costs never count as zero", async () => {
    const costs: Record<string, number | null> = { a: null, b: 0.6, c: 0.6, d: 0.01 };
    const h = setup(workflow([trigger, ai("a"), ai("b"), ai("c"), ai("d")], [["t", "a"], ["a", "b"], ["b", "c"], ["c", "d"]], { limits: { maxSteps: 20, maxCostUsd: 1 } }), {
      steps: { generateText: async (input) => { const name = (input.prompt as string).split("\n")[0]!; return { text: name, costUsd: costs[name]! }; } },
    });
    const run = await h.runner.settled(h.runner.start("w1", { source: "manual" }).id);
    expect(stepOf(run, "a").costUsd).toBeNull();
    expect(stepOf(run, "b").costUsd).toBe(0.6);
    expect(statuses(run)).toEqual({ t: "succeeded", a: "succeeded", b: "succeeded", c: "succeeded", d: "skipped" });
    expect(run.status).toBe("failed");
    expect(run.reason).toBe("Limit of $1 reached");
  });

  it("a known total at the limit does not stop the run", async () => {
    const h = setup(workflow([trigger, ai("a"), ai("b")], [["t", "a"], ["a", "b"]], { limits: { maxSteps: 20, maxCostUsd: 0.01 } }));
    const run = await h.runner.settled(h.runner.start("w1", { source: "manual" }).id);
    expect(statuses(run)).toEqual({ t: "succeeded", a: "succeeded", b: "succeeded" });
  });

  it("stops before a step when the app budget is spent", async () => {
    let spent = false;
    const h = setup(workflow([trigger, ai("a"), ai("b")], [["t", "a"], ["a", "b"]]), {
      steps: { generateText: async () => { spent = true; return { text: "x", costUsd: 0.01 }; } },
      deps: { budgetAllows: () => !spent },
    });
    const run = await h.runner.settled(h.runner.start("w1", { source: "manual" }).id);
    expect(statuses(run)).toEqual({ t: "succeeded", a: "succeeded", b: "skipped" });
    expect(run.reason).toBe("The app's monthly spend limit is reached");
  });

  it("refuses to start an invalid workflow", () => {
    const h = setup(workflow([trigger, { id: "b", kind: "bot", data: { botId: "gone", instruction: "x" } }], [["t", "b"]]));
    let error: unknown;
    try { h.runner.start("w1", { source: "manual" }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(WorkflowInvalidError);
    expect((error as WorkflowInvalidError).status).toBe(400);
    expect((error as WorkflowInvalidError).problems.map((p) => p.code)).toEqual(["unknown-bot"]);
    expect(h.store.listRuns()).toEqual([]);
    expect(() => h.runner.start("nope", { source: "manual" })).toThrow(WorkflowNotFoundError);
  });

  it("a second run of the same workflow is refused while the first runs", async () => {
    let release!: () => void;
    const h = setup(workflow([trigger, ai("a")], [["t", "a"]]), {
      steps: { generateText: () => new Promise((resolve) => { release = () => resolve({ text: "x", costUsd: 0 }); }) },
    });
    const first = h.runner.start("w1", { source: "manual" });
    let error: unknown;
    try { h.runner.start("w1", { source: "schedule" }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(WorkflowBusyError);
    expect((error as WorkflowBusyError).status).toBe(409);
    expect((error as WorkflowBusyError).runId).toBe(first.id);
    await new Promise((resolve) => setTimeout(resolve, 1));
    release();
    expect((await h.runner.settled(first.id)).status).toBe("succeeded");
    expect(() => h.runner.start("w1", { source: "manual" })).not.toThrow();
  });

  it("a run cut by a restart is marked failed, not resumed", async () => {
    const dir = tmp();
    const h = setup(workflow([trigger, { id: "b", kind: "bot", data: { botId: "b1", instruction: "x" } }], [["t", "b"]]), {
      dir, steps: { runBot: () => new Promise(() => {}) },
    });
    const run = h.runner.start("w1", { source: "schedule" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.store.getRun(run.id)?.status).toBe("running");

    const after = createWorkflowStore(dir);
    expect(after.failInterruptedRuns("The app restarted during this run")).toBe(1);
    let botCalls = 0;
    const runner = createWorkflowRunner({
      store: after, botExists: () => true, budgetAllows: () => true,
      steps: { ...({} as StepDeps), runBot: async () => { botCalls += 1; return { text: "", costUsd: 0 }; } },
    });
    expect(runner.active()).toEqual([]);
    const cut = after.getRun(run.id)!;
    expect(cut.status).toBe("failed");
    expect(cut.reason).toBe("The app restarted during this run");
    expect(statuses(cut)).toEqual({ t: "succeeded", b: "failed" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(botCalls).toBe(0);
  });

  it("notifies once when an unattended run fails", async () => {
    const h = setup(workflow([trigger, ai("a"), ai("b")], [["t", "a"], ["t", "b"]]), {
      steps: { generateText: async () => { throw new Error("down"); } },
    });
    const run = await h.runner.settled(h.runner.start("w1", { source: "schedule" }).id);
    expect(run.status).toBe("failed");
    expect(h.failures).toHaveLength(1);
    expect(h.failures[0]!.run.id).toBe(run.id);
    expect(h.failures[0]!.step?.nodeId).toBe("a");
  });

  it("writes its reasons in the app's language", async () => {
    await import("../server-line-packs.ts");
    const h = setup(workflow([trigger, ai("a"), ai("b")], [["t", "a"], ["a", "b"]], { limits: { maxSteps: 2, maxCostUsd: 1 } }), { deps: { language: () => "fr" } });
    const run = await h.runner.settled(h.runner.start("w1", { source: "manual" }).id);
    expect(run.reason).toBe("Limite de 2 étapes atteinte");
  });
});
