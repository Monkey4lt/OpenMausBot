import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import { levelOf, type Architecture, type ArchitectureWithPieces } from "@/lib/projects-architecture-view";
import { fitRects, worldToScreen } from "@/lib/canvas/geometry";
import { ArchitectureView, mapLayout } from "./ArchitectureView";

const arch: Architecture = {
  families: [
    { id: "ui", name: "ui", files: 3, modules: ["src/components"] },
    { id: "server", name: "server", files: 3, modules: ["server/routes"] },
  ],
  modules: [
    { id: "src/components", family: "ui", files: 3 },
    { id: "server/routes", family: "server", files: 3 },
  ],
  files: [
    { path: "src/components/A.tsx", module: "src/components", uses: ["server/routes/users.ts"], usedBy: ["src/components/B.tsx"] },
    { path: "src/components/B.tsx", module: "src/components", uses: ["src/components/A.tsx"], usedBy: [] },
    { path: "src/components/C.tsx", module: "src/components", uses: [], usedBy: [] },
    { path: "server/routes/users.ts", module: "server/routes", uses: [], usedBy: ["src/components/A.tsx"] },
  ],
  edges: [
    { level: "family", from: "ui", to: "server", weight: 4 },
    { level: "module", from: "src/components", to: "server/routes", weight: 4 },
  ],
  external: [{ name: "react", count: 3 }, { name: "zod", count: 1 }],
  truncated: false,
};

const project = { id: "s1:api", name: "api" };
const render = (props: Partial<Parameters<typeof ArchitectureView>[0]> = {}) =>
  renderToStaticMarkup(createElement(ArchitectureView, { project, onBack: () => {}, initial: arch, ...props }));

beforeEach(async () => { await loadLocale("fr"); });
afterEach(() => { setLocale("en"); });

