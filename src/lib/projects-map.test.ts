import { describe, expect, it } from "vitest";

import { arrangeByGroup, edgePoint, groupZone, type Rect } from "./projects-map";

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
    expect(pos.a3).toEqual({ x: 1080, y: 90 });
    expect(pos.a4).toEqual({ x: 60, y: 226 });
    expect(pos.b0).toEqual({ x: 60, y: 476 });
    expect(Object.keys(pos)).toHaveLength(6);
  });

  it("arrangeByGroup uses the tallest block of a row for the next row", () => {
    const pos = arrangeByGroup([[{ id: "a", h: 50 }, { id: "b", h: 300 }, { id: "c", h: 10 }, { id: "d", h: 10 }, { id: "e", h: 10 }]]);
    expect(pos.e).toEqual({ x: 60, y: 90 + 300 + 36 });
  });
});
