import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import { Canvas } from "./Canvas";
import { ZoomControls } from "./ZoomControls";

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

describe("Canvas", () => {
  it("Canvas renders the world with the view transform and the zoom controls with 100%", () => {
    const html = renderToStaticMarkup(createElement(Canvas, {
      tool: "select", view: { x: 10, y: 20, scale: 1 },
      underlay: createElement("div", { id: "zone" }), overlay: createElement("div", { id: "notes" }),
      toolbar: createElement("div", { id: "tools" }), bottomLeft: createElement("div", { id: "mini" }),
    }, createElement("div", { id: "block" }, "Bloc A")));
    expect(html).toMatch(/data-canvas-world[^>]*style="[^"]*transform:translate\(10px, 20px\) scale\(1\)/);
    expect(html).toContain("100%");
    expect(html).toContain("Bloc A");
    expect(html.indexOf('id="zone"')).toBeLessThan(html.indexOf('id="block"'));
    expect(html.indexOf('id="block"')).toBeLessThan(html.indexOf('id="notes"'));
    expect(html).toContain('id="tools"');
    expect(html).toContain('id="mini"');
    expect(html).toContain('aria-label="Toile"');
    expect(html).toContain('tabindex="0"');
  });

  it("the dotted background follows the view", () => {
    const html = renderToStaticMarkup(createElement(Canvas, { tool: "select", view: { x: 7, y: -3, scale: 2 } }));
    expect(html).toContain("background-size:48px 48px");
    expect(html).toContain("background-position:7px -3px");
    expect(html).toContain("200%");
  });

  it("shows the hand cursor with the hand tool, and marks a read-only canvas", () => {
    expect(renderToStaticMarkup(createElement(Canvas, { tool: "hand" }))).toContain("cursor-grab");
    expect(renderToStaticMarkup(createElement(Canvas, { tool: "select", readOnly: true }))).toContain('data-readonly="true"');
  });

  it("ZoomControls shows minus, the percentage, plus and fit, in French", () => {
    const html = renderToStaticMarkup(createElement(ZoomControls, { view: { x: 0, y: 0, scale: 0.8 }, onChange: () => {}, viewport: { w: 800, h: 600 }, rects: [] }));
    expect(html).toContain("80%");
    expect(html).toContain('aria-label="Dézoomer"');
    expect(html).toContain('aria-label="Zoomer"');
    expect((html.match(/aria-label="Ajuster à la vue"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="Zoom 80 %, cliquer pour ajuster à la vue"');
  });
});
