// Routines and runs as routines.json holds them, read back into the shapes RoutineManager works with: anything a hand
// edit or an older version left out of range is dropped, never trusted.
import { z } from "zod";

import type { RoutineRequestOperation } from "../shared/routine-request.ts";
import { ROUTINE_CHECKS, WORKFLOW_ROUTINE_BOT, type RoutineCheck } from "../shared/routines.ts";
import { ROUTINE_PARTS, type PartPair, type RoutinePart } from "./package-parts.ts";
import { loadAttachments, loadTimeoutMinutes } from "./routine-attachments.ts";
import { isRoutineHoldCause } from "./routine-holds.ts";
import { MAX_DATE_MS } from "./routine-intervals.ts";
import { loadSchedule } from "./routine-schedules.ts";
import type { Routine, RoutineGoalStatus, RoutinePackageStamp, RoutineRequestReceipt, RoutineRun, RoutineTarget } from "./routines.ts";

const persistedSourceThreadId = z.string().trim().min(1).optional().catch(undefined);

const HASH = /^[a-f0-9]{64}$/;
export function loadInstalledPackage(value: unknown): RoutinePackageStamp | undefined {
  if (!value || typeof value !== "object") return undefined;
  const stamp = value as Partial<RoutinePackageStamp>;
  if (typeof stamp.installId !== "string" || !/^[a-f0-9]{32}$/.test(stamp.installId) || typeof stamp.key !== "string" || !stamp.key || stamp.key.length > 80) return undefined;
  const parts = stamp.parts as Record<string, Partial<PartPair>> | undefined;
  if (!parts || typeof parts !== "object" || !ROUTINE_PARTS.every((part) => HASH.test(String(parts[part]?.r)) && HASH.test(String(parts[part]?.w)))) return undefined;
  return {
    installId: stamp.installId,
    key: stamp.key,
    parts: Object.fromEntries(ROUTINE_PARTS.map((part) => [part, { r: parts[part]!.r!, w: parts[part]!.w! }])) as Record<RoutinePart, PartPair>,
  };
}

/** Null for a target this version does not know (a newer version wrote it): the caller keeps that row on disk, unused.
 * A row with no target is an old bot routine. */
function loadTarget(value: unknown): RoutineTarget | null {
  if (value === undefined || value === null || value === "bot") return "bot";
  return value === "room-goal" || value === "workflow" ? value : null;
}

const WORKFLOW_ID = /^[\w-]{1,64}$/;
function loadWorkflowId(value: unknown, target: RoutineTarget): string | undefined {
  return target === "workflow" && typeof value === "string" && WORKFLOW_ID.test(value) ? value : undefined;
}

/** An older version reads a workflow routine as a bot one and may write it back so; its bot and workflow tell it apart. */
function rewrittenWorkflow(row: { target?: unknown; botId?: unknown; workflowId?: unknown }, target: RoutineTarget): RoutineTarget {
  return target === "bot" && row.botId === WORKFLOW_ROUTINE_BOT && typeof row.workflowId === "string" && WORKFLOW_ID.test(row.workflowId) ? "workflow" : target;
}

const ROUTINE_GOAL_STATUSES = new Set<RoutineGoalStatus>([
  "completed",
  "needs-input",
  "blocked",
  "limit-reached",
  "paused",
  "stopped",
  "failed",
]);

function loadGoalStatus(value: unknown, target: RoutineTarget): RoutineGoalStatus | undefined {
  return target === "room-goal" && typeof value === "string" && ROUTINE_GOAL_STATUSES.has(value as RoutineGoalStatus)
    ? value as RoutineGoalStatus
    : undefined;
}

