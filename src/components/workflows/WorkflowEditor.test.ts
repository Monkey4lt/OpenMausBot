import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import type { Workflow, WorkflowRun } from "../../../shared/workflows";
import { NodeSettings } from "./NodeSettings";
import { RunPanel } from "./RunPanel";
import { WorkflowEditorView, type EditorViewProps } from "./WorkflowEditor";

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

const workflow: Workflow = {
  id: "w1", name: "Factures du mois", rev: 3, createdAt: 1, updatedAt: 1, annotations: [], limits: { maxSteps: 20, maxCostUsd: 1 },
  nodes: [
    { id: "t", kind: "trigger", x: 0, y: 0, data: { mode: "manual" } },
    { id: "c", kind: "condition", x: 400, y: 0, data: { question: "Y a-t-il une facture ?" } },
    { id: "b", kind: "bot", x: 800, y: 0, data: { instruction: "Range la facture", botId: "bot1" } },
  ],
  edges: [
    { id: "e1", from: { node: "t", port: "out" }, to: { node: "c", port: "in" } },
    { id: "e2", from: { node: "c", port: "yes" }, to: { node: "b", port: "in" } },
  ],
};
const run: WorkflowRun = {
  id: "r1", workflowId: "w1", status: "running", startedAt: Date.UTC(2026, 10, 2, 9),
  steps: [
    { nodeId: "t", status: "succeeded", output: "Lancé à la main", costUsd: 0 },
    { nodeId: "c", status: "succeeded", port: "yes", input: "Lancé à la main", output: "OUI", costUsd: null },
    { nodeId: "b", status: "running", input: "Lancé à la main" },
  ],
};
const noop = () => {};
const props = (extra: Partial<EditorViewProps> = {}): EditorViewProps => ({
  workflow, problems: [], saveState: "saved", changedElsewhere: false, runs: [], refusal: null,
  projects: [{ id: "p1", name: "Compta" }], bots: [{ id: "bot1", name: "Doué", color: "#009957" }], models: [{ value: "claude/haiku", label: "Claude Haiku", group: "Claude" }],
  onEdit: noop, onPreview: noop, onRun: async () => null, onRunStep: async () => null, onRetry: async () => null, onCancel: async () => null,
  onBack: noop, onDelete: noop, onReload: noop, onDismissChanged: noop, onDismissRefusal: noop, ...extra,
});
const render = (extra: Partial<EditorViewProps> = {}) => renderToStaticMarkup(createElement(WorkflowEditorView, props(extra)));

