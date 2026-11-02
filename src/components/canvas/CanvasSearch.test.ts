import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { centerOn } from "@/lib/canvas/geometry";
import { loadLocale, setLocale } from "@/lib/i18n";
import { CanvasSearch, matchCanvasItems } from "./CanvasSearch";

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

const items = [
  { id: "s1:shop", label: "shop", rect: { x: 0, y: 0, w: 320, h: 200 } },
  { id: "note:n1", label: "Migrer la base de la boutique", rect: { x: 1000, y: 600, w: 200, h: 140 } },
  { id: "s1:billing", label: "billing", rect: { x: 400, y: 0, w: 320, h: 200 } },
];

describe("CanvasSearch", () => {
  it("search finds a project and a note by a word and centres on it", () => {
    expect(matchCanvasItems(items, "SHOP").map((i) => i.id)).toEqual(["s1:shop"]);
    expect(matchCanvasItems(items, "base").map((i) => i.id)).toEqual(["note:n1"]);
    expect(matchCanvasItems(items, "migrer boutique").map((i) => i.id)).toEqual(["note:n1"]);
    expect(matchCanvasItems(items, "  ")).toEqual([]);
    const [note] = matchCanvasItems(items, "base");
    const view = centerOn({ x: 0, y: 0, scale: 0.5 }, { x: note.rect.x + note.rect.w / 2, y: note.rect.y + note.rect.h / 2 }, { w: 800, h: 600 });
    expect(view).toEqual({ x: 400 - 550, y: 300 - 335, scale: 0.5 });
  });

  it("ignores accents and lists the start of the name first", () => {
    const list = [{ id: "a", label: "Une étude", rect: items[0].rect }, { id: "b", label: "Etudes", rect: items[0].rect }];
    expect(matchCanvasItems(list, "etude").map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("opens as a labelled search box", () => {
    const html = renderToStaticMarkup(createElement(CanvasSearch, { items, onPick: () => {}, onClose: () => {} }));
    expect(html).toContain('role="search"');
    expect(html).toContain('placeholder="Trouver un bloc ou une note"');
  });
});
