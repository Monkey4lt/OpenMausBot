import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import { NARROW_PANEL_WIDTH, PANEL_KEY, panelDraft, panelLayout, readPanelOpen, writePanelOpen } from "./projects-panel";

const memory = () => {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, items };
};
const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

describe("the Cartographe panel", () => {
  it("remembers open or closed per viewer under its key, and survives a storage that throws", () => {
    const storage = memory();
    expect(readPanelOpen(storage)).toBe(false);
    writePanelOpen(storage, true);
    expect(storage.items.get(PANEL_KEY)).toBe("1");
    expect(readPanelOpen(storage)).toBe(true);
    writePanelOpen(storage, false);
    expect(readPanelOpen(storage)).toBe(false);
    expect(readPanelOpen(throwing)).toBe(false);
    expect(() => writePanelOpen(throwing, true)).not.toThrow();
    expect(readPanelOpen(null)).toBe(false);
  });

  it("drafts a request about the project open, or the overview one", () => {
    expect(panelDraft({ projectName: "shop" })).toBe("Décris «shop» : à quoi il sert en une phrase, puis chaque grand bloc en une ligne.");
    expect(panelDraft({})).toBe("Range mes projets et propose-moi les changements.");
    setLocale("en");
    expect(panelDraft({ projectName: "shop" })).toBe("Describe «shop»: what it is for in one sentence, then each big part in one line.");
  });

  it("overlays the map below 900 px and sits beside it above", () => {
    expect(NARROW_PANEL_WIDTH).toBe(900);
    expect(panelLayout(899)).toEqual({ narrow: true, className: expect.stringContaining("absolute") });
    expect(panelLayout(900)).toEqual({ narrow: false, className: expect.stringContaining("w-[420px]") });
    expect(panelLayout(900).className).not.toContain("absolute");
  });
});
