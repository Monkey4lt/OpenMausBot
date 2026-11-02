import type { NodeData, WorkflowSchedule } from "../../../shared/workflows";

type TriggerData = Partial<NodeData<"trigger">>;

const WORKING_DAYS = [1, 2, 3, 4, 5];

/** When a scheduled trigger fires next, in the viewer's time zone; null when there is no fixed next time. */
export function nextRunAt(trigger: TriggerData, now: number, timeZone: string): number | null {
  if (trigger.mode !== "schedule" || !trigger.schedule) return null;
  const s = trigger.schedule;
  const time = /^(\d{2}):(\d{2})$/.exec(s.at ?? "");
  if (!time) return null;
  const [hour, minute] = [Number(time[1]), Number(time[2])];
  if (s.kind === "once") {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.date ?? "");
    if (!day) return null;
    const at = zonedTime(Number(day[1]), Number(day[2]), Number(day[3]), hour, minute, timeZone);
    return at > now ? at : null;
  }
  if (s.kind === "interval") return null;
  const days = s.kind === "weekdays" ? new Set(s.days ?? []) : null;
  if (days && !days.size) return null;
  const today = localParts(now, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (days && !days.has(date.getUTCDay())) continue;
    const at = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, timeZone);
    if (at > now) return at;
  }
  return null;
}

function localParts(at: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  }).formatToParts(at).map((part) => [part.type, Number(part.value)]));
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute! };
}

/** The instant a wall-clock time happens in `timeZone` (a time skipped by a clock change moves on by the gap). */
function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (at: number) => {
    const p = localParts(at, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(at / 60_000) * 60_000;
  };
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

/** The schedule after choosing another kind: the time is kept, the rest gets a sensible default. */
export function scheduleOfKind(kind: WorkflowSchedule["kind"], previous: WorkflowSchedule | undefined, today: string): WorkflowSchedule {
  const at = previous?.at ?? "09:00";
  switch (kind) {
    case "daily": return { kind, at };
    case "weekdays": return { kind, at, days: previous?.days?.length ? previous.days : WORKING_DAYS };
    case "interval": return { kind, everyMinutes: previous?.everyMinutes ?? 60 };
    case "once": return { kind, at, date: previous?.date ?? today };
  }
}

export function viewerTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}
