import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import { NodeFrame } from "./NodeFrame";
import { Toolbar } from "./Toolbar";

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

describe("Toolbar", () => {
  it("marks the active tool with aria-pressed and names every tool in French", () => {
    const html = renderToStaticMarkup(createElement(Toolbar, { tool: "hand", onTool: () => {}, search: () => {} }));
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Main"|aria-label="Main"[^>]*aria-pressed="true"/);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    for (const label of ["Sélection", "Crayon", "Note", "Forme", "Texte", "Trouver un bloc"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('role="toolbar"');
  });

  it("shows the add button only with onAdd, and search only with search", () => {
    const bare = renderToStaticMarkup(createElement(Toolbar, { tool: "select", onTool: () => {} }));
    expect(bare).not.toContain("Ajouter un bloc");
    expect(bare).not.toContain("Trouver un bloc");
    const add = renderToStaticMarkup(createElement(Toolbar, { tool: "select", onTool: () => {}, onAdd: () => {} }));
    expect(add).toContain("Ajouter un bloc");
    const custom = renderToStaticMarkup(createElement(Toolbar, { tool: "select", onTool: () => {}, onAdd: () => {}, addLabel: "Nouveau projet" }));
    expect(custom).toContain("Nouveau projet");
  });
});

describe("NodeFrame", () => {
  const rect = { x: 40, y: 60, w: 280, h: 120 };
  it("places the card in the world, with its type label above and its ports outside", () => {
    const html = renderToStaticMarkup(createElement(NodeFrame, {
      id: "n1", rect, selected: false, locked: false, onMove: () => {}, onSelect: () => {},
      label: { text: "Déclencheur" },
      ports: [{ side: "left", id: "in" }, { side: "right", id: "yes", kind: "yes" }, { side: "right", id: "no", kind: "no" }],
    }, createElement("p", null, "Corps")));
    expect(html).toContain('data-canvas-node="n1"');
    expect(html).toContain("left:40px");
    expect(html).toContain("top:60px");
    expect(html).toContain("width:280px");
    expect(html).toContain("Déclencheur");
    expect(html.indexOf("Déclencheur")).toBeLessThan(html.indexOf("Corps"));
    expect((html.match(/data-canvas-port=/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="Oui"');
    expect(html).toContain('aria-label="Non"');
    expect(html).not.toContain("Dupliquer");
  });

  it("a selected node with actions shows duplicate, lock and delete; locked shows unlock", () => {
    const actions = { onDuplicate: () => {}, onToggleLock: () => {}, onDelete: () => {} };
    const html = renderToStaticMarkup(createElement(NodeFrame, { id: "n1", rect, selected: true, locked: false, onMove: () => {}, onSelect: () => {}, actions }));
    for (const label of ["Dupliquer", "Verrouiller", "Supprimer"]) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('data-selected="true"');
    const locked = renderToStaticMarkup(createElement(NodeFrame, { id: "n1", rect, selected: true, locked: true, onMove: () => {}, onSelect: () => {}, actions }));
    expect(locked).toContain('aria-label="Déverrouiller"');
    expect(locked).toContain('data-locked="true"');
  });
});