describe("ArchitectureView", () => {
  it("levelOf at the top shows families and family edges", () => {
    expect(levelOf(arch, {}).nodes.map((n) => n.id)).toEqual(["ui", "server"]);
    expect(levelOf(arch, {}).edges).toEqual([{ from: "ui", to: "server", weight: 4 }]);
  });

  it("levelOf inside a family shows its modules and module edges between them", () => {
    expect(levelOf(arch, { family: "ui" }).nodes).toEqual([{ id: "src/components", label: "components", files: 3 }]);
    expect(levelOf(arch, { family: "ui" }).edges).toEqual([]);
  });

  it("renders family names in French", () => {
    const html = render();
    expect(html).toContain("Interface");
    expect(html).toContain("Serveur");
    expect(html).toContain("3 fichiers");
  });

  it("shows the project in the breadcrumb, the back button, and one weighted arrow per family edge", () => {
    const html = render();
    expect(html).toContain("Retour aux projets");
    expect(html).toContain(">api<");
    expect(html.match(/data-canvas-edge="ui-&gt;server"/g)).toHaveLength(1);
    expect(html).toContain('stroke-width="3"');
    expect(html).toMatch(/marker-end="url\(#[^"]*-default\)"/);
  });

  it("the detailed map is the shared canvas, read-only: no block can be dragged", () => {
    const html = render();
    expect(html).toContain('data-canvas="true"');
    expect(html).toContain('data-readonly="true"');
    expect(html).toContain('data-canvas-node="ui"');
    expect(html).not.toContain("cursor-grab");
    expect(html).toContain('aria-label="Afficher la mini-carte"');
    expect(html).not.toContain('aria-label="Crayon"');
  });

  it("import links are solid and piece links dashed in the accent colour", () => {
    const html = render({ initial: { ...withPieces, edges: [...arch.edges, { level: "family" as const, from: "server", to: "ui", weight: 1 }], pieceLinks: [{ from: "api", to: "ui", count: 1, examples: [] }] } });
    const imports = renderToStaticMarkup(createElement(ArchitectureView, { project, onBack: () => {}, initial: arch }));
    expect(imports).toMatch(/data-edge-line[^>]*stroke-width="3"/);
    expect(imports).not.toContain("stroke-dasharray");
    expect(html).toMatch(/data-edge-line[^>]*stroke-dasharray="4 4"[^>]*stroke:var\(--color-accent\)/);
  });

  it("fitting frames every block of the level", () => {
    const viewport = { w: 900, h: 500 };
    for (const focus of [{}, { family: "ui" as const }]) {
      const { rects } = mapLayout(withPieces, focus, undefined);
      const view = fitRects(Object.values(rects), viewport);
      for (const r of Object.values(rects)) {
        const a = worldToScreen(view, r), b = worldToScreen(view, { x: r.x + r.w, y: r.y + r.h });
        expect(a.x).toBeGreaterThanOrEqual(0); expect(a.y).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeLessThanOrEqual(viewport.w); expect(b.y).toBeLessThanOrEqual(viewport.h);
      }
    }
  });

  it("lists outside tools at the family level", () => {
    const html = render();
    expect(html).toContain("Outils externes utilisés");
    expect(html).toContain("react");
    expect(html).toContain("zod");
  });

  it("uses the saved family name over the translated one", () => {
    expect(render({ initial: { ...arch, families: [{ ...arch.families[0], name: "Front" }, arch.families[1]] } })).toContain("Front");
  });

  it("shows the truncated banner when truncated is true", () => {
    expect(render({ initial: { ...arch, truncated: true } })).toContain("Carte partielle");
    expect(render()).not.toContain("Carte partielle");
  });

  it("inside a family shows the breadcrumb and its modules, labelled by their last segment", () => {
    const html = render({ initialFocus: { family: "ui" } });
    expect(html).toContain("Interface");
    expect(html).toContain("components");
    expect(html).not.toContain("Outils externes utilisés");
    expect(html).toMatch(/data-node-toolbar[^>]*>.*Déplacer vers…/);
    expect(html.match(/Déplacer vers…/g)).toHaveLength(1);
  });

  it("calls the project's top folder « dossier principal » inside a family, in its block and its file list", () => {
    const rooted: Architecture = {
      ...arch,
      families: [{ id: "ui", name: "ui", files: 1, modules: ["(root)/ui"] }],
      modules: [{ id: "(root)/ui", family: "ui", files: 1 }],
      files: [{ path: "index.html", module: "(root)/ui", uses: [], usedBy: [] }],
      edges: [],
    };
    expect(render({ initial: rooted, initialFocus: { family: "ui" } })).toContain(">dossier principal<");
    expect(render({ initial: rooted, initialFocus: { family: "ui" } })).not.toContain(">(root)<");
    expect(render({ initial: rooted, initialFocus: { family: "ui", module: "(root)/ui" } })).toContain("Fichiers de dossier principal");
  });

  it("merges links both ways between two families into one double-headed arrow", () => {
    const both = { ...arch, edges: [...arch.edges, { level: "family" as const, from: "server", to: "ui", weight: 2 }] };
    const html = render({ initial: both });
    expect(html.match(/data-canvas-edge=/g)).toHaveLength(1);
    expect(html).toContain('data-canvas-edge="ui&lt;-&gt;server"');
    expect(html).toMatch(/marker-start="url\(#[^"]*-default\)"/);
    expect(html).toContain(">6</span>");
  });

  it("shows each family with its own icon, never two letters, and no all-caps labels", () => {
    const html = render({ initial: withPieces, state: described });
    expect(html).toContain('data-icon="Monitor"');
    expect(html).toContain('data-icon="Server"');
    expect(html).not.toContain(">IN<");
    expect(html).not.toContain("uppercase");
    expect(html).not.toContain("font-mono");
  });

  it("puts the En bref card in a section that can be folded", () => {
    const html = render({ initial: withPieces, state: described });
    expect(html).toMatch(/<details[^>]*open=""[^>]*data-brief|<details[^>]*data-brief[^>]*open=""/);
    expect(html).toMatch(/<summary[^>]*>.*En bref<\/summary>/);
  });

  it("a file panel lists uses and used by", () => {
    const html = render({ initialFocus: { family: "ui", module: "src/components" }, initialFile: "src/components/A.tsx" });
    expect(html).toContain("Fichiers de components");
    expect(html).toContain("Utilise");
    expect(html).toContain("server/routes/users.ts");
    expect(html).toContain("Utilisé par");
    expect(html).toContain("src/components/B.tsx");
    expect(html).toContain("C.tsx");
  });

  it("before a file is chosen, the panel says how to use it", () => {
    expect(render({ initialFocus: { family: "ui", module: "src/components" } })).toContain("Choisissez un fichier");
  });

  it("without data yet, shows the loading state", () => {
    expect(render({ initial: undefined })).toContain("Lecture des fichiers du projet");
  });

  const withPieces: ArchitectureWithPieces = {
    ...arch,
    pieces: [
      { kind: "ui", tech: "React", evidence: [{ path: "package.json", code: "dependency", reason: "depends on react" }], modules: ["src/components"] },
      { kind: "api", tech: "Express", evidence: [{ path: "package.json", code: "dependency", reason: "depends on express" }], modules: ["server/routes"] },
      { kind: "database", tech: "PostgreSQL", evidence: [{ path: "compose.yml", code: "compose_image", reason: "runs the postgres image" }], modules: [] },
    ],
    pieceLinks: [{ from: "ui", to: "api", count: 4, examples: [{ from: "src/components/A.tsx", to: "server/routes/users.ts" }] }],
  };
  const described = { overrides: { "s1:api": { moduleFamily: {}, familyNames: {}, summary: "Une API pour les commandes.\nElle parle à la base.", familyText: { ui: "Ce que voient les clients" }, moduleText: { "src/components": "Les morceaux d'écran" } } } };

  it("shows the En bref summary when present, and an invitation otherwise", () => {
    const html = render({ initial: withPieces, state: described });
    expect(html).toContain("En bref");
    expect(html).toContain("Une API pour les commandes.");
    expect(html).toContain("Elle parle à la base.");
    const empty = render({ initial: withPieces, state: { overrides: {} }, onAskCartographe: () => {} });
    expect(empty).toContain("Demander au Cartographe une fiche En bref");
    expect(render({ initial: withPieces, state: { overrides: {} } })).not.toContain("Demander au Cartographe une fiche En bref");
  });

  it("labels pieces with the plain word first and the tech second", () => {
    const html = render({ initial: withPieces });
    expect(html).toContain("Base de données");
    expect(html).toContain("PostgreSQL");
    expect(html.indexOf("Base de données")).toBeLessThan(html.indexOf("PostgreSQL"));
    expect(html.match(/data-piece=/g)).toHaveLength(3);
  });

  it("a chosen piece shows its evidence in plain words", () => {
    const html = render({ initial: withPieces, initialPiece: 2 });
    expect(html).toContain("compose.yml : un service lancé avec Docker");
  });

  it("shows family and module descriptions under their names", () => {
    expect(render({ initial: withPieces, state: described })).toContain("Ce que voient les clients");
    expect(render({ initial: withPieces, state: described, initialFocus: { family: "ui" } })).toContain("Les morceaux d&#x27;écran");
  });

  it("says the project's main folder in plain words where a piece lives", () => {
    const rooted = { ...withPieces, pieces: [{ ...withPieces.pieces[2]!, modules: ["(root)/config"] }] };
    const html = render({ initial: rooted, initialPiece: 0 });
    expect(html).toContain("Dans : dossier principal");
    expect(html).not.toContain("(root)");
  });

  it("draws piece arrows between the families that hold the code, never the settings", () => {
    const mixed: ArchitectureWithPieces = {
      ...withPieces,
      families: [...arch.families, { id: "config", name: "config", files: 1, modules: ["(root)/config"] }],
      modules: [...arch.modules, { id: "(root)/config", family: "config", files: 1 }],
      pieces: [withPieces.pieces[1]!, { ...withPieces.pieces[2]!, modules: ["(root)/config", "server/routes"] }],
      pieceLinks: [{ from: "api", to: "database", count: 2, examples: [] }],
    };
    expect(render({ initial: mixed })).not.toMatch(/data-edge-line[^>]*stroke:var\(--color-accent\)/);
    const apart: ArchitectureWithPieces = { ...withPieces };
    const html = render({ initial: apart });
    expect(html).toContain('data-canvas-edge="ui-&gt;server"');
    expect(html.match(/stroke-dasharray="4 4"/g)).toHaveLength(1);
    expect(html).toMatch(/data-edge-line[^>]*stroke-dasharray="4 4"[^>]*stroke:var\(--color-accent\)/);
  });

  it("draws piece links with the legend", () => {
    const html = render({ initial: withPieces });
    expect(html).toContain("Liens entre pièces");
    expect(html).toContain("Site / interface → Serveur / API");
    expect(html).toContain('data-piece-link="ui-&gt;api"');
    expect(html).toContain("4 appels");
    expect(render({ initial: { ...withPieces, pieceLinks: [{ ...withPieces.pieceLinks[0]!, count: 1 }] } })).toContain("1 appel<");
    expect(render()).not.toContain("Liens entre pièces");
  });
});

