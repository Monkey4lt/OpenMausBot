import type { Ref } from "react";
import { Bot, Send, ShieldCheck, Sparkles, Split, StickyNote, TriangleAlert, Zap, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Rect } from "@/lib/canvas/geometry";
import { t } from "@/lib/i18n";
import { portsFor, problemText, type WorkflowProblem } from "@/lib/workflows/editor";
import { formatUsd } from "@/lib/workflows/run";
import type { LocaleKey } from "@/locales";
import type { NodeKind, StepRun, StepStatus, WorkflowNode } from "../../../shared/workflows";
import { NodeAction, NodeField, NodeFrame } from "../canvas/NodeFrame";
import { NodeSettings, type SettingsContext } from "./NodeSettings";

export const KIND_ICON: Record<NodeKind, LucideIcon> = { trigger: Zap, ai: Sparkles, bot: Bot, condition: Split, approval: ShieldCheck, send: Send, note: StickyNote };
export const KIND_LABEL: Record<NodeKind, LocaleKey> = {
  trigger: "workflows.kind.trigger", ai: "workflows.kind.ai", bot: "workflows.kind.bot", condition: "workflows.kind.condition",
  approval: "workflows.kind.approval", send: "workflows.kind.send", note: "workflows.kind.note",
};
export const STEP_LABEL: Record<StepStatus, LocaleKey> = {
  pending: "workflows.status.pending", running: "workflows.status.running", succeeded: "workflows.status.succeeded",
  failed: "workflows.status.failed", skipped: "workflows.status.skipped",
};
/** Theme tokens only, so every skin (Aurora included) colours runs its own way. */
export const STEP_DOT: Record<StepStatus, string> = {
  pending: "bg-ink-tertiary/60", running: "bg-accent animate-pulse", succeeded: "bg-success", failed: "bg-danger", skipped: "bg-hairline",
};
const STEP_CARD: Record<StepStatus, string> = {
  pending: "border-dashed border-ink-tertiary/50",
  running: "border-accent ring-[3px] ring-accent/20",
  succeeded: "border-success/70",
  failed: "border-danger/70 ring-[3px] ring-danger/15",
  skipped: "border-dashed border-hairline",
};

export function StepCost({ step, locale }: { step: StepRun; locale: string }) {
  if (step.costUsd === null) return <span>{t("workflows.cost.unknown")}</span>;
  if (typeof step.costUsd !== "number" || step.costUsd === 0) return null;
  return <span className="tabular-nums">{formatUsd(step.costUsd, locale)}</span>;
}

export function WorkflowNodeCard({ node, rect, selected, step, problems, ctx, busy, onSelect, onMove, onMoveEnd, onPatch, onDuplicate, onDelete, onRunAll, onRunStep, onRetry, onDetails, nodeRef }: {
  node: WorkflowNode;
  rect: Rect;
  selected: boolean;
  step?: StepRun;
  problems: readonly WorkflowProblem[];
  ctx: SettingsContext;
  /** A run of this workflow is going on: run buttons wait. */
  busy: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveEnd: (id: string, x: number, y: number) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRunAll: () => void;
  onRunStep: (id: string) => void;
  onRetry?: (id: string) => void;
  onDetails: (id: string) => void;
  nodeRef?: Ref<HTMLDivElement>;
}) {
  const Icon = KIND_ICON[node.kind];
  const failed = step?.status === "failed";
  const action = node.kind === "note" ? null
    : node.kind === "trigger" ? { label: t("workflows.trigger.runNow"), run: onRunAll }
    : failed && onRetry ? { label: t("workflows.retryStep"), run: () => onRetry(node.id) }
    : { label: t("workflows.runStep"), run: () => onRunStep(node.id) };
  return <NodeFrame id={node.id} nodeRef={nodeRef} rect={rect} autoHeight selected={selected} locked={false}
    ports={portsFor(node.kind)} onSelect={onSelect} onMove={onMove} onMoveEnd={onMoveEnd}
    label={{ icon: Icon, text: t(KIND_LABEL[node.kind]) }}
    actions={ctx.readOnly ? undefined : { onDuplicate: () => onDuplicate(node.id), onDelete: () => onDelete(node.id) }}
    className={cn(step?.status === "skipped" && "opacity-60")}
    cardClassName={cn(step && STEP_CARD[step.status], node.kind === "note" && "bg-warning/10 border-warning/30")}>
    <NodeSettings node={node} ctx={ctx} onPatch={(patch) => onPatch(node.id, patch)} />
    {problems.length > 0 && <NodeField data-node-problems className="flex flex-col gap-1 bg-danger/10 py-1.5 text-[12px] leading-snug text-danger">
      {problems.map((problem, index) => <p key={index} className="flex gap-1.5"><TriangleAlert size={13} className="mt-[3px] shrink-0" />{problemText(problem, ctx.locale)}</p>)}
    </NodeField>}
    {step && <button type="button" data-step-status={step.status} onClick={() => onDetails(node.id)} title={t("workflows.details")}
      className="flex h-7 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[12px] text-ink-secondary hover:bg-ink/[0.05]">
      <span className={cn("size-2 shrink-0 rounded-full", STEP_DOT[step.status])} />
      <span className="font-medium text-ink">{t(STEP_LABEL[step.status])}</span>
      <span className="min-w-0 flex-1 truncate text-ink-tertiary"><StepCost step={step} locale={ctx.locale} /></span>
      <span className="shrink-0 text-ink-tertiary underline-offset-2 hover:underline">{t("workflows.details")}</span>
    </button>}
    {action && !ctx.readOnly && <NodeAction disabled={busy} onClick={action.run}>{action.label}</NodeAction>}
  </NodeFrame>;
}
