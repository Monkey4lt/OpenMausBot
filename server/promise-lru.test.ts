import { describe, expect, it } from "vitest";

import { PromiseLru } from "./promise-lru.ts";

describe("PromiseLru", () => {
  it("computes once per key and version, even when asked concurrently", async () => {
    const lru = new PromiseLru<number>(2);
    let runs = 0;
    const make = async () => { runs += 1; await Promise.resolve(); return runs; };
    expect(await Promise.all([lru.get("a", "v1", make), lru.get("a", "v1", make)])).toEqual([1, 1]);
    expect(await lru.get("a", "v2", make)).toBe(2);
    expect(runs).toBe(2);
  });

  it("evicts the least recently used key past its size", async () => {
    const lru = new PromiseLru<string>(2);
    let runs = 0;
    const make = (v: string) => async () => { runs += 1; return v; };
    await lru.get("a", "1", make("a"));
    await lru.get("b", "1", make("b"));
    await lru.get("a", "1", make("a"));
    await lru.get("c", "1", make("c"));
    expect(runs).toBe(3);
    await lru.get("a", "1", make("a"));
    expect(runs).toBe(3);
    await lru.get("b", "1", make("b"));
    expect(runs).toBe(4);
    expect(lru.size).toBe(2);
  });

  it("forgets a failure so the next call tries again", async () => {
    const lru = new PromiseLru<number>(4);
    await expect(lru.get("a", "1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await lru.get("a", "1", async () => 7)).toBe(7);
  });

  it("delete and clear drop entries", async () => {
    const lru = new PromiseLru<number>(4);
    await lru.get("a", "1", async () => 1);
    lru.delete("a");
    expect(await lru.get("a", "1", async () => 2)).toBe(2);
    lru.clear();
    expect(lru.size).toBe(0);
  });
});
