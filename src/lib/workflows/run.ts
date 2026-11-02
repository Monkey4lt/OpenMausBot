import type { StepRun, WorkflowRun } from "../../../shared/workflows";
import type { WorkflowProblem } from "./editor";

export const RUNS_KEPT = 50;

export function stepsByNode(run: WorkflowRun | null | undefined): Record<string, StepRun> {
  const out: Record<string, StepRun> = {};
  for (const step of run?.steps ?? []) out[step.nodeId] = step;
  return out;
}

export function upsertRun(runs: readonly WorkflowRun[], run: WorkflowRun, cap = RUNS_KEPT): WorkflowRun[] {
  const others = runs.filter((r) => r.id !== run.id);
  return [...others, run].sort((a, b) => b.startedAt - a.startedAt).slice(0, cap);
}

/** Known costs added up; steps whose cost no one could tell are counted apart, never as zero. */
export function runTotals(run: WorkflowRun): { knownUsd: number; unknownSteps: number; doneSteps: number } {
  let knownUsd = 0, unknownSteps = 0, doneSteps = 0;
  for (const step of run.steps) {
    if (step.status !== "succeeded" && step.status !== "failed") continue;
    doneSteps++;
    if (step.costUsd === null) unknownSteps++;
    else if (typeof step.costUsd === "number") knownUsd += step.costUsd;
  }
  return { knownUsd: Math.round(knownUsd * 1e6) / 1e6, unknownSteps, doneSteps };
}

export function formatUsd(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value);
}

export function isRunning(run: WorkflowRun | null | undefined): boolean {
  return run?.status === "running";
}

export type RunRefusal =
  | { kind: "invalid"; problems: WorkflowProblem[] }
  | { kind: "busy"; runId?: string }
  | { kind: "unavailable" }
  | { kind: "gone" }
  | { kind: "error"; message: string };

/** Why POST …/run (or run-step, retry, cancel) was refused, from the error the API call threw. */
export function runRefusal(error: unknown): RunRefusal {
  const status = (error as { status?: unknown } | null)?.status;
  const body = (error as { body?: Record<string, unknown> } | null)?.body ?? {};
  if (status === 400 && Array.isArray(body.problems)) return { kind: "invalid", problems: body.problems as WorkflowProblem[] };
  if (status === 409) return typeof body.runId === "string" ? { kind: "busy", runId: body.runId } : { kind: "busy" };
  if (status === 503) return { kind: "unavailable" };
  if (status === 404) return { kind: "gone" };
  return { kind: "error", message: error instanceof Error ? error.message : String(error) };
}
