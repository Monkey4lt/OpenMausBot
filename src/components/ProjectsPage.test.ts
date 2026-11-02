import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import { CartographeButton, CartographePanel, MapChangedNotice, ProjectBlockHeaderActions, ProjectBlockSummary } from "./ProjectsPage";

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

});

describe("the Cartographe panel", () => {
  const chat = createElement("div", { "data-chat": "carto" });

  it("is hidden without cartographeBotId", () => {
    expect(renderToStaticMarkup(createElement(CartographePanel, { botId: null, bot: null, width: 1400, chat, onClose: () => {}, onOpenInChat: () => {} }))).toBe("");
  });

  it("shows the real chat beside the map, with a link to the full discussion and a close button", () => {
    const html = renderToStaticMarkup(createElement(CartographePanel, { botId: "carto", bot: { id: "carto", threadId: "t" }, width: 1400, chat, onClose: () => {}, onOpenInChat: () => {} }));
    expect(html).toContain('data-chat="carto"');
    expect(html).toContain("Ouvrir dans la discussion");
    expect(html).toContain('aria-label="Fermer"');
    expect(html).toContain("w-[420px]");
    expect(html).toContain("border-l");
    expect(html).not.toContain("absolute");
  });

  it("overlays the map on a narrow window, and says it is loading before the bot is known", () => {
    expect(renderToStaticMarkup(createElement(CartographePanel, { botId: "carto", bot: { id: "carto", threadId: "t" }, width: 700, chat, onClose: () => {}, onOpenInChat: () => {} }))).toContain("absolute");
    const loading = renderToStaticMarkup(createElement(CartographePanel, { botId: "carto", bot: null, width: 1400, chat, onClose: () => {}, onOpenInChat: () => {} }));
    expect(loading).toContain("Chargement de la discussion");
    expect(loading).not.toContain('data-chat="carto"');
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
