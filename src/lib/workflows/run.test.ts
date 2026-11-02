import { describe, expect, it } from "vitest";

import type { WorkflowRun } from "../../../shared/workflows";
import { formatUsd, isRunning, runRefusal, runTotals, stepsByNode, upsertRun } from "./run";

const run = (id: string, startedAt: number, extra: Partial<WorkflowRun> = {}): WorkflowRun =>
  ({ id, workflowId: "w", status: "succeeded", steps: [], startedAt, ...extra });

describe("workflow runs", () => {
  it("indexes a run's steps by block", () => {
    const r = run("r1", 1, { steps: [{ nodeId: "a", status: "succeeded" }, { nodeId: "b", status: "running" }] });
    expect(stepsByNode(r)).toEqual({ a: { nodeId: "a", status: "succeeded" }, b: { nodeId: "b", status: "running" } });
    expect(stepsByNode(null)).toEqual({});
  });

  it("puts a run from a live frame in its place, newest first, and keeps at most the cap", () => {
    const list = [run("r2", 20), run("r1", 10)];
    expect(upsertRun(list, run("r3", 30)).map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
    const updated = upsertRun(list, run("r1", 10, { status: "failed" }));
    expect(updated.map((r) => [r.id, r.status])).toEqual([["r2", "succeeded"], ["r1", "failed"]]);
    expect(upsertRun(list, run("r0", 5), 2).map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("adds known costs and counts unknown ones apart, never as zero", () => {
    const r = run("r", 1, { steps: [
      { nodeId: "a", status: "succeeded", costUsd: 0.012 },
      { nodeId: "b", status: "succeeded", costUsd: null },
      { nodeId: "c", status: "failed", costUsd: 0.5 },
      { nodeId: "d", status: "skipped" },
    ] });
    expect(runTotals(r)).toEqual({ knownUsd: 0.512, unknownSteps: 1, doneSteps: 3 });
  });

  it("writes a cost in dollars for the reader's language, with small amounts kept readable", () => {
    expect(formatUsd(0.0123, "fr")).toBe("0,012\u00a0$");
    expect(formatUsd(1, "fr")).toBe("1,00\u00a0$");
    expect(formatUsd(1, "en")).toBe("$1.00");
    expect(formatUsd(0, "en")).toBe("$0.00");
  });

  it("tells a run still going from a finished one", () => {
    expect(isRunning(run("r", 1, { status: "running" }))).toBe(true);
    expect(isRunning(run("r", 1))).toBe(false);
    expect(isRunning(null)).toBe(false);
  });

  it("reads why the server refused to run, keeping the problems it names", () => {
    const problems = [{ nodeId: "a", code: "missing-setting", message_fr: "IA : écris la consigne.", message_en: "AI: write it." }];
    expect(runRefusal({ status: 400, body: { error: "Invalid", problems } })).toEqual({ kind: "invalid", problems });
    expect(runRefusal({ status: 409, body: { runId: "r1" } })).toEqual({ kind: "busy", runId: "r1" });
    expect(runRefusal({ status: 503 })).toEqual({ kind: "unavailable" });
    expect(runRefusal({ status: 404 })).toEqual({ kind: "gone" });
    expect(runRefusal(new Error("offline"))).toEqual({ kind: "error", message: "offline" });
  });
});
