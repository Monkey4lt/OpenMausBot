import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import type { Annotation } from "@/lib/canvas/model";
import { AnnotationLayer } from "./AnnotationLayer";

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

const items: Annotation[] = [
  { id: "n1", kind: "sticky", x: 10, y: 20, w: 200, h: 140, text: "Migrer la base", color: "accent" },
  { id: "t1", kind: "text", x: 300, y: 40, text: "Clients", size: "l" },
  { id: "s1", kind: "shape", shape: "ellipse", x: 0, y: 300, w: 120, h: 80 },
  { id: "i1", kind: "ink", points: [{ x: 0, y: 0 }, { x: 40, y: 10 }, { x: 80, y: 0 }] },
];
const render = (props: Partial<Parameters<typeof AnnotationLayer>[0]> = {}) =>
  renderToStaticMarkup(createElement(AnnotationLayer, { items, tool: "select", selectedId: null, onChange: () => {}, onSelect: () => {}, ...props }));

describe("AnnotationLayer", () => {
  it("draws each note, text, shape and stroke in world coordinates", () => {
    const html = render();
    expect((html.match(/data-canvas-annotation=/g) ?? []).length).toBe(4);
    expect(html).toContain("Migrer la base");
    expect(html).toContain("Clients");
    expect(html).toContain("left:10px");
    expect(html).toContain("<ellipse");
    expect(html).toMatch(/<path[^>]*d="M0 0 L40 10 L80 0"/);
    expect(html).toContain("var(--color-accent)");
    expect(html).not.toContain("data-annotation-capture");
  });

  it("a selected note shows its colours and Retirer; a selected shape offers the three shapes", () => {
    const note = render({ selectedId: "n1" });
    expect(note).toContain('aria-label="Retirer"');
    expect((note.match(/aria-label="Couleur \d"/g) ?? []).length).toBe(5);
    const shape = render({ selectedId: "s1" });
    for (const label of ["Rectangle", "Ellipse", "Losange"]) expect(shape).toContain(`aria-label="${label}"`);
    expect(shape).toMatch(/aria-pressed="true"[^>]*aria-label="Ellipse"|aria-label="Ellipse"[^>]*aria-pressed="true"/);
  });

  it("a drawing tool lays a surface over the canvas to draw on; the select tool does not", () => {
    for (const tool of ["sticky", "text", "shape", "pencil"] as const) expect(render({ tool })).toContain("data-annotation-capture");
    expect(render({ tool: "hand" })).not.toContain("data-annotation-capture");
  });

  it("a read-only layer draws the notes but takes no clicks", () => {
    const html = render({ readOnly: true, tool: "sticky" });
    expect(html).toContain("Migrer la base");
    expect(html).not.toContain("data-annotation-capture");
  });
});
