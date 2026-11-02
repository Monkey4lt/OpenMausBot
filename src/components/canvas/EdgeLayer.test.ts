import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { bezierPath } from "@/lib/canvas/geometry";
import { EdgeLayer } from "./EdgeLayer";

const a = { x: 0, y: 0, side: "right" as const };
const b = { x: 200, y: 80, side: "left" as const };

describe("EdgeLayer", () => {
  it("draws one thin dashed curve per edge, a wide invisible hit path and the label in a pill", () => {
    const html = renderToStaticMarkup(createElement(EdgeLayer, { edges: [
      { id: "e1", from: a, to: b, label: "utilise" },
      { id: "e2", from: b, to: { x: 400, y: 0, side: "left" }, dashed: false, tone: "accent" },
    ], onEdgeClick: () => {} }));
    expect((html.match(/data-edge-line/g) ?? []).length).toBe(2);
    expect(html).toContain(`d="${bezierPath(a, b)}"`);
    expect((html.match(/stroke-dasharray="4 4"/g) ?? []).length).toBe(1);
    expect(html).toContain('stroke-width="1.25"');
    expect((html.match(/data-edge-hit/g) ?? []).length).toBe(2);
    expect(html).toMatch(/data-edge-hit[^>]*stroke-width="14"|stroke-width="14"[^>]*data-edge-hit/);
    expect(html).toContain('data-canvas-edge="e1"');
    expect(html).toContain("utilise");
    expect(html).toContain("var(--color-accent)");
  });

  it("dashed edges are the default; an explicit dashed: true is the same", () => {
    const html = renderToStaticMarkup(createElement(EdgeLayer, { edges: [{ id: "e1", from: a, to: b, dashed: true }] }));
    expect(html).toContain('stroke-dasharray="4 4"');
  });

  it("without onEdgeClick the edges take no clicks", () => {
    const html = renderToStaticMarkup(createElement(EdgeLayer, { edges: [{ id: "e1", from: a, to: b }] }));
    expect(html).not.toContain("data-edge-hit");
  });
});
