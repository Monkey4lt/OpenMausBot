import { describe, expect, it } from "vitest";

import { DEFAULT_VIEW, MAX_SCALE, MIN_SCALE, screenToWorld, worldToScreen } from "./geometry";
import { keyToView, parseStoredView, passedThreshold, startsPan, wheelToView } from "./gestures";

const wheel = (over: Partial<Parameters<typeof wheelToView>[1]> = {}) =>
  ({ deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0, ...over });

const target = (matches: string[]) => ({ closest: (sel: string) => (sel.split(",").some((s) => matches.includes(s.trim())) ? {} : null) });

describe("canvas gestures", () => {
  it("ctrl+wheel zooms around the cursor; plain wheel pans", () => {
    const view = { x: 20, y: 10, scale: 1 };
    const origin = { x: 100, y: 50 };
    const zoomed = wheelToView(view, wheel({ deltaY: -40, ctrlKey: true, clientX: 300, clientY: 250 }), origin);
    expect(zoomed.scale).toBeGreaterThan(1);
    const under = screenToWorld(view, { x: 200, y: 200 });
    const after = worldToScreen(zoomed, under);
    expect(Math.abs(after.x - 200) < 1e-9 && Math.abs(after.y - 200) < 1e-9).toBe(true);

    expect(wheelToView(view, wheel({ deltaY: 40, metaKey: true }), origin).scale).toBeLessThan(1);
    expect(wheelToView(view, wheel({ deltaX: 15, deltaY: 30 }), origin)).toEqual({ x: 5, y: -20, scale: 1 });
  });

  it("line-mode wheel deltas pan by lines, not pixels", () => {
    expect(wheelToView(DEFAULT_VIEW, wheel({ deltaY: 3, deltaMode: 1 }), { x: 0, y: 0 })).toEqual({ x: 0, y: -48, scale: 1 });
  });

  it("a burst of 50 small pinch events never leaves the scale bounds", () => {
    let up = DEFAULT_VIEW;
    let down = DEFAULT_VIEW;
    const scales: number[] = [];
    for (let i = 0; i < 50; i++) {
      up = wheelToView(up, wheel({ deltaY: -8, ctrlKey: true, clientX: 400, clientY: 300 }), { x: 0, y: 0 });
      down = wheelToView(down, wheel({ deltaY: 8, ctrlKey: true, clientX: 400, clientY: 300 }), { x: 0, y: 0 });
      scales.push(up.scale, down.scale);
    }
    expect(scales.every((s) => s >= MIN_SCALE && s <= MAX_SCALE && Number.isFinite(s))).toBe(true);
    expect(up.scale).toBe(MAX_SCALE);
    expect(down.scale).toBe(MIN_SCALE);
    for (let i = 1; i < 20; i++) expect(Math.abs(scales[2 * i] / scales[2 * i - 2] - 1)).toBeLessThan(0.2);

    const huge = wheelToView(DEFAULT_VIEW, wheel({ deltaY: -100000, ctrlKey: true }), { x: 0, y: 0 });
    expect(huge.scale).toBeLessThanOrEqual(2);
  });

  it("a press on a button, an input or a node never starts a pan with the select tool", () => {
    for (const sel of ["button", "input", "textarea", "select", "[contenteditable]", "[data-canvas-node]", "[data-canvas-edge]"]) {
      expect(startsPan(target([sel]), "select", 0, false), sel).toBe(false);
    }
    expect(startsPan(target([]), "select", 0, false)).toBe(true);
    expect(startsPan(null, "select", 0, false)).toBe(true);
    expect(startsPan(target([]), "select", 2, false)).toBe(false);
  });

  it("drawing tools never pan from the background", () => {
    for (const tool of ["pencil", "sticky", "shape", "text"] as const) expect(startsPan(target([]), tool, 0, false), tool).toBe(false);
  });

  it("the hand tool pans from anywhere; space+drag pans with any tool", () => {
    expect(startsPan(target(["button"]), "hand", 0, false)).toBe(true);
    expect(startsPan(target(["[data-canvas-node]"]), "hand", 0, false)).toBe(true);
    for (const tool of ["select", "pencil", "sticky", "shape", "text"] as const) {
      expect(startsPan(target(["[data-canvas-node]"]), tool, 0, true), tool).toBe(true);
    }
    expect(startsPan(target(["button"]), "pencil", 1, false)).toBe(true);
  });

  it("passedThreshold waits for 5 px", () => {
    expect(passedThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
    expect(passedThreshold({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
    expect(passedThreshold({ x: 0, y: 0 }, { x: 8, y: 0 }, 10)).toBe(false);
  });

  it("arrows pan 60 px, + and - zoom 1.2x, 0 fits", () => {
    const viewport = { w: 800, h: 600 };
    const view = { x: 0, y: 0, scale: 1 };
    expect(keyToView(view, "ArrowLeft", viewport)).toEqual({ x: 60, y: 0, scale: 1 });
    expect(keyToView(view, "ArrowRight", viewport)).toEqual({ x: -60, y: 0, scale: 1 });
    expect(keyToView(view, "ArrowUp", viewport)).toEqual({ x: 0, y: 60, scale: 1 });
    expect(keyToView(view, "ArrowDown", viewport)).toEqual({ x: 0, y: -60, scale: 1 });

    const zin = keyToView(view, "+", viewport)!;
    expect(zin.scale).toBe(1.2);
    expect(worldToScreen(zin, screenToWorld(view, { x: 400, y: 300 }))).toEqual({ x: 400, y: 300 });
    expect(keyToView(view, "=", viewport)!.scale).toBe(1.2);
    expect(keyToView(view, "-", viewport)!.scale).toBeLessThan(0.84);
    expect(keyToView(view, "-", viewport)!.scale).toBeGreaterThan(0.83);

    expect(keyToView({ x: 10, y: 10, scale: 2 }, "0", viewport)).toEqual(DEFAULT_VIEW);
    expect(keyToView(view, "0", viewport, [{ x: 0, y: 0, w: 100, h: 100 }])).toEqual({ x: 350, y: 250, scale: 1 });
    expect(keyToView(view, "a", viewport)).toBeNull();
  });

  it("a stored view is read back only when it is a sane view", () => {
    expect(parseStoredView(JSON.stringify({ x: 5, y: -3, scale: 0.8 }))).toEqual({ x: 5, y: -3, scale: 0.8 });
    expect(parseStoredView(JSON.stringify({ x: 5, y: -3, scale: 40 }))).toEqual({ x: 5, y: -3, scale: 2.5 });
    for (const bad of [null, "", "{", "[]", "null", JSON.stringify({ x: "1", y: 0, scale: 1 }), '{"x":1e999,"y":0,"scale":1}']) expect(parseStoredView(bad), String(bad)).toBeNull();
  });
});
