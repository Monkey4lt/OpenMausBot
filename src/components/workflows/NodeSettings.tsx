import type { ReactNode, TextareaHTMLAttributes } from "react";
import { ChevronDown, Clock, Gauge, Play, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { scheduleOfKind, triggerNext, type TriggerNext } from "@/lib/workflows/schedule";
import type { NodeData, WorkflowNode, WorkflowSchedule } from "../../../shared/workflows";
import { NodeField } from "../canvas/NodeFrame";

export type BotOption = { id: string; name: string; color?: string };
export type ModelOption = { value: string; label: string; group: string };

type Patch = (patch: Record<string, unknown>) => void;
export type EngineOption = { engine: string; name: string; resetsAt: number | null };
export type TriggerRoutine = { enabled: boolean; nextRunAt: number | null };
export type SettingsContext = {
  bots: readonly BotOption[]; models: readonly ModelOption[]; now: number; timeZone: string; locale: string; readOnly?: boolean;
  /** The AIs whose usage limit a trigger can wait for. */
  engines?: readonly EngineOption[];
  /** The routine the app made for a scheduled trigger (null: none), and why it could not, in plain words. */
  routine?: TriggerRoutine | null;
  routineError?: string;
};

const fieldText = "w-full resize-none bg-transparent text-[13px] leading-[19px] text-ink outline-none placeholder:text-ink-tertiary";

export function NodeTextarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(fieldText, className)} />;
}

/** A compact native select drawn as a quiet pill: the browser's own list stays usable by keyboard and on phones. */
export function PillSelect({ value, onChange, label, children, className, strong = true, disabled }: {
  value: string; onChange: (value: string) => void; label: string; children: ReactNode; className?: string; strong?: boolean; disabled?: boolean;
}) {
  return <span className={cn("relative inline-flex min-w-0 items-center", className)}>
    <select value={value} aria-label={label} title={label} disabled={disabled} onChange={(event) => onChange(event.target.value)}
      className={cn("h-7 min-w-0 cursor-pointer appearance-none truncate rounded-[8px] bg-transparent py-0 pl-1.5 pr-5 text-[12.5px] outline-none hover:bg-ink/[0.06] focus-visible:ring-1 focus-visible:ring-focus disabled:cursor-default",
        strong ? "font-medium text-ink" : "text-ink-secondary")}>
      {children}
    </select>
    <ChevronDown size={12} aria-hidden className="pointer-events-none absolute right-1 text-ink-tertiary" />
  </span>;
}

function ModelSelect({ value, onChange, models, emptyLabel, disabled }: { value: string | undefined; onChange: (value: string | undefined) => void; models: readonly ModelOption[]; emptyLabel: string; disabled?: boolean }) {
  const groups = [...new Set(models.map((m) => m.group))];
  const known = !value || models.some((m) => m.value === value);
  return <PillSelect value={value ?? ""} label={t("workflows.model.label")} disabled={disabled} className="max-w-[60%]" onChange={(next) => onChange(next || undefined)}>
    <option value="">{emptyLabel}</option>
    {!known && <option value={value}>{value}</option>}
    {groups.map((group) => <optgroup key={group} label={group}>
      {models.filter((m) => m.group === group).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
    </optgroup>)}
  </PillSelect>;
}

function BotSelect({ value, onChange, bots, disabled }: { value: string | undefined; onChange: (value: string) => void; bots: readonly BotOption[]; disabled?: boolean }) {
  const known = !value || bots.some((b) => b.id === value);
  const color = bots.find((b) => b.id === value)?.color;
  return <span className="flex min-w-0 items-center gap-1.5">
    <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", !value && "border border-dashed border-ink-tertiary")} style={value ? { background: color ?? "var(--color-success)" } : undefined} />
    <PillSelect value={value ?? ""} label={t("workflows.bot.label")} disabled={disabled} onChange={onChange} strong={Boolean(value)}>
      <option value="">{t("workflows.bot.pick")}</option>
      {!known && <option value={value}>{t("workflows.bot.unknown")}</option>}
      {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </PillSelect>
  </span>;
}

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_KEYS = ["workflows.day.0", "workflows.day.1", "workflows.day.2", "workflows.day.3", "workflows.day.4", "workflows.day.5", "workflows.day.6"] as const;
const DAY_NAMES = ["workflows.dayName.0", "workflows.dayName.1", "workflows.dayName.2", "workflows.dayName.3", "workflows.dayName.4", "workflows.dayName.5", "workflows.dayName.6"] as const;
const chip = "h-7 rounded-[8px] bg-ink/[0.06] px-2 text-[12.5px] font-medium text-ink outline-none focus-visible:ring-1 focus-visible:ring-focus";

function today(now: number, timeZone: string): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); } catch { return new Date(now).toISOString().slice(0, 10); }
}

