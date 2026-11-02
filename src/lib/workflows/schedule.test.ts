import { describe, expect, it } from "vitest";

import { nextRunAt, scheduleOfKind } from "./schedule";

const PARIS = "Europe/Paris";
// Monday 2 November 2026, 10:00 in Paris (UTC+1).
const now = Date.UTC(2026, 10, 2, 9, 0);

describe("workflow trigger schedule", () => {
  it("a trigger started by hand has no next run", () => {
    expect(nextRunAt({ mode: "manual" }, now, PARIS)).toBeNull();
    expect(nextRunAt({ mode: "schedule" }, now, PARIS)).toBeNull();
  });

  it("every day at HH:MM: today if still ahead, else tomorrow", () => {
    expect(nextRunAt({ mode: "schedule", schedule: { kind: "daily", at: "11:30" } }, now, PARIS)).toBe(Date.UTC(2026, 10, 2, 10, 30));
    expect(nextRunAt({ mode: "schedule", schedule: { kind: "daily", at: "09:00" } }, now, PARIS)).toBe(Date.UTC(2026, 10, 3, 8, 0));
  });

  it("on chosen days of the week only", () => {
    // 0 = Sunday … 6 = Saturday; Monday 10:00 → next Wednesday 08:00.
    expect(nextRunAt({ mode: "schedule", schedule: { kind: "weekdays", at: "08:00", days: [3, 5] } }, now, PARIS)).toBe(Date.UTC(2026, 10, 4, 7, 0));
    expect(nextRunAt({ mode: "schedule", schedule: { kind: "weekdays", at: "08:00", days: [] } }, now, PARIS)).toBeNull();
  });

  it("once: that day and time, or nothing once it is past", () => {
    expect(nextRunAt({ mode: "schedule", schedule: { kind: "once", at: "18:00", date: "2026-11-20" } }, now, PARIS)).toBe(Date.UTC(2026, 10, 20, 17, 0));
    expect(nextRunAt({ mode: "schedule", schedule: { kind: "once", at: "18:00", date: "2026-10-20" } }, now, PARIS)).toBeNull();
    expect(nextRunAt({ mode: "schedule", schedule: { kind: "once", at: "18:00" } }, now, PARIS)).toBeNull();
  });

  it("an interval has no fixed time to show before the app plans it", () => {
    expect(nextRunAt({ mode: "schedule", schedule: { kind: "interval", everyMinutes: 30 } }, now, PARIS)).toBeNull();
  });

  it("switching the kind keeps the time and fills sensible defaults", () => {
    expect(scheduleOfKind("daily", undefined, "2026-11-02")).toEqual({ kind: "daily", at: "09:00" });
    expect(scheduleOfKind("weekdays", { kind: "daily", at: "07:15" }, "2026-11-02")).toEqual({ kind: "weekdays", at: "07:15", days: [1, 2, 3, 4, 5] });
    expect(scheduleOfKind("interval", { kind: "daily", at: "07:15" }, "2026-11-02")).toEqual({ kind: "interval", everyMinutes: 60 });
    expect(scheduleOfKind("once", { kind: "daily", at: "07:15" }, "2026-11-02")).toEqual({ kind: "once", at: "07:15", date: "2026-11-02" });
  });
});
