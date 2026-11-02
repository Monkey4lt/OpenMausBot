import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale, t } from "@/lib/i18n";
import { AtelierTitle, CartographeButton, CartographePanel, MapChangedNotice, ProjectBlockHeaderActions, ProjectBlockMeta, ProjectBlockPole, ProjectBlockSummary } from "./ProjectsPage";

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
    expect(html).toContain(">Une boutique en ligne.</p>");
    expect(html).toContain("line-clamp-2");
    expect(html).toContain('title="Une boutique en ligne.');
    expect(renderToStaticMarkup(createElement(ProjectBlockSummary, { summary: undefined }))).toBe("");
  });
});

describe("project block meta", () => {
  it("shows one count that fits whole, never a line cut mid-word, with the rest in its tooltip", () => {
    const html = renderToStaticMarkup(createElement(ProjectBlockMeta, { dirs: 9, files: 27, truncated: false }));
    expect(html).toContain(">27 fichiers</div>");
    expect(html).toContain('title="9 dossiers, 27 fichiers"');
    expect(html).toContain("whitespace-nowrap");
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("font-mono");
    expect(html).not.toContain("·");
  });

  it("says one file in the singular, a cut list with a plus, and the source in the tooltip", () => {
    expect(renderToStaticMarkup(createElement(ProjectBlockMeta, { dirs: 1, files: 1, truncated: false }))).toContain(">1 fichier</div>");
    const cut = renderToStaticMarkup(createElement(ProjectBlockMeta, { dirs: 40, files: 500, truncated: true, source: "Mon serveur" }));
    expect(cut).toContain(">500+ fichiers</div>");
    expect(cut).toContain('title="40 dossiers, 500+ fichiers, dans « Mon serveur »"');
  });
});

describe("project block pole", () => {
  it("shows the pole as its color only and names it for screen readers", () => {
    const html = renderToStaticMarkup(createElement(ProjectBlockPole, { group: { name: "Boutique", color: "#1084fe" }, onClick: () => {} }));
    expect(html).toContain('aria-label="Changer de pôle (actuellement « Boutique »)"');
    expect(html).toContain("background:#1084fe");
    expect(html).not.toContain(">Boutique<");
  });
});

describe("the Cartographe button", () => {
  const bot = { id: "carto", threadId: "t-carto", mainThreadId: "t-carto", tasks: [{ threadId: "t-carto" }] };

  it("the Cartographe button renders only when cartographeBotId is set and its bot is known", () => {
    const html = renderToStaticMarkup(createElement(CartographeButton, { bot, onAsk: () => {} }));
    expect(html).toContain("Demander au Cartographe");
    expect(html).toContain('data-icon="Sparkles"');
    expect(html).toContain("bg-ink");
    expect(html).toContain("text-app");
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

describe("the Atelier", () => {
  it("the page title and the nav say Atelier in French", () => {
    expect(t("sidebar.nav.projects")).toBe("Atelier");
    const html = renderToStaticMarkup(createElement(AtelierTitle));
    expect(html).toContain(">Atelier</h1>");
  });

  it("says Workshop in English", async () => {
    await loadLocale("en");
    expect(t("sidebar.nav.projects")).toBe("Workshop");
    expect(renderToStaticMarkup(createElement(AtelierTitle))).toContain(">Workshop</h1>");
  });
});