export function formatWhen(at: number, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}

function TriggerSettings({ data, patch, ctx }: { data: NodeData<"trigger">; patch: Patch; ctx: SettingsContext }) {
  const s = data.schedule;
  const setSchedule = (next: WorkflowSchedule) => patch({ schedule: next });
  const next = triggerNext(data, ctx.routine, ctx.now, ctx.timeZone, ctx.engines ?? []);
  const nextText = nextLine(next, ctx);
  const engines = ctx.engines ?? [];
  const engineKnown = !data.engine || engines.some((e) => e.engine === data.engine);
  return <>
    <NodeField className="flex flex-col gap-0 p-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-warning/15 text-warning">
          {data.mode === "schedule" ? <Clock size={13} strokeWidth={2} /> : data.mode === "ai-reset" ? <Gauge size={13} strokeWidth={2} /> : <Play size={12} strokeWidth={2} />}
        </span>
        <PillSelect value={data.mode} label={t("workflows.trigger.mode")} disabled={ctx.readOnly} className="flex-1"
          onChange={(mode) => patch(mode === "schedule" ? { mode, schedule: s ?? scheduleOfKind("daily", undefined, today(ctx.now, ctx.timeZone)) }
            : mode === "ai-reset" ? { mode, engine: data.engine ?? engines[0]?.engine } : { mode })}>
          <option value="manual">{t("workflows.trigger.mode.manual")}</option>
          <option value="schedule">{t("workflows.trigger.mode.schedule")}</option>
          <option value="ai-reset">{t("workflows.trigger.mode.aiReset")}</option>
        </PillSelect>
      </div>
      {data.mode === "schedule" && s && <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline/50 px-3 py-2 text-[12.5px] text-ink-tertiary">
        <PillSelect value={s.kind} label={t("workflows.trigger.kind")} disabled={ctx.readOnly} className="rounded-[8px] bg-ink/[0.06]"
          onChange={(kind) => setSchedule(scheduleOfKind(kind as WorkflowSchedule["kind"], s, today(ctx.now, ctx.timeZone)))}>
          <option value="daily">{t("workflows.trigger.kind.daily")}</option>
          <option value="weekdays">{t("workflows.trigger.kind.weekdays")}</option>
          <option value="interval">{t("workflows.trigger.kind.interval")}</option>
          <option value="once">{t("workflows.trigger.kind.once")}</option>
        </PillSelect>
        {s.kind === "once" && <>
          <span>{t("workflows.trigger.on")}</span>
          <input type="date" value={s.date ?? ""} aria-label={t("workflows.trigger.date")} disabled={ctx.readOnly} className={chip}
            onChange={(event) => setSchedule({ ...s, date: event.target.value || undefined })} />
        </>}
        {s.kind === "interval"
          ? <label className="flex items-center gap-1.5">
              <input type="number" min={1} max={10080} value={s.everyMinutes ?? ""} aria-label={t("workflows.trigger.every")} disabled={ctx.readOnly} className={cn(chip, "w-16 tabular-nums")}
                onChange={(event) => { const n = Math.round(Number(event.target.value)); setSchedule({ ...s, everyMinutes: n >= 1 && n <= 10080 ? n : undefined }); }} />
              {t("workflows.trigger.minutes")}
            </label>
          : <>
              <span>{t("workflows.trigger.at")}</span>
              <input type="time" value={s.at ?? ""} aria-label={t("workflows.trigger.time")} disabled={ctx.readOnly} className={cn(chip, "tabular-nums")}
                onChange={(event) => setSchedule({ ...s, at: /^\d{2}:\d{2}$/.test(event.target.value) ? event.target.value : undefined })} />
            </>}
        {s.kind === "weekdays" && <div role="group" aria-label={t("workflows.trigger.days")} className="flex w-full gap-1 pt-1">
          {DAYS.map((day) => {
            const on = s.days?.includes(day) ?? false;
            return <button key={day} type="button" aria-pressed={on} aria-label={t(DAY_NAMES[day])} title={t(DAY_NAMES[day])} disabled={ctx.readOnly}
              className={cn("h-7 flex-1 rounded-[8px] text-[12px] font-medium", on ? "bg-ink text-app" : "bg-ink/[0.06] text-ink-secondary hover:text-ink")}
              onClick={() => setSchedule({ ...s, days: on ? (s.days ?? []).filter((d) => d !== day) : [...(s.days ?? []), day].sort() })}>
              {t(DAY_KEYS[day])}
            </button>;
          })}
        </div>}
      </div>}
      {data.mode === "ai-reset" && <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline/50 px-3 py-2 text-[12.5px] text-ink-tertiary">
        <span>{t("workflows.trigger.engine")}</span>
        <PillSelect value={data.engine ?? ""} label={t("workflows.trigger.engine")} disabled={ctx.readOnly} className="rounded-[8px] bg-ink/[0.06]"
          onChange={(engine) => patch({ engine: engine || undefined })}>
          <option value="">{t("workflows.trigger.engine.pick")}</option>
          {!engineKnown && <option value={data.engine}>{data.engine}</option>}
          {engines.map((e) => <option key={e.engine} value={e.engine}>{e.name}</option>)}
        </PillSelect>
      </div>}
      <div className="flex items-center justify-between gap-3 border-t border-hairline/50 px-3 py-2 text-[12.5px]">
        <span className="text-ink-tertiary">{t("workflows.trigger.next")}</span>
        <span data-next-run className="truncate font-medium tabular-nums text-ink">{nextText}</span>
      </div>
    </NodeField>
    {ctx.routineError && data.mode !== "manual" && <NodeField data-routine-error className="flex gap-1.5 bg-danger/10 py-1.5 text-[12px] leading-snug text-danger">
      <TriangleAlert size={13} className="mt-[3px] shrink-0" />{t("workflows.trigger.routineError", { reason: ctx.routineError })}
    </NodeField>}
  </>;
}

