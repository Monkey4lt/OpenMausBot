import { describe, expect, it } from "vitest";

import { createMapSync, type MapSyncDeps } from "./projects-map-sync";

type State = { rev: number; groups: string[] };

function setup(options: { put?: (body: unknown) => Promise<{ rev: number }> } = {}) {
  const puts: unknown[] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const events: string[] = [];
  const deps: MapSyncDeps<State> = {
    put: (body) => { puts.push(body); return options.put ? options.put(body) : Promise.resolve({ rev: (body as { baseRev: number }).baseRev + 1 }); },
    reload: () => { events.push("reload"); },
    changedElsewhere: () => { events.push("notice"); },
    status: (value) => { events.push(`status:${value}`); },
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) (timer as { cleared: boolean }).cleared = true; },
    delayMs: 400,
  };
  return { sync: createMapSync(deps), puts, timers, events };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the Projects page's saves", () => {
  it("sends the layout with the rev it was loaded at, then the rev the server answered", async () => {
    const { sync, puts, timers } = setup();
    sync.loaded({ rev: 3, groups: [] });
    sync.later({ rev: 3, groups: ["a"] });
    timers.at(-1)!.fn();
    await flush();
    expect(puts).toEqual([{ rev: 3, groups: ["a"], baseRev: 3 }]);
    await sync.now({ rev: 3, groups: ["a", "b"] });
    expect(puts.at(-1)).toEqual({ rev: 3, groups: ["a", "b"], baseRev: 4 });
    expect(sync.rev()).toBe(5);
  });

  it("a later save replaces the one still waiting", () => {
    const { sync, timers } = setup();
    sync.loaded({ rev: 0, groups: [] });
    sync.later({ rev: 0, groups: ["a"] });
    sync.later({ rev: 0, groups: ["b"] });
    expect(timers.map((t) => t.cleared)).toEqual([true, false]);
  });

  it("a projects.changed frame with a newer rev reloads and drops the pending save", () => {
    const { sync, timers, puts, events } = setup();
    sync.loaded({ rev: 2, groups: [] });
    sync.later({ rev: 2, groups: ["mine"] });
    sync.frame({ kind: "projects.changed", rev: 3 });
    expect(timers[0]!.cleared).toBe(true);
    expect(puts).toEqual([]);
    expect(events).toContain("reload");
    expect(events).toContain("notice");
    expect(events.at(-1)).toBe("status:idle");
  });

  it("ignores its own save's frame, an older one, and every other frame", async () => {
    const { sync, events } = setup();
    sync.loaded({ rev: 2, groups: [] });
    await sync.now({ rev: 2, groups: ["a"] });
    events.length = 0;
    sync.frame({ kind: "projects.changed", rev: 3 });
    sync.frame({ kind: "projects.changed", rev: 1 });
    sync.frame({ kind: "message", rev: 9 });
    sync.frame({ kind: "projects.changed" });
    expect(events).toEqual([]);
  });

  it("reloads quietly on a newer frame when nothing was waiting to save", () => {
    const { sync, events } = setup();
    sync.loaded({ rev: 2, groups: [] });
    sync.frame({ kind: "projects.changed", rev: 5 });
    expect(events).toEqual(["reload"]);
  });

  it("a 409 on save reloads and shows the map-changed notice", async () => {
    const stale = Object.assign(new Error("The map changed since it was loaded"), { status: 409 });
    const { sync, events } = setup({ put: () => Promise.reject(stale) });
    sync.loaded({ rev: 1, groups: [] });
    await expect(sync.now({ rev: 1, groups: ["a"] })).rejects.toThrow("The map changed");
    expect(events).toEqual(["status:saving", "reload", "notice", "status:idle"]);
  });

  it("another failure reports an error and does not reload", async () => {
    const { sync, events } = setup({ put: () => Promise.reject(Object.assign(new Error("boom"), { status: 500 })) });
    sync.loaded({ rev: 1, groups: [] });
    await expect(sync.now({ rev: 1, groups: [] })).rejects.toThrow("boom");
    expect(events).toEqual(["status:saving", "status:error"]);
    sync.later({ rev: 1, groups: [] });
  });

  it("a delayed save that hits a 409 reloads too, without throwing", async () => {
    const stale = Object.assign(new Error("stale"), { status: 409 });
    const { sync, timers, events } = setup({ put: () => Promise.reject(stale) });
    sync.loaded({ rev: 1, groups: [] });
    sync.later({ rev: 1, groups: ["a"] });
    timers[0]!.fn();
    await flush();
    expect(events).toEqual(["status:saving", "status:saving", "reload", "notice", "status:idle"]);
  });

  it("its own save's frame arriving before the save's answer neither reloads nor drops the next edit", async () => {
    let answer: (value: { rev: number }) => void = () => {};
    const { sync, timers, puts, events } = setup({ put: (body) => (puts.length === 1 ? new Promise((resolve) => { answer = resolve; }) : Promise.resolve({ rev: (body as { baseRev: number }).baseRev + 1 })) });
    sync.loaded({ rev: 2, groups: [] });
    const first = sync.now({ rev: 2, groups: ["a"] });
    sync.later({ rev: 2, groups: ["a", "b"] });
    sync.frame({ kind: "projects.changed", rev: 3 });
    answer({ rev: 3 });
    await first;
    expect(events).not.toContain("reload");
    expect(events).not.toContain("notice");
    expect(timers[0]!.cleared).toBe(false);
    timers[0]!.fn();
    await flush();
    expect(puts.at(-1)).toEqual({ rev: 2, groups: ["a", "b"], baseRev: 3 });
    expect(sync.rev()).toBe(4);
  });

  it("a frame held during a save still reloads when it is newer than the save's answer", async () => {
    let answer: (value: { rev: number }) => void = () => {};
    const { sync, timers, events } = setup({ put: () => new Promise((resolve) => { answer = resolve; }) });
    sync.loaded({ rev: 2, groups: [] });
    const first = sync.now({ rev: 2, groups: ["a"] });
    sync.later({ rev: 2, groups: ["a", "b"] });
    sync.frame({ kind: "projects.changed", rev: 4 });
    expect(events).not.toContain("reload");
    answer({ rev: 3 });
    await first;
    expect(events).toContain("reload");
    expect(events).toContain("notice");
    expect(timers[0]!.cleared).toBe(true);
  });

  it("a delayed save due while another is on its way waits for it and uses its rev", async () => {
    let answer: (value: { rev: number }) => void = () => {};
    const { sync, timers, puts } = setup({ put: (body) => (puts.length === 1 ? new Promise((resolve) => { answer = resolve; }) : Promise.resolve({ rev: (body as { baseRev: number }).baseRev + 1 })) });
    sync.loaded({ rev: 2, groups: [] });
    const first = sync.now({ rev: 2, groups: ["a"] });
    sync.later({ rev: 2, groups: ["b"] });
    timers[0]!.fn();
    await flush();
    expect(puts).toHaveLength(1);
    answer({ rev: 3 });
    await first;
    await flush();
    expect(puts.at(-1)).toEqual({ rev: 2, groups: ["b"], baseRev: 3 });
  });

  it("a reload that lands on an edit not saved yet shows the notice instead of dropping it silently", () => {
    const { sync, timers, events } = setup();
    sync.loaded({ rev: 2, groups: [] });
    sync.later({ rev: 2, groups: ["mine"] });
    events.length = 0;
    sync.loaded({ rev: 2, groups: [] });
    expect(timers[0]!.cleared).toBe(true);
    expect(events).toEqual(["notice", "status:idle"]);
  });
});
