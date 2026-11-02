import type { RunStatus } from "../../../shared/workflows";

type Rect = { x: number; y: number; w: number; h: number };

/** One line of GET /api/workflows. */
export interface WorkflowSummary {
  id: string;
  name: string;
  projectId?: string;
  rev: number;
  updatedAt: number;
  lastRun?: { status: RunStatus; startedAt: number };
}

export type RunDot = RunStatus | "idle";

export const BADGE_H = 34;
export const BADGE_GAP = 14;
const BADGE_INSET = 20;
const BADGE_STACK = 6;

export function runDot(lastRun: WorkflowSummary["lastRun"]): RunDot {
  return lastRun?.status ?? "idle";
}

/** Small blocks hung under their project, one per attached workflow; a workflow whose project is not drawn is left out. */
export function projectWorkflowBadges(workflows: readonly WorkflowSummary[], projectRects: ReadonlyMap<string, Rect>) {
  const stacked = new Map<string, number>();
  return workflows.flatMap((w) => {
    const project = w.projectId ? projectRects.get(w.projectId) : undefined;
    if (!w.projectId || !project) return [];
    const index = stacked.get(w.projectId) ?? 0;
    stacked.set(w.projectId, index + 1);
    const rect = { x: project.x + BADGE_INSET, y: project.y + project.h + BADGE_GAP + index * (BADGE_H + BADGE_STACK), w: project.w - 2 * BADGE_INSET, h: BADGE_H };
    return [{ id: w.id, name: w.name, projectId: w.projectId, dot: runDot(w.lastRun), rect }];
  });
}

/** Room to keep under a project for its workflows when blocks are arranged. */
export function badgeStackHeight(count: number): number {
  return count ? BADGE_GAP + count * BADGE_H + (count - 1) * BADGE_STACK : 0;
}

type Badge = ReturnType<typeof projectWorkflowBadges>[number];

/** A short line from the bottom of each project to the first workflow hung under it. */
export function badgeHooks(badges: readonly Badge[], projectRects: ReadonlyMap<string, Rect>) {
  const seen = new Set<string>();
  return badges.flatMap((badge) => {
    const project = projectRects.get(badge.projectId);
    if (!project || seen.has(badge.projectId)) return [];
    seen.add(badge.projectId);
    const x = project.x + project.w / 2;
    return [{ id: `hook-${badge.projectId}`, from: { x, y: project.y + project.h, side: "bottom" as const }, to: { x, y: badge.rect.y, side: "top" as const } }];
  });
}

/** The list with the workflow's last run replaced by `run` when it is that run or a newer one. */
export function withRun(list: WorkflowSummary[], run: { id: string; workflowId: string; status: RunStatus; startedAt: number }): WorkflowSummary[] {
  const index = list.findIndex((w) => w.id === run.workflowId);
  const current = list[index]?.lastRun;
  if (index < 0 || (current && current.startedAt > run.startedAt)) return list;
  const next = [...list];
  next[index] = { ...list[index]!, lastRun: { status: run.status, startedAt: run.startedAt } };
  return next;
}