function loadGroupId(value: unknown, target: RoutineTarget): string | undefined {
  if (target !== "room-goal" || typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

/** Known checks, each once, in their own order; undefined when none. */
export function loadChecks(value: unknown): RoutineCheck[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const checks = ROUTINE_CHECKS.filter((check) => value.includes(check));
  return checks.length ? checks : undefined;
}

/** A routine's checks, access and delivery as it may hold them; a field out of range is left out. */
export function withCheckFields<T extends Pick<Routine, "target" | "checks" | "access" | "deliver">>(routine: T): T {
  const clean = { ...routine, checks: routine.target === "bot" ? loadChecks(routine.checks) : undefined,
    access: routine.access === "read-and-draft" ? "read-and-draft" as const : undefined,
    deliver: routine.target === "bot" && routine.deliver === "brief" ? "brief" as const : undefined };
  return withoutUndefined(clean, ["checks", "access", "deliver"]);
}

const instant = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_DATE_MS ? value as number : undefined;

function withoutUndefined<T extends object>(record: T, keys: ReadonlyArray<keyof T>): T {
  for (const key of keys) if (record[key] === undefined) delete record[key];
  return record;
}

/** Null when its schedule or its target cannot load: the caller keeps it on disk, unscheduled. */
export function loadRoutine(routine: Routine, now: number): Routine | null {
  const schedule = loadSchedule(routine.schedule, now);
  const known = loadTarget(routine.target);
  if (!schedule || !known) return null;
  const target = rewrittenWorkflow(routine, known);
  const workflowId = loadWorkflowId(routine.workflowId, target);
  if (target === "workflow" && !workflowId) return null;
  const loaded: Routine = {
    ...routine,
    schedule,
    target,
    groupId: loadGroupId(routine.groupId, target),
    workflowId,
    runOn: routine.runOn ?? "maus",
    timeoutMinutes: loadTimeoutMinutes(routine.timeoutMinutes),
    attachments: loadAttachments(routine.attachments),
    sourceThreadId: persistedSourceThreadId.parse(routine.sourceThreadId),
    resultsThreadId: persistedSourceThreadId.parse(routine.resultsThreadId),
    overlap: routine.overlap === "queue" ? "queue" : undefined,
    runOnStartup: routine.runOnStartup === true ? true : undefined,
    skippedRuns: Number.isSafeInteger(routine.skippedRuns) && routine.skippedRuns! > 0 ? routine.skippedRuns : undefined,
    lastSkippedAt: Number.isSafeInteger(routine.lastSkippedAt) && routine.lastSkippedAt! >= 0 && routine.lastSkippedAt! <= MAX_DATE_MS ? routine.lastSkippedAt : undefined,
    installedPackage: loadInstalledPackage(routine.installedPackage),
    checkedAt: instant(routine.checkedAt),
    checkTrouble: typeof routine.checkTrouble === "string" && routine.checkTrouble ? routine.checkTrouble.slice(0, 300) : undefined,
    wakeAt: instant(routine.wakeAt),
    heldFor: isRoutineHoldCause(routine.heldFor) ? routine.heldFor : undefined,
  };
  delete loaded.failureStreak;
  return withCheckFields(withoutUndefined(loaded, ["workflowId", "timeoutMinutes", "runOnStartup", "installedPackage", "checkedAt", "checkTrouble", "wakeAt", "heldFor"]));
}

/** Null for a run of a target this version does not know: the caller keeps it on disk, unused. */
export function loadRun(run: RoutineRun): RoutineRun | null {
  const known = loadTarget(run.target);
  if (!known) return null;
  const target = rewrittenWorkflow(run, known);
  const loaded: RoutineRun = {
    ...run,
    target,
    goalStatus: loadGoalStatus(run.goalStatus, target),
    groupId: loadGroupId(run.groupId, target),
    workflowId: loadWorkflowId(run.workflowId, target),
    runOn: run.runOn ?? "maus",
    timeoutMinutes: loadTimeoutMinutes(run.timeoutMinutes),
    attachments: loadAttachments(run.attachments),
    sourceThreadId: persistedSourceThreadId.parse(run.sourceThreadId),
    resultsThreadId: persistedSourceThreadId.parse(run.resultsThreadId),
    access: run.access === "read-and-draft" ? "read-and-draft" : undefined,
    deliver: run.deliver === "brief" ? "brief" : undefined,
    checkKey: typeof run.checkKey === "string" && /^[\w-]{1,128}$/.test(run.checkKey) ? run.checkKey : undefined,
  };
  return withoutUndefined(loaded, ["workflowId", "timeoutMinutes", "access", "deliver", "checkKey"]);
}

const REQUEST_ACTIONS = new Set<RoutineRequestOperation["action"]>(["create", "update", "pause", "resume", "run_now", "delete"]);

/** The applied routine-request receipts routines.json holds, each whole: one with a field out of shape is dropped. */
export function loadRequestReceipts(value: unknown): RoutineRequestReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.filter((receipt): receipt is RoutineRequestReceipt =>
    typeof receipt?.requestId === "string" &&
    typeof receipt?.messageId === "string" &&
    typeof receipt?.botId === "string" &&
    typeof receipt?.threadId === "string" &&
    REQUEST_ACTIONS.has(receipt?.action) &&
    receipt?.fingerprintVersion === 1 &&
    typeof receipt?.fingerprint === "string" && /^[a-f0-9]{64}$/.test(receipt.fingerprint) &&
    typeof receipt?.resultId === "string" &&
    Number.isFinite(receipt?.appliedAt));
}
