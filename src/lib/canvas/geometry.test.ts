import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW, MAX_SCALE, MIN_SCALE, bezierPath, boundsOf, centerOn, clampScale, edgeLabelPoint, fitRects, portPoint, screenToWorld,
  simplifyStroke, worldToScreen, zoomAt,
} from "./geometry";

describe("canvas geometry", () => {
  it("screenToWorld and worldToScreen are inverses", () => {
    const view = { x: 30, y: -40, scale: 1.5 };
    expect(screenToWorld(view, { x: 60, y: 20 })).toEqual({ x: 20, y: 40 });
    expect(worldToScreen(view, { x: 20, y: 40 })).toEqual({ x: 60, y: 20 });
  });

  it("zoomAt keeps the point under the cursor fixed", () => {
    const v = zoomAt({ x: 10, y: 20, scale: 1 }, 2, { x: 110, y: 120 });
    expect(v.scale).toBe(2);
    expect(worldToScreen(v, screenToWorld({ x: 10, y: 20, scale: 1 }, { x: 110, y: 120 }))).toEqual({ x: 110, y: 120 });
  });

  it("zoomAt never leaves [0.2, 2.5]", () => {
    expect(zoomAt(DEFAULT_VIEW, 100, { x: 0, y: 0 }).scale).toBe(2.5);
    expect(zoomAt(DEFAULT_VIEW, 0.0001, { x: 0, y: 0 }).scale).toBe(0.2);
    expect([MIN_SCALE, MAX_SCALE]).toEqual([0.2, 2.5]);
  });

  it("clampScale turns a broken value into 1", () => {
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampScale(0.8)).toBe(0.8);
  });

  it("boundsOf covers every rect, and nothing gives null", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ x: 10, y: 10, w: 20, h: 20 }, { x: -5, y: 50, w: 10, h: 10 }])).toEqual({ x: -5, y: 10, w: 35, h: 50 });
  });

  it("fitRects of nothing is the default view, never NaN", () => {
    expect(fitRects([], { w: 800, h: 600 })).toEqual(DEFAULT_VIEW);
    expect(fitRects([{ x: 0, y: 0, w: 100, h: 100 }], { w: 0, h: 0 })).toEqual(DEFAULT_VIEW);
  });

  it("fitRects centres the bounds with padding and caps the scale at 1", () => {
    const small = fitRects([{ x: 100, y: 100, w: 200, h: 100 }], { w: 800, h: 600 });
    expect(small.scale).toBe(1);
    expect(worldToScreen(small, { x: 200, y: 150 })).toEqual({ x: 400, y: 300 });

    const big = fitRects([{ x: 0, y: 0, w: 2000, h: 500 }], { w: 1096, h: 600 }, 48);
    expect(big.scale).toBe(0.5);
    expect(worldToScreen(big, { x: 0, y: 0 }).x).toBe(48);
    expect(worldToScreen(big, { x: 1000, y: 250 })).toEqual({ x: 548, y: 300 });

    const point = fitRects([{ x: 50, y: 50, w: 0, h: 0 }], { w: 800, h: 600 });
    expect(point).toEqual({ x: 350, y: 250, scale: 1 });
  });

  it("centerOn puts a world point at the middle of the viewport at the same scale", () => {
    const v = centerOn({ x: 0, y: 0, scale: 2 }, { x: 100, y: 50 }, { w: 800, h: 600 });
    expect(v.scale).toBe(2);
    expect(worldToScreen(v, { x: 100, y: 50 })).toEqual({ x: 400, y: 300 });
  });

  it("portPoint spreads several ports evenly on a side", () => {
    const r = { x: 0, y: 0, w: 200, h: 120 };
    expect(portPoint(r, "left")).toEqual({ x: 0, y: 60 });
    expect(portPoint(r, "right", 0, 2)).toEqual({ x: 200, y: 40 });
    expect(portPoint(r, "right", 1, 2)).toEqual({ x: 200, y: 80 });
    expect(portPoint(r, "top", 0, 3)).toEqual({ x: 50, y: 0 });
    expect(portPoint(r, "bottom", 2, 3)).toEqual({ x: 150, y: 120 });
  });

  it("bezierPath from a right port to a left port is a horizontal cubic curve", () => {
    const d = bezierPath({ x: 0, y: 0, side: "right" }, { x: 100, y: 0, side: "left" });
    expect(d).toMatch(/^M0 0 C/);
    const nums = d.replace(/[MC,]/g, " ").trim().split(/\s+/).map(Number);
    expect(nums).toHaveLength(8);
    expect([nums[3], nums[5], nums[7]]).toEqual([0, 0, 0]);
    expect(nums[2]).toBeGreaterThan(0);
    expect(nums[4]).toBeLessThan(100);
    expect(nums[6]).toBe(100);
  });

  it("bezierPath leaves a bottom port downwards and enters a top port from above", () => {
    const nums = bezierPath({ x: 0, y: 0, side: "bottom" }, { x: 0, y: 200, side: "top" }).replace(/[MC,]/g, " ").trim().split(/\s+/).map(Number);
    expect(nums[3]).toBeGreaterThan(0);
    expect(nums[5]).toBeLessThan(200);
  });

  it("edgeLabelPoint sits on the middle of a symmetric curve", () => {
    expect(edgeLabelPoint({ x: 0, y: 0, side: "right" }, { x: 100, y: 40, side: "left" })).toEqual({ x: 50, y: 20 });
  });

  it("simplifyStroke keeps the ends and drops collinear points", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 2 }));
    expect(simplifyStroke(line)).toEqual([{ x: 0, y: 0 }, { x: 49, y: 98 }]);
    const corner = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }];
    expect(simplifyStroke(corner)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(simplifyStroke([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
  });

  it("simplifyStroke handles a long stroke without running out of stack", () => {
    const wave = Array.from({ length: 20000 }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 50 }));
    const out = simplifyStroke(wave);
    expect(out[0]).toEqual(wave[0]);
    expect(out[out.length - 1]).toEqual(wave[wave.length - 1]);
    expect(out.length).toBeLessThan(wave.length);
  });
});
