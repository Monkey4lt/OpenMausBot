import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocale, setLocale } from "@/lib/i18n";
import { levelOf, type Architecture } from "@/lib/projects-architecture-view";
import { ArchitectureView } from "./ArchitectureView";

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
    expect(html.match(/data-edge="ui-&gt;server"/g)).toHaveLength(1);
    expect(html).toContain('stroke-width="3"');
    expect(html).toContain("animate-link-flow");
  });

  it("lists external dependencies at the family level", () => {
    const html = render();
    expect(html).toContain("Dépendances externes");
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
    expect(html).not.toContain("Dépendances externes");
    expect(html).toContain("Déplacer vers…");
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
});
