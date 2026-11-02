import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale, t } from "@/lib/i18n";
import { askCartographe, CartographeButton, MapChangedNotice, ProjectBlockHeaderActions, ProjectBlockSummary } from "./ProjectsPage";

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

describe("project block header", () => {
  it("offers the architecture map of the project next to linking and folding", () => {
    const html = renderToStaticMarkup(createElement(ProjectBlockHeaderActions, {
      name: "api", linking: false, collapsed: false, onMap: () => {}, onLink: () => {}, onFold: () => {},
    }));
    expect(html).toContain('aria-label="Ouvrir la carte de api"');
    expect(html).toContain('data-icon="Network"');
    expect(html).toContain('aria-label="Relier à un autre projet"');
    expect(html).toContain('aria-label="Plier / déplier"');
    expect(html.match(/<button/g)).toHaveLength(3);
  });
});

describe("project block summary", () => {
  it("shows the first line of the En bref card under the project's name, and nothing without one", () => {
    const html = renderToStaticMarkup(createElement(ProjectBlockSummary, { summary: "Une boutique en ligne.\nAvec un site." }));
    expect(html).toContain(">Une boutique en ligne.</div>");
    expect(html).toContain('title="Une boutique en ligne.');
    expect(renderToStaticMarkup(createElement(ProjectBlockSummary, { summary: undefined }))).toBe("");
  });
});

describe("the Cartographe button", () => {
  const bot = { id: "carto", threadId: "t-carto", mainThreadId: "t-carto", tasks: [{ threadId: "t-carto" }] };

  it("the Cartographe button renders only when cartographeBotId is set and its bot is known", () => {
    const html = renderToStaticMarkup(createElement(CartographeButton, { bot, onAsk: () => {} }));
    expect(html).toContain("Demander au Cartographe");
    expect(html).toContain('data-icon="Sparkles"');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(renderToStaticMarkup(createElement(CartographeButton, { bot: null, onAsk: () => {} }))).toBe("");
  });

  it("the button prepends the draft to the Cartographe's thread and opens it, never sending it", () => {
    const calls: unknown[] = [];
    askCartographe(bot, {
      prependDraft: (id, text) => calls.push(["draft", id, text]),
      showChat: () => calls.push(["showChat"]),
      openBot: (opened) => calls.push(["open", opened.id]),
    });
    expect(calls).toEqual([
      ["draft", "bot:carto:t-carto", "Range mes projets et propose-moi les changements."],
      ["showChat"],
      ["open", "carto"],
    ]);
    expect(t("projects.cartographe.draft")).toBe("Range mes projets et propose-moi les changements.");
  });
});

describe("the map-changed notice", () => {
  it("says the map changed and can be closed", () => {
    const html = renderToStaticMarkup(createElement(MapChangedNotice, { onClose: () => {} }));
    expect(html).toContain("La carte a changé");
    expect(html).toContain('role="status"');
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});
