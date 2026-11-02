import { describe, expect, it } from "vitest";

import { createMapSync } from "./projects-map-sync";
import { arrangeByGroup, blockRect, blockRects, boundsOf, edgePoint, groupZone, linkEdges, openingView, placeBlock, type Rect } from "./projects-map";

const r: Rect = { x: 0, y: 0, w: 100, h: 50 };

describe("projects map geometry", () => {
  it("edgePoint leaves the right side for a target on the right", () => {
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 })).toEqual([108, 25]);
  });

  it("edgePoint leaves the bottom for a target below, with a custom gap", () => {
    expect(edgePoint(r, { x: 0, y: 400, w: 100, h: 50 }, 0)).toEqual([50, 50]);
  });

  it("edgePoint of two rects with the same center is the center", () => {
    expect(edgePoint(r, r)).toEqual([50, 25]);
  });

  it("groupZone wraps all rects with the label room on top", () => {
    expect(groupZone([{ x: 100, y: 100, w: 300, h: 200 }])).toEqual({ x: 78, y: 48, w: 344, h: 274 });
    expect(groupZone([{ x: 100, y: 100, w: 300, h: 200 }, { x: 500, y: 50, w: 100, h: 100 }])).toEqual({ x: 78, y: -2, w: 544, h: 324 });
  });

  it("groupZone of nothing is null", () => {
    expect(groupZone([])).toBeNull();
  });

  it("arrangeByGroup wraps after 4 blocks and leaves a gap between groups", () => {
    const first = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, h: 100 }));
    const pos = arrangeByGroup([first, [], [{ id: "b0", h: 100 }]]);
    expect(pos.a0).toEqual({ x: 60, y: 90 });
    expect(pos.a3).toEqual({ x: 1200, y: 90 });
    expect(pos.a4).toEqual({ x: 60, y: 226 });
    expect(pos.b0).toEqual({ x: 60, y: 476 });
    expect(Object.keys(pos)).toHaveLength(6);
  });

  it("arrangeByGroup uses the tallest block of a row for the next row", () => {
    const pos = arrangeByGroup([[{ id: "a", h: 50 }, { id: "b", h: 300 }, { id: "c", h: 10 }, { id: "d", h: 10 }, { id: "e", h: 10 }]]);
    expect(pos.e).toEqual({ x: 60, y: 90 + 300 + 36 });
  });

  it("boundsOf wraps every rect, and is null for none", () => {
    expect(boundsOf([{ x: 10, y: 20, w: 100, h: 50 }, { x: 300, y: 0, w: 40, h: 40 }])).toEqual({ x: 10, y: 0, w: 330, h: 70 });
    expect(boundsOf([])).toBeNull();
  });

});

describe("the projects map on the canvas", () => {
  const old = { zoom: 0.8, pos: { "s1:shop": { x: 40, y: 60 }, "s1:api": { x: 420, y: 60 } } };
  const sizes = { "s1:shop": { w: 320, h: 180 }, "s1:api": { w: 320, h: 240 } };
  const viewport = { w: 1200, h: 800 };

  it("an old saved map (no annotations, zoom 0.8) opens at scale 0.8 with every block at its saved position", () => {
    const rects = ["s1:shop", "s1:api"].map((id, i) => blockRect(old.pos, id, i, sizes[id as keyof typeof sizes]));
    expect(rects).toEqual([{ x: 40, y: 60, w: 320, h: 180 }, { x: 420, y: 60, w: 320, h: 240 }]);
    expect(openingView(null, old.zoom, rects, viewport)).toEqual({ x: 0, y: 0, scale: 0.8 });
  });

  it("a view remembered on this device wins; a map that does not fit at its zoom is fitted", () => {
    const stored = { x: -30, y: 12, scale: 1.4 };
    expect(openingView(stored, 0.8, [], viewport)).toEqual(stored);
    const far = [{ x: 40, y: 60, w: 320, h: 180 }, { x: 3000, y: 60, w: 320, h: 180 }];
    const view = openingView(null, 1, far, viewport);
    expect(view.scale).toBeLessThan(1);
    expect(view.x + 40 * view.scale).toBeGreaterThanOrEqual(0);
    expect(view.x + 3320 * view.scale).toBeLessThanOrEqual(viewport.w);
    expect(openingView(null, 0.8, [], viewport)).toEqual({ x: 0, y: 0, scale: 0.8 });
    expect(openingView(null, Number.NaN, [], viewport)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("a block without a saved position gets a spot in a grid", () => {
    expect(blockRect({}, "x", 5, undefined)).toEqual({ x: 50 + 380, y: 450, w: 320, h: 120 });
  });

  it("blocks without a saved position never overlap, however tall their file tree is, and keep a saved one where it is", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const tall = Object.fromEntries(ids.map((id, i) => [id, { w: 320, h: i === 1 ? 640 : 470 }]));
    const overlap = (r: Rect, o: Rect) => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h;
    const check = (map: Map<string, Rect>) => {
      const list = [...map.values()];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlap(list[i]!, list[j]!)).toBe(false);
    };
    check(blockRects({}, ids, tall));
    expect(blockRects({}, ids, tall).get("f")!.y).toBeGreaterThanOrEqual(50 + 640);
    // Before they are measured, a block is taken to be as tall as a full one, so the first frame does not overlap either.
    check(new Map([...blockRects({}, ids, {})].map(([id, r]) => [id, { ...r, h: 470 }])));
    expect(blockRects({ c: { x: 7, y: 9 } }, ids, tall).get("c")).toEqual({ x: 7, y: 9, w: 320, h: 470 });
  });

  it("dragging a block saves its world position through the existing save path with baseRev", async () => {
    const puts: unknown[] = [];
    const sync = createMapSync<typeof old & { rev: number }>({
      put: (body) => { puts.push(body); return Promise.resolve({ rev: body.baseRev + 1 }); },
      reload: () => {}, changedElsewhere: () => {}, status: () => {}, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {}, delayMs: 400,
    });
    const state = { ...old, rev: 7 };
    sync.loaded(state);
    const moved = placeBlock(state, "s1:api", -120.4, 333.6);
    expect(moved.pos["s1:api"]).toEqual({ x: -120, y: 334 });
    expect(moved.pos["s1:shop"]).toEqual(old.pos["s1:shop"]);
    sync.later(moved);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(puts).toEqual([{ ...moved, baseRev: 7 }]);
  });

  it("links become curved edges between the facing sides of their blocks, with an arrow and the label", () => {
    const rects = new Map([["a", { x: 0, y: 0, w: 320, h: 100 }], ["b", { x: 600, y: 0, w: 320, h: 100 }]]);
    const edges = linkEdges([{ a: "a", b: "b", label: "appelle" }, { a: "a", b: "gone", label: "" }], rects);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ id: "0", label: "appelle", arrow: "end", from: { x: 320, y: 50, side: "right" }, to: { x: 600, y: 50, side: "left" } });
  });
});

