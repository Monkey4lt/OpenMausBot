import { describe, expect, it } from "vitest";

import { BADGE_GAP, BADGE_H, badgeHooks, projectWorkflowBadges, runDot, withRun, type WorkflowSummary } from "./overview";

const summary = (id: string, extra: Partial<WorkflowSummary> = {}): WorkflowSummary => ({ id, name: id, rev: 1, updatedAt: 1, ...extra });

describe("workflows on the Atelier overview", () => {
  it("shows a workflow attached to its project with its last run state", () => {
    const rects = new Map([["p1", { x: 100, y: 50, w: 320, h: 200 }]]);
    const badges = projectWorkflowBadges([
      summary("w1", { projectId: "p1", lastRun: { status: "failed", startedAt: 5 } }),
      summary("w2", { projectId: "p1" }),
    ], rects);
    expect(badges).toEqual([
      { id: "w1", name: "w1", projectId: "p1", dot: "failed", rect: { x: 120, y: 250 + BADGE_GAP, w: 280, h: BADGE_H } },
      { id: "w2", name: "w2", projectId: "p1", dot: "idle", rect: { x: 120, y: 250 + BADGE_GAP + BADGE_H + 6, w: 280, h: BADGE_H } },
    ]);
  });

  it("a workflow whose project is gone is listed but not drawn", () => {
    const rects = new Map([["p1", { x: 0, y: 0, w: 320, h: 100 }]]);
    expect(projectWorkflowBadges([summary("w1", { projectId: "gone" }), summary("w2")], rects)).toEqual([]);
  });

  it("names the dot of every run state, idle before any run", () => {
    expect(runDot(undefined)).toBe("idle");
    expect(runDot({ status: "running", startedAt: 1 })).toBe("running");
    expect(runDot({ status: "succeeded", startedAt: 1 })).toBe("succeeded");
    expect(runDot({ status: "cancelled", startedAt: 1 })).toBe("cancelled");
  });

  it("hooks the first workflow under each project to it with a short line", () => {
    const rects = new Map([["p1", { x: 100, y: 50, w: 320, h: 200 }]]);
    const badges = projectWorkflowBadges([summary("w1", { projectId: "p1" }), summary("w2", { projectId: "p1" })], rects);
    expect(badgeHooks(badges, rects)).toEqual([{ id: "hook-p1", from: { x: 260, y: 250, side: "bottom" }, to: { x: 260, y: 250 + BADGE_GAP, side: "top" } }]);
  });

  it("a live run updates the last run of its workflow, never with an older one", () => {
    const list = [summary("w1", { lastRun: { status: "succeeded", startedAt: 10 } }), summary("w2")];
    const run = (startedAt: number, status: "running" | "failed") => ({ id: "r", workflowId: "w1", status, steps: [], startedAt });
    expect(withRun(list, run(20, "running"))[0]!.lastRun).toEqual({ status: "running", startedAt: 20 });
    expect(withRun(list, run(5, "failed"))).toBe(list);
    expect(withRun(list, { ...run(20, "running"), workflowId: "gone" })).toBe(list);
  });
});
