import { useState } from "react";
import { ChevronRight, RotateCcw, Square, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { nodeSummary } from "@/lib/workflows/editor";
import { formatUsd, runTotals } from "@/lib/workflows/run";
import type { LocaleKey } from "@/locales";
import type { RunStatus, StepRun, Workflow, WorkflowRun } from "../../../shared/workflows";
import { formatWhen } from "./NodeSettings";
import { KIND_ICON, KIND_LABEL, STEP_DOT, STEP_LABEL } from "./WorkflowNodeCard";

export const RUN_LABEL: Record<RunStatus, LocaleKey> = {
  running: "workflows.run.status.running", succeeded: "workflows.run.status.succeeded", failed: "workflows.run.status.failed", cancelled: "workflows.run.status.cancelled",
};
export const RUN_DOT: Record<RunStatus | "idle", string> = {
  running: "bg-accent animate-pulse", succeeded: "bg-success", failed: "bg-danger", cancelled: "bg-warning", idle: "bg-hairline",
};

function RunTotal({ run, locale }: { run: WorkflowRun; locale: string }) {
  const total = runTotals(run);
  const cost = formatUsd(total.knownUsd, locale);
  return <span className="tabular-nums">{total.unknownSteps ? t("workflows.history.costPlusUnknown", { cost, n: total.unknownSteps }) : cost}</span>;
}

function IoBlock({ title, text }: { title: string; text: string | undefined }) {
  return <div>
    <div className="mb-1 text-[12px] text-ink-tertiary">{title}</div>
    <pre data-canvas-scroll className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-control/70 px-3 py-2 font-sans text-[12.5px] leading-[18px] text-ink">
      {text?.trim() ? text : <span className="text-ink-tertiary">{t("workflows.details.nothing")}</span>}
    </pre>
  </div>;
}

export function StepDetails({ step, locale, onRetry }: { step: StepRun; locale: string; onRetry?: () => void }) {
  const seconds = step.startedAt && step.endedAt ? Math.max(0, Math.round((step.endedAt - step.startedAt) / 100) / 10) : null;
  return <div data-step-details className="flex flex-col gap-3 px-1 pb-2 pt-1">
    <IoBlock title={t("workflows.details.received")} text={step.input} />
    <IoBlock title={t("workflows.details.produced")} text={step.output} />
    {step.error && <div className="rounded-[10px] bg-danger/10 px-3 py-2 text-[12.5px] leading-snug text-danger">
      <div className="mb-0.5 font-medium">{t("workflows.details.error")}</div>{step.error}
    </div>}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-tertiary">
      <span className="tabular-nums">{t("workflows.details.cost", { cost: step.costUsd === null ? t("workflows.cost.unknown") : formatUsd(step.costUsd ?? 0, locale) })}</span>
      {seconds !== null && <span>{t("workflows.details.took", { s: seconds.toLocaleString(locale) })}</span>}
      {onRetry && <button type="button" onClick={onRetry} className="ml-auto flex h-7 items-center gap-1.5 rounded-[8px] bg-ink px-2.5 text-[12px] font-medium text-app hover:bg-ink/90">
        <RotateCcw size={12} />{t("workflows.retryStep")}
      </button>}
    </div>
    <p className="text-[11.5px] text-ink-tertiary">{t("workflows.details.kept")}</p>
  </div>;
}

/** Runs of the workflow: the one shown on the canvas with each step (click: what it received and produced), then the history. */
export function RunPanel({ workflow, runs, shown, openStep, onOpenStep, onShowRun, onRetry, onCancel, onClose, locale, timeZone }: {
  workflow: Workflow;
  runs: readonly WorkflowRun[];
  shown: WorkflowRun | null;
  openStep: string | null;
  onOpenStep: (nodeId: string | null) => void;
  onShowRun: (runId: string) => void;
  onRetry: (runId: string, nodeId: string) => void;
  onCancel: (runId: string) => void;
  onClose: () => void;
  locale: string;
  timeZone: string;
}) {
  const [historyOpen, setHistoryOpen] = useState(true);
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  return <aside data-run-panel aria-label={t("workflows.history.title")}
    className="absolute inset-x-0 bottom-0 z-30 flex max-h-[70%] flex-col overflow-hidden rounded-t-[16px] border border-hairline/70 bg-panel md:inset-x-auto md:bottom-auto md:right-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-[360px] md:rounded-[16px]">
    <div className="flex items-center gap-2 px-4 pb-2 pt-3">
      <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{t("workflows.history.title")}</h2>
      <button type="button" onClick={onClose} aria-label={t("workflows.details.close")} title={t("workflows.details.close")}
        className="grid size-7 place-items-center rounded-lg text-ink-tertiary hover:bg-control hover:text-ink"><X size={15} /></button>
    </div>
    <div data-canvas-scroll className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {!shown && <p className="px-1 py-6 text-center text-[13px] text-ink-secondary">{t("workflows.history.none")}</p>}
      {shown && <section className="rounded-[14px] border border-hairline/70 bg-card p-1.5">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className={cn("size-2 shrink-0 rounded-full", RUN_DOT[shown.status])} />
          <span className="text-[13px] font-medium text-ink">{t(RUN_LABEL[shown.status])}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] tabular-nums text-ink-tertiary">{formatWhen(shown.startedAt, locale, timeZone)}</span>
          {shown.status === "running" && <button type="button" onClick={() => onCancel(shown.id)}
            className="flex h-7 items-center gap-1.5 rounded-[8px] border border-hairline/80 px-2 text-[12px] text-ink hover:bg-control"><Square size={11} />{t("workflows.stop")}</button>}
        </div>
        {shown.reason && <p className="mx-2 mb-1.5 rounded-[10px] bg-control/70 px-3 py-2 text-[12.5px] leading-snug text-ink-secondary">{shown.reason}</p>}
        <ul className="flex flex-col">
          {shown.steps.map((step) => {
            const node = byId.get(step.nodeId);
            const Icon = node ? KIND_ICON[node.kind] : null;
            const open = openStep === step.nodeId;
            return <li key={step.nodeId}>
              <button type="button" aria-expanded={open} onClick={() => onOpenStep(open ? null : step.nodeId)}
                className={cn("flex h-9 w-full items-center gap-2 rounded-[10px] px-2 text-left text-[12.5px] hover:bg-control/60", open && "bg-control/60")}>
                <span className={cn("size-2 shrink-0 rounded-full", STEP_DOT[step.status])} />
                {Icon && <Icon size={13} className="shrink-0 text-ink-secondary" />}
                <span className="shrink-0 font-medium text-ink">{node ? t(KIND_LABEL[node.kind]) : step.nodeId}</span>
                <span className="min-w-0 flex-1 truncate text-ink-tertiary">{node ? nodeSummary(node) : ""}</span>
                <span className="shrink-0 text-[11.5px] text-ink-tertiary">{t(STEP_LABEL[step.status])}</span>
                <ChevronRight size={13} className={cn("shrink-0 text-ink-tertiary transition-transform", open && "rotate-90")} />
              </button>
              {open && <StepDetails step={step} locale={locale}
                onRetry={step.status === "failed" && shown.status !== "running" ? () => onRetry(shown.id, step.nodeId) : undefined} />}
            </li>;
          })}
        </ul>
        <div className="flex justify-end px-2 pb-1 pt-1.5 text-[12px] text-ink-tertiary"><RunTotal run={shown} locale={locale} /></div>
      </section>}
      {runs.length > 0 && <section className="mt-3">
        <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}
          className="flex h-8 w-full items-center gap-1.5 px-1 text-left text-[12.5px] text-ink-tertiary hover:text-ink">
          <ChevronRight size={13} className={cn("transition-transform", historyOpen && "rotate-90")} />{t("workflows.history")}
          <span className="ml-auto tabular-nums">{runs.length}</span>
        </button>
        {historyOpen && <ul className="flex flex-col">
          {runs.map((run) => <li key={run.id}>
            <button type="button" aria-current={shown?.id === run.id} onClick={() => onShowRun(run.id)}
              className={cn("flex h-8 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[12.5px] hover:bg-control/60", shown?.id === run.id ? "bg-control/60 text-ink" : "text-ink-secondary")}>
              <span className={cn("size-2 shrink-0 rounded-full", RUN_DOT[run.status])} />
              <span className="min-w-0 flex-1 truncate tabular-nums">{formatWhen(run.startedAt, locale, timeZone)}</span>
              <span className="shrink-0 text-[11.5px] text-ink-tertiary"><RunTotal run={run} locale={locale} /></span>
            </button>
          </li>)}
        </ul>}
      </section>}
    </div>
  </aside>;
}
