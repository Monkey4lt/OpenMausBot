import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale, t } from "@/lib/i18n";
import { projectWorkflowBadges } from "@/lib/workflows/overview";
import { AtelierTitle, CartographeFab, CartographePanel, MapChangedNotice, ProjectBlockPole, ProjectCard, WorkflowBadge, WorkflowList, WorkflowSectionTitle } from "./ProjectsPage";

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

describe("the project card", () => {
  const base = {
    name: "shop", title: "9 dossiers, 2825 fichiers", group: null, summary: undefined, kinds: undefined, files: 2825, truncated: false, filesOpen: false, linking: false,
    onOpen: () => {}, onDescribe: () => {}, onToggleFiles: () => {}, onLink: () => {}, onPole: () => {},
  };
  const card = (props: Partial<Parameters<typeof ProjectCard>[0]> = {}) => renderToStaticMarkup(createElement(ProjectCard, { ...base, ...props }));

  it("shows no file tree by default, only a quiet button with the count", () => {
    const html = card({ tree: createElement("div", { "data-tree": "1" }) });
    expect(html).not.toContain("data-tree");
    expect(html).toMatch(/Voir les fichiers \(2\s825\)/);
    expect(html).not.toContain("font-mono");
    expect(html).not.toContain('data-icon="Server"');
    expect(html).not.toContain('data-icon="Network"');
    expect(html).not.toContain('data-icon="ChevronDown"');
    expect(html).not.toContain("uppercase");
  });

  it("shows the tree once the files are opened, with a button to hide them", () => {
    const html = card({ filesOpen: true, tree: createElement("div", { "data-tree": "1" }) });
    expect(html).toContain('data-tree="1"');
    expect(html).toContain("Masquer les fichiers");
    expect(card({ truncated: true, files: 500 })).toContain("Voir les fichiers (500+)");
  });

  it("without a summary says so and offers to ask the Cartographe", () => {
    const html = card();
    expect(html).toContain("Pas encore décrit.");
    expect(html).toContain("Demander au Cartographe de le décrire");
    expect(html).toContain('data-icon="Sparkles"');
  });

  it("with a summary shows its first line, and no ask button", () => {
    const html = card({ summary: "Une boutique en ligne pour les clients.\nAvec un site." });
    expect(html).toContain(">Une boutique en ligne pour les clients.</p>");
    expect(html).toContain("line-clamp-2");
    expect(html).not.toContain("Pas encore décrit");
    expect(html).not.toContain("Demander au Cartographe");
  });

  it("shows at most three piece chips with icons, then a count, and never tests or deploy", () => {
    const html = card({ kinds: ["ui", "api", "database", "external", "tests", "deploy", "jobs"] });
    expect(html.match(/data-card-piece=/g)).toHaveLength(3);
    expect(html).toContain('data-card-piece="ui"');
    expect(html).toContain('data-icon="Monitor"');
    expect(html).toContain(">Serveur<");
    expect(html).toContain(">+2<");
    expect(html).not.toContain('data-card-piece="tests"');
    expect(card({ kinds: undefined })).not.toContain("data-card-piece");
  });

  it("opens the project from its name and from « Comment ça marche », and keeps the link icon", () => {
    const html = card();
    expect(html).toContain('aria-label="Comment marche shop"');
    expect(html).toContain(">Comment ça marche<");
    expect(html).toContain('aria-label="Relier à un autre projet"');
    expect(html).toContain('title="9 dossiers, 2825 fichiers"');
  });

  it("shows the pole as a color dot, or a button to choose one", () => {
    const html = card({ group: { name: "Boutique", color: "#1084fe" } });
    expect(html).toContain("background:#1084fe");
    expect(html).toContain('aria-label="Changer de pôle (actuellement « Boutique »)"');
    expect(card()).toContain("Choisir un pôle");
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

describe("the Cartographe floating button", () => {
  const bot = { id: "carto", threadId: "t-carto", name: "Cartographe", color: "teal" as const };

  it("is a round light button with the Cartographe's own head, named as the Atelier's assistant", () => {
    const html = renderToStaticMarkup(createElement(CartographeFab, { bot, busy: false, open: false, onAsk: () => {} }));
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Cartographe, l&#x27;assistant de l&#x27;Atelier"');
    expect(html).toContain('title="Cartographe, l&#x27;assistant de l&#x27;Atelier"');
    expect(html).toContain("rounded-full");
    expect(html).toContain("size-11");
    expect(html).toContain("data-cartographe-fab");
    expect(html).not.toContain("bg-ink");
    expect(html).not.toContain("shadow-2xl");
    expect(html).not.toContain('data-icon="Bot"');
    expect(html).not.toContain("Demander au Cartographe");
  });

  it("still shows, with a bot head, when the Cartographe was deleted, so the person can bring it back", () => {
    const html = renderToStaticMarkup(createElement(CartographeFab, { bot: null, busy: false, open: false, onAsk: () => {} }));
    expect(html).toContain('data-icon="Bot"');
    expect(html).toContain("Cartographe, l&#x27;assistant de l&#x27;Atelier");
  });

  it("spins while the Cartographe is being made, and hides while the panel is open", () => {
    const busy = renderToStaticMarkup(createElement(CartographeFab, { bot: null, busy: true, open: false, onAsk: () => {} }));
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("disabled");
    expect(busy).toContain('data-icon="Loader2"');
    expect(renderToStaticMarkup(createElement(CartographeFab, { bot, busy: false, open: true, onAsk: () => {} }))).toBe("");
  });

  it("says Workshop assistant in English", async () => {
    await loadLocale("en");
    expect(renderToStaticMarkup(createElement(CartographeFab, { bot: null, busy: false, open: false, onAsk: () => {} }))).toContain("Cartographe, the Workshop assistant");
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
    expect(html).toContain(">Cartographe<");
    expect(html).toContain("l&#x27;assistant de l&#x27;Atelier");
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

describe("workflows in the Atelier", () => {
  const list = [
    { id: "w1", name: "Factures du mois", projectId: "p1", rev: 1, updatedAt: 1, lastRun: { status: "failed" as const, startedAt: 5 } },
    { id: "w2", name: "Rapport du matin", projectId: "gone", rev: 1, updatedAt: 1 },
  ];

  it("shows a workflow attached to its project with its last run state", () => {
    const [badge] = projectWorkflowBadges(list, new Map([["p1", { x: 0, y: 0, w: 320, h: 200 }]]));
    const html = renderToStaticMarkup(createElement(WorkflowBadge, { name: badge!.name, dot: badge!.dot, rect: badge!.rect, onOpen: () => {} }));
    expect(html).toContain('data-workflow-badge="failed"');
    expect(html).toContain("Factures du mois");
    expect(html).toContain("bg-danger");
    expect(html).toContain('aria-label="Ouvrir le workflow Factures du mois"');
    expect(html).toContain("Échouée");
  });

  it("a workflow whose project is gone is listed but not drawn", () => {
    expect(projectWorkflowBadges(list, new Map([["p1", { x: 0, y: 0, w: 320, h: 200 }]])).map((b) => b.id)).toEqual(["w1"]);
    const html = renderToStaticMarkup(createElement(WorkflowList, { workflows: list, activeId: "w2", onOpen: () => {}, onNew: () => {} }));
    expect(html).toContain("Rapport du matin");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-run-dot="idle"');
    expect(html).toContain('data-run-dot="failed"');
    expect(html).toContain("Nouveau workflow");
  });

  it("names the workflows section with a plain subtitle", () => {
    const html = renderToStaticMarkup(createElement(WorkflowSectionTitle, { onNew: () => {} }));
    expect(html).toContain(">Workflows<");
    expect(html).toContain("Tes automatisations en étapes");
  });

  it("says when there is no workflow yet", () => {
    expect(renderToStaticMarkup(createElement(WorkflowList, { workflows: [], activeId: null, onOpen: () => {}, onNew: () => {} }))).toContain("Aucun workflow pour l&#x27;instant");
  });

  it("lists existing automations after the workflows, to open read-only", () => {
    const automation = { id: "routine-r1", routineId: "r1", name: "Mails du matin", readOnly: true as const, enabled: false, nextRunAt: null, nodes: [], edges: [] };
    const html = renderToStaticMarkup(createElement(WorkflowList, { workflows: list, automations: [automation], activeId: null, onOpen: () => {}, onNew: () => {} }));
    expect(html).toContain('data-automation="r1"');
    expect(html).toContain("Mails du matin");
    expect(html).toContain("en pause");
    expect(html.indexOf("Rapport du matin")).toBeLessThan(html.indexOf("Mails du matin"));
  });
});