function nextLine(next: TriggerNext, ctx: SettingsContext): string {
  switch (next.kind) {
    case "manual": return t("workflows.trigger.nextManual");
    case "paused": return t("workflows.trigger.paused");
    case "none": return "—";
    case "at": return formatWhen(next.at, ctx.locale, ctx.timeZone);
    case "interval": return t("workflows.trigger.nextInterval", { n: next.minutes });
    case "reset": return next.at !== null ? formatWhen(next.at, ctx.locale, ctx.timeZone) : t("workflows.trigger.nextReset");
  }
}

function YesNoRows() {
  return <>
    <NodeField className="py-1.5 text-[12.5px] font-medium">{t("workflows.yes")}</NodeField>
    <NodeField className="py-1.5 text-[12.5px] font-medium">{t("workflows.no")}</NodeField>
  </>;
}

/** The settings of one block, inside its card. */
export function NodeSettings({ node, onPatch, ctx }: { node: WorkflowNode; onPatch: Patch; ctx: SettingsContext }) {
  const ro = ctx.readOnly;
  switch (node.kind) {
    case "trigger":
      return <TriggerSettings data={node.data} patch={onPatch} ctx={ctx} />;
    case "ai":
      return <>
        <NodeField className="flex flex-col gap-2 pb-1.5">
          <NodeTextarea rows={4} value={node.data.prompt} placeholder={t("workflows.ai.prompt")} aria-label={t("workflows.ai.prompt")} readOnly={ro}
            onChange={(event) => onPatch({ prompt: event.target.value })} />
          <div className="-mx-1.5 flex items-center justify-between">
            <ModelSelect value={node.data.model} models={ctx.models} emptyLabel={t("workflows.model.auto")} disabled={ro} onChange={(model) => onPatch({ model })} />
          </div>
        </NodeField>
        <NodeField>
          <NodeTextarea rows={1} value={node.data.system ?? ""} placeholder={t("workflows.ai.system")} aria-label={t("workflows.ai.system")} readOnly={ro}
            onChange={(event) => onPatch({ system: event.target.value || undefined })} />
        </NodeField>
      </>;
    case "bot":
      return <NodeField className="flex flex-col gap-2 pb-1.5">
        <NodeTextarea rows={4} value={node.data.instruction} placeholder={t("workflows.bot.instruction")} aria-label={t("workflows.bot.instruction")} readOnly={ro}
          onChange={(event) => onPatch({ instruction: event.target.value })} />
        <div className="-mx-1.5 flex items-center justify-between gap-2">
          <BotSelect value={node.data.botId} bots={ctx.bots} disabled={ro} onChange={(botId) => onPatch({ botId })} />
          <ModelSelect value={node.data.model} models={ctx.models} emptyLabel={t("workflows.model.bot")} disabled={ro} onChange={(model) => onPatch({ model })} />
        </div>
      </NodeField>;
    case "condition":
      return <>
        <NodeField>
          <NodeTextarea rows={2} value={node.data.question} placeholder={t("workflows.condition.question")} aria-label={t("workflows.condition.question")} readOnly={ro}
            onChange={(event) => onPatch({ question: event.target.value })} />
        </NodeField>
        <YesNoRows />
      </>;
    case "approval":
      return <>
        <NodeField>
          <NodeTextarea rows={2} value={node.data.message} placeholder={t("workflows.approval.message")} aria-label={t("workflows.approval.message")} readOnly={ro}
            onChange={(event) => onPatch({ message: event.target.value })} />
        </NodeField>
        <YesNoRows />
        <p className="px-1.5 text-[11.5px] text-ink-tertiary">{t("workflows.approval.hint")}</p>
      </>;
    case "send":
      return <NodeField className="flex flex-col gap-2 pb-1.5">
        <div className="-mx-1.5 flex flex-wrap items-center gap-2">
          <PillSelect value={node.data.to} label={t("workflows.send.to")} disabled={ro} onChange={(to) => onPatch({ to })}>
            <option value="notification">{t("workflows.send.to.notification")}</option>
            <option value="bot-chat">{t("workflows.send.to.botChat")}</option>
          </PillSelect>
          {node.data.to === "bot-chat" && <BotSelect value={node.data.botId} bots={ctx.bots} disabled={ro} onChange={(botId) => onPatch({ botId })} />}
        </div>
        <NodeTextarea rows={2} value={node.data.text ?? ""} placeholder={t("workflows.send.text")} aria-label={t("workflows.send.text")} readOnly={ro}
          onChange={(event) => onPatch({ text: event.target.value || undefined })} />
      </NodeField>;
    case "note":
      return <NodeTextarea rows={4} value={node.data.text} placeholder={t("atelier.note.placeholder")} aria-label={t("atelier.note.placeholder")} readOnly={ro}
        className="px-2 py-1.5" onChange={(event) => onPatch({ text: event.target.value })} />;
  }
}
