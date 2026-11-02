import { describe, expect, it } from "vitest";

import { minimapToWorld, minimapTransform, minimapWorld } from "./minimap";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("minimap", () => {
  it("fits the world inside the box and keeps its proportions", () => {
    const world = { x: -100, y: 50, w: 400, h: 100 };
    const box = { w: 200, h: 120 };
    const { scale, dx, dy } = minimapTransform(world, box);
    expect(scale).toBe(0.5);
    const left = world.x * scale + dx, top = world.y * scale + dy;
    expect(near(left, 0)).toBe(true);
    expect(left + world.w * scale).toBeLessThanOrEqual(box.w);
    expect(near(top, (120 - 50) / 2)).toBe(true);
    expect(top + world.h * scale).toBeLessThanOrEqual(box.h);
  });

  it("a tall world is limited by the height and centred across", () => {
    const { scale, dx } = minimapTransform({ x: 0, y: 0, w: 100, h: 600 }, { w: 200, h: 120 });
    expect(scale).toBe(0.2);
    expect(dx).toBe(90);
  });

  it("an empty or flat world never gives NaN or Infinity", () => {
    for (const world of [{ x: 0, y: 0, w: 0, h: 0 }, { x: 5, y: 5, w: 300, h: 0 }]) {
      const t = minimapTransform(world, { w: 200, h: 120 });
      expect([t.scale, t.dx, t.dy].every(Number.isFinite)).toBe(true);
    }
  });

  it("a click in the minimap jumps to the world point under it", () => {
    const world = { x: -100, y: 50, w: 400, h: 100 };
    const transform = minimapTransform(world, { w: 200, h: 120 });
    expect(minimapToWorld(transform, { x: 100, y: 60 })).toEqual({ x: 100, y: 100 });
    expect(minimapToWorld(transform, { x: 0, y: 35 })).toEqual({ x: -100, y: 50 });
  });

  it("the minimap world holds both the blocks and the part on screen", () => {
    const world = minimapWorld([{ x: 0, y: 0, w: 100, h: 100 }], { x: 0, y: 0, scale: 1 }, { w: 800, h: 600 });
    expect(world).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    const far = minimapWorld([{ x: 1000, y: 1000, w: 100, h: 100 }], { x: 0, y: 0, scale: 2 }, { w: 800, h: 600 });
    expect(far).toEqual({ x: 0, y: 0, w: 1100, h: 1100 });
    expect(minimapWorld([], { x: 0, y: 0, scale: 1 }, { w: 0, h: 0 })).toBeNull();
  });
});