describe("workflow editor", () => {
  it("draws a 3-block workflow: each block with its type above it and its ports, and a clickable wire for each link", () => {
    const html = render();
    expect(html.match(/data-canvas-node="/g)).toHaveLength(3);
    for (const label of ["Déclencheur", "Condition", "Bot"]) expect(html).toContain(`<span class="truncate">${label}</span>`);
    expect(html.match(/data-canvas-port="in"/g)).toHaveLength(2);
    expect(html).toContain('data-canvas-port="yes"');
    expect(html).toContain('data-canvas-port="no"');
    expect(html.match(/data-canvas-edge="e\d"/g)).toHaveLength(2);
    expect(html.match(/data-edge-hit/g)).toHaveLength(2);
    expect(html).toContain("Atelier");
    expect(html).toContain('value="Factures du mois"');
    expect(html).toContain("Lancer maintenant");
    expect(html.match(/Lancer cette étape/g)).toHaveLength(2);
    expect(html).toContain("Ajouter un bloc");
  });

  it("says plainly that bots act without asking and offers an approval, until there is one", () => {
    const html = render();
    expect(html).toContain("Les bots de ce workflow agissent sans te demander.");
    expect(html).toContain("Ajouter une approbation");
    const withApproval = render({ workflow: { ...workflow, nodes: [...workflow.nodes, { id: "p", kind: "approval", x: 0, y: 400, data: { message: "OK ?" } }] } });
    expect(withApproval).toContain("Les bots de ce workflow agissent sans te demander.");
    expect(withApproval).not.toContain("Ajouter une approbation");
    const noBot = render({ workflow: { ...workflow, nodes: workflow.nodes.slice(0, 2), edges: workflow.edges.slice(0, 1) } });
    expect(noBot).not.toContain("agissent sans te demander");
  });

  it("shows the server's problems in plain French on their block and wire, and the general ones on top", () => {
    const html = render({ problems: [
      { nodeId: "b", code: "unknown-bot", message_fr: "Le bot choisi est introuvable (supprimé ?). Choisis-en un autre.", message_en: "x" },
      { edgeId: "e2", code: "bad-port", message_fr: "Ce fil n'est pas branché au bon endroit.", message_en: "x" },
      { code: "no-trigger", message_fr: "Ajoute un bloc Déclencheur.", message_en: "x" },
    ] });
    expect(html).toContain("data-node-problems");
    expect(html).toContain("Le bot choisi est introuvable (supprimé ?). Choisis-en un autre.");
    expect(html).toContain("Ce fil n&#x27;est pas branché au bon endroit.");
    expect(html).toContain("Ajoute un bloc Déclencheur.");
    expect(html).not.toContain("unknown-bot");
  });

  it("after a 409 tells that the workflow changed elsewhere and offers to reload", () => {
    const html = render({ changedElsewhere: true });
    expect(html).toContain("Ce workflow a changé ailleurs");
    expect(html).toContain(">Recharger</button>");
  });

  it("colours each block by its step in the run and offers Stop while it runs", () => {
    const html = render({ runs: [run] });
    expect(html).toContain('data-step-status="succeeded"');
    expect(html).toContain('data-step-status="running"');
    expect(html).toContain("border-success/70");
    expect(html).toContain("border-accent");
    expect(html).toContain(">Réussi</span>");
    expect(html).toContain(">En cours</span>");
    expect(html).toContain("coût inconnu");
    expect(html).toContain("Arrêter");
    expect(html).not.toMatch(/>Lancer<svg/);
  });

  it("names a refused run in plain words", () => {
    expect(render({ refusal: { kind: "busy" } })).toContain("Ce workflow tourne déjà.");
    expect(render({ refusal: { kind: "invalid", problems: [] } })).toContain("Corrige d&#x27;abord ce qui est signalé sur les blocs.");
  });

  it("opens on a step's details: what it received and produced, and its cost", () => {
    const html = render({ runs: [run], initial: { panel: true, openStep: "c" } });
    expect(html).toContain("data-run-panel");
    expect(html).toContain("data-step-details");
    expect(html).toContain("Reçu");
    expect(html).toContain("Produit");
    expect(html).toContain(">OUI</pre>");
    expect(html).toContain("coût inconnu");
  });
});

describe("block settings", () => {
  const ctx = { bots: [{ id: "bot1", name: "Doué" }], models: [{ value: "claude/haiku", label: "Claude Haiku", group: "Claude" }], now: Date.UTC(2026, 10, 2, 9), timeZone: "Europe/Paris", locale: "fr" };

  it("a scheduled trigger shows every day at its time and its next run", () => {
    const html = renderToStaticMarkup(createElement(NodeSettings, { ctx, onPatch: noop,
      node: { id: "t", kind: "trigger", x: 0, y: 0, data: { mode: "schedule", schedule: { kind: "daily", at: "09:00" } } } }));
    expect(html).toContain('value="09:00"');
    expect(html).toContain("Prochaine exécution");
    expect(html).toMatch(/data-next-run[^>]*>mar\. 3 nov\.,? 09:00</);
  });

  it("a weekdays trigger offers the seven days, the chosen ones pressed", () => {
    const html = renderToStaticMarkup(createElement(NodeSettings, { ctx, onPatch: noop,
      node: { id: "t", kind: "trigger", x: 0, y: 0, data: { mode: "schedule", schedule: { kind: "weekdays", at: "08:00", days: [1, 3] } } } }));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(5);
    expect(html).toContain('aria-label="Lundi"');
  });

  it("an AI block has its instruction, an optional system instruction and the app's models", () => {
    const html = renderToStaticMarkup(createElement(NodeSettings, { ctx, onPatch: noop, node: { id: "a", kind: "ai", x: 0, y: 0, data: { prompt: "Résume", model: "claude/haiku" } } }));
    expect(html).toContain("Écris la consigne ici");
    expect(html).toContain("Consigne système (facultatif)");
    expect(html).toContain("Modèle choisi par l&#x27;appli");
    expect(html).toContain('<option value="claude/haiku" selected="">Claude Haiku</option>');
  });

  it("a send block can go to a bot's chat, with a bot to choose", () => {
    const html = renderToStaticMarkup(createElement(NodeSettings, { ctx, onPatch: noop, node: { id: "s", kind: "send", x: 0, y: 0, data: { to: "bot-chat" } } }));
    expect(html).toContain("Discussion d&#x27;un bot");
    expect(html).toContain("Choisir un bot");
  });
});

describe("a trigger the app plans", () => {
  const ctx = { bots: [], models: [], now: Date.UTC(2026, 10, 2, 9), timeZone: "Europe/Paris", locale: "fr" };
  const daily = { id: "t", kind: "trigger" as const, x: 0, y: 0, data: { mode: "schedule" as const, schedule: { kind: "daily" as const, at: "09:00" } } };

  it("shows the next run the routine planned, and why it could not be planned", () => {
    const html = renderToStaticMarkup(createElement(NodeSettings, { onPatch: noop, node: daily,
      ctx: { ...ctx, routine: { enabled: true, nextRunAt: Date.UTC(2026, 10, 4, 8) }, routineError: "Choose a time" } }));
    expect(html).toMatch(/data-next-run[^>]*>mer\. 4 nov\.,? 09:00</);
    expect(html).toContain("data-routine-error");
    expect(html).toContain("L&#x27;appli n&#x27;a pas pu le planifier : Choose a time");
    expect(renderToStaticMarkup(createElement(NodeSettings, { onPatch: noop, node: daily, ctx: { ...ctx, routine: { enabled: false, nextRunAt: null } } }))).toContain("En pause dans Automatisations");
  });

  it("an AI-limit trigger picks the AI to wait for", () => {
    const html = renderToStaticMarkup(createElement(NodeSettings, { onPatch: noop, node: { ...daily, data: { mode: "ai-reset", engine: "claude" } },
      ctx: { ...ctx, engines: [{ engine: "claude", name: "Claude", resetsAt: null }, { engine: "codex", name: "Codex", resetsAt: null }] } }));
    expect(html).toContain('<option value="claude" selected="">Claude</option>');
    expect(html).toContain(">Codex</option>");
    expect(html).toContain("Quand sa limite se réinitialise");
  });
});

describe("an existing automation", () => {
  it("is shown read-only: no run, no add, no delete, no wire to cut, and a way to change it in Automations", () => {
    const html = render({ readOnly: true, onOpenAutomation: noop });
    expect(html).toContain("Automatisation existante, affichée ici en lecture seule.");
    expect(html).toContain("La modifier dans Automatisations");
    expect(html).not.toContain("Ajouter un bloc");
    expect(html).not.toContain("Lancer cette étape");
    expect(html).not.toContain("Lancer maintenant");
    expect(html).not.toContain("data-edge-hit");
    expect(html).not.toContain('aria-label="Nom du workflow"');
    expect(html).not.toContain("Ajouter une approbation");
  });
});

describe("run panel", () => {
  it("lists the history newest first, with unknown costs never shown as zero", () => {
    const done: WorkflowRun = { ...run, id: "r0", status: "failed", reason: "Limite de 1 $ atteinte", startedAt: run.startedAt - 1000,
      steps: [{ nodeId: "t", status: "succeeded", costUsd: 0.25 }, { nodeId: "c", status: "failed", costUsd: null, error: "Réponse ni oui ni non" }] };
    const html = renderToStaticMarkup(createElement(RunPanel, { workflow, runs: [run, done], shown: done, openStep: "c", onOpenStep: noop, onShowRun: noop,
      onRetry: noop, onCancel: noop, onClose: noop, locale: "fr", timeZone: "Europe/Paris" }));
    expect(html).toContain("Échouée");
    expect(html).toContain("Limite de 1 $ atteinte");
    expect(html).toContain("Réponse ni oui ni non");
    expect(html).toContain("Réessayer cette étape");
    expect(html).toContain("0,25 $ + 1 au coût inconnu");
    expect(html).toContain("Historique");
  });
});
