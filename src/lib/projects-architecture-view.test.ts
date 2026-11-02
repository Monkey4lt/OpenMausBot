import { describe, expect, it } from "vitest";

import { FAMILY_ORDER as SERVER_FAMILY_ORDER } from "../../server/projects-architecture.ts";
import * as wire from "../../shared/projects-architecture";
import * as wirePieces from "../../shared/projects-pieces";

import {
  cardPieces, flowLayout, linkPhrase, EVIDENCE_WORDS, FAMILY_COLORS, FAMILY_ORDER, PIECE_COLORS, evidenceLine, pieceBadges, pieceLinkRows, summaryPreview, edgeCurve, edgeWidth, layoutGrid, layoutLevel, levelOf, mergeTwoWay, moduleLabel, plainModuleLabel, withFamilyName, withModuleFamily, type Architecture,
} from "./projects-architecture-view";

const arch: Architecture = {
  families: [
    { id: "tests", name: "tests", files: 3, modules: ["src/ui#tests"] },
    { id: "ui", name: "Front", files: 5, modules: ["src/ui", "src/views"] },
    { id: "server", name: "server", files: 4, modules: ["server/routes", "(root)/server"] },
  ],
  modules: [
    { id: "src/ui#tests", family: "tests", files: 3 },
    { id: "src/ui", family: "ui", files: 3 },
    { id: "src/views", family: "ui", files: 2 },
    { id: "server/routes", family: "server", files: 3 },
    { id: "(root)/server", family: "server", files: 1 },
  ],
  files: [
    { path: "src/ui/A.tsx", module: "src/ui", uses: ["server/routes/users.ts", "src/views/V.tsx"], usedBy: [] },
    { path: "src/ui/A.test.tsx", module: "src/ui#tests", uses: ["src/ui/A.tsx"], usedBy: [] },
    { path: "src/views/V.tsx", module: "src/views", uses: [], usedBy: ["src/ui/A.tsx"] },
    { path: "server/routes/users.ts", module: "server/routes", uses: [], usedBy: ["src/ui/A.tsx"] },
  ],
  edges: [
    { level: "family", from: "tests", to: "ui", weight: 1 },
    { level: "family", from: "ui", to: "server", weight: 4 },
    { level: "module", from: "src/ui#tests", to: "src/ui", weight: 1 },
    { level: "module", from: "src/ui", to: "src/views", weight: 2 },
    { level: "module", from: "src/ui", to: "server/routes", weight: 4 },
  ],
  external: [{ name: "react", count: 3 }],
  truncated: false,
};

describe("wire shape", () => {
  it("uses the one family list the server and the page share", () => {
    expect(FAMILY_ORDER).toBe(wire.FAMILY_ORDER);
    expect(SERVER_FAMILY_ORDER).toBe(wire.FAMILY_ORDER);
  });
});

describe("levelOf", () => {
  it("levelOf at the top shows families and family edges", () => {
    expect(levelOf(arch, {})).toEqual({
      nodes: [
        { id: "tests", label: "tests", files: 3 },
        { id: "ui", label: "Front", files: 5 },
        { id: "server", label: "server", files: 4 },
      ],
      edges: [{ from: "tests", to: "ui", weight: 1 }, { from: "ui", to: "server", weight: 4 }],
    });
  });

  it("levelOf inside a family shows its modules and module edges between them", () => {
    expect(levelOf(arch, { family: "ui" })).toEqual({
      nodes: [{ id: "src/ui", label: "ui", files: 3 }, { id: "src/views", label: "views", files: 2 }],
      edges: [{ from: "src/ui", to: "src/views", weight: 2 }],
    });
    expect(levelOf(arch, { family: "server" }).nodes.map((n) => n.id)).toEqual(["(root)/server", "server/routes"]);
  });

  it("levelOf inside a module shows its files and the imports between them", () => {
    expect(levelOf(arch, { family: "ui", module: "src/ui" })).toEqual({
      nodes: [{ id: "src/ui/A.tsx", label: "A.tsx", files: 1 }],
      edges: [],
    });
  });

  it("a family with no modules is an empty level", () => {
    expect(levelOf(arch, { family: "docs" })).toEqual({ nodes: [], edges: [] });
  });
});

describe("labels", () => {
  it.each([
    ["src/components", "components"],
    ["src/ui#tests", "ui (tests)"],
    ["(root)/docs", "(root)"],
    ["(root)/docs#tests", "(root) (tests)"],
    ["constructor", "constructor"],
  ])("%s → %s", (id, label) => expect(moduleLabel(id)).toBe(label));
});

describe("drawing", () => {
  it("a heavier edge is thicker, one import is 1 px", () => {
    expect(edgeWidth(1)).toBe(1);
    expect(edgeWidth(2)).toBe(2);
    expect(edgeWidth(8)).toBe(4);
    expect(edgeWidth(0)).toBe(1);
  });

  it("every family has its own fixed color", () => {
    expect(Object.keys(FAMILY_COLORS).sort()).toEqual([...FAMILY_ORDER].sort());
    expect(new Set(Object.values(FAMILY_COLORS)).size).toBe(FAMILY_ORDER.length);
    for (const color of Object.values(FAMILY_COLORS)) expect(/^#[0-9a-f]{6}$/i.test(color)).toBe(true);
  });

  it("lays nodes out in rows, left to right", () => {
    const rects = layoutGrid(["a", "b", "c", "d", "e"], { perRow: 2, w: 100, h: 50, gapX: 20, gapY: 30, x0: 10, y0: 5 });
    expect(rects).toEqual({
      a: { x: 10, y: 5, w: 100, h: 50 }, b: { x: 130, y: 5, w: 100, h: 50 },
      c: { x: 10, y: 85, w: 100, h: 50 }, d: { x: 130, y: 85, w: 100, h: 50 },
      e: { x: 10, y: 165, w: 100, h: 50 },
    });
    expect(layoutGrid([])).toEqual({});
  });
});

describe("overrides", () => {
  const base = { moduleFamily: { "src/a": "data" as const }, familyNames: {} };

  it("moving a module writes only that project's overrides", () => {
    const state = { sources: [], overrides: { "s1:api": base, "s1:web": { moduleFamily: {}, familyNames: { ui: "x" } } }, zoom: 1 };
    const next = withModuleFamily(state, "s1:api", "src/ui#tests", "ui");
    expect(next).toEqual({ ...state, overrides: { ...state.overrides, "s1:api": { moduleFamily: { "src/a": "data", "src/ui#tests": "ui" }, familyNames: {} } } });
    expect(state.overrides["s1:api"].moduleFamily).toEqual({ "src/a": "data" });
  });

  it("renaming a family starts the project's overrides when it has none, and an empty name clears it", () => {
    const named = withFamilyName({ zoom: 1 }, "s1:api", "ui", "  Front  ");
    expect(named).toEqual({ zoom: 1, overrides: { "s1:api": { moduleFamily: {}, familyNames: { ui: "Front" } } } });
    expect(withFamilyName(named, "s1:api", "ui", " ")).toEqual({ zoom: 1, overrides: { "s1:api": { moduleFamily: {}, familyNames: {} } } });
  });
});

describe("layoutLevel", () => {
  const opts = { perRow: 3, w: 100, h: 50, gapX: 20, gapY: 30, x0: 0, y0: 0 };
  const node = (id: string) => ({ id, label: id, files: 1 });

  it("puts linked nodes in columns by depth and unlinked ones in rows below", () => {
    const rects = layoutLevel({
      nodes: ["tests", "docs", "data", "config", "ui", "server"].map(node),
      edges: [{ from: "tests", to: "ui", weight: 1 }, { from: "tests", to: "server", weight: 1 }, { from: "ui", to: "server", weight: 4 }, { from: "server", to: "data", weight: 3 }],
    }, opts);
    expect([rects.tests.x, rects.ui.x, rects.server.x, rects.data.x]).toEqual([0, 120, 240, 360]);
    expect([rects.tests.y, rects.ui.y, rects.server.y, rects.data.y]).toEqual([0, 0, 0, 0]);
    expect(rects.docs).toEqual({ x: 0, y: 80, w: 100, h: 50 });
    expect(rects.config).toEqual({ x: 120, y: 80, w: 100, h: 50 });
  });

  it("stacks nodes of the same depth in one column, in the given order", () => {
    const rects = layoutLevel({ nodes: ["a", "b", "c"].map(node), edges: [{ from: "a", to: "c", weight: 1 }, { from: "b", to: "c", weight: 1 }] }, opts);
    expect([rects.a, rects.b, rects.c].map((r) => [r.x, r.y])).toEqual([[0, 0], [0, 80], [120, 0]]);
  });

  it("a cycle still gets a finite layout", () => {
    const rects = layoutLevel({ nodes: ["a", "b"].map(node), edges: [{ from: "a", to: "b", weight: 1 }, { from: "b", to: "a", weight: 1 }] }, opts);
    expect([rects.a.x, rects.b.x]).toEqual([0, 120]);
  });

  it("with no links it is the plain grid", () => {
    expect(layoutLevel({ nodes: ["a", "b", "c", "d"].map(node), edges: [] }, opts)).toEqual(layoutGrid(["a", "b", "c", "d"], opts));
  });
});

describe("edgeCurve", () => {
  const A = { x: 0, y: 0, w: 100, h: 50 }, B = { x: 300, y: 0, w: 100, h: 50 };

  it("a straight edge is a line from border to border, its label in the middle", () => {
    expect(edgeCurve(A, B, 0)).toEqual({ d: "M108 25 L292 25", label: [200, 25] });
  });

  it("a bent edge bows to its left, so the two directions of a cycle never overlap", () => {
    const there = edgeCurve(A, B, 40), back = edgeCurve(B, A, 40);
    expect(there.d).toBe("M108 25 Q200 -15 292 25");
    expect(there.label).toEqual([200, 5]);
    expect(back.label[1]).toBeGreaterThan(25);
  });
});

describe("pieces", () => {
  const pieces = [
    { kind: "ui" as const, tech: "React", evidence: [{ path: "package.json", code: "dependency" as const, reason: "depends on react" }], modules: ["src/ui"] },
    { kind: "database" as const, tech: "PostgreSQL", evidence: [{ path: "compose.yml", code: "compose_image" as const, reason: "runs the postgres image" }], modules: [] },
    { kind: "database" as const, tech: "", evidence: [{ path: "migrations/1.sql", code: "migration" as const, reason: "database migration" }], modules: [] },
  ];

  it("labels pieces with the plain word first and the tech second", () => {
    expect(pieceBadges(pieces, "fr")).toEqual([
      { kind: "ui", label: "Site ou appli", tech: "React", modules: ["src/ui"], color: PIECE_COLORS.ui },
      { kind: "database", label: "Base de données", tech: "PostgreSQL", modules: [], color: PIECE_COLORS.database },
      { kind: "database", label: "Base de données", tech: "", modules: [], color: PIECE_COLORS.database },
    ]);
    expect(pieceBadges(pieces, "en")[0]).toMatchObject({ label: "Website or app", tech: "React" });
  });

  it("says each piece of evidence in plain words, in both languages", () => {
    expect(evidenceLine(pieces[0]!.evidence[0]!, "fr")).toBe("package.json : la liste des outils du projet le demande");
    expect(evidenceLine(pieces[1]!.evidence[0]!, "fr")).toBe("compose.yml : un service lancé avec Docker");
    expect(evidenceLine(pieces[2]!.evidence[0]!, "en")).toBe("migrations/1.sql: a change to the database's layout");
    expect(Object.keys(EVIDENCE_WORDS.fr).sort()).toEqual([...wirePieces.EVIDENCE_CODES].sort());
    expect(Object.keys(EVIDENCE_WORDS.en).sort()).toEqual([...wirePieces.EVIDENCE_CODES].sort());
  });

  it("lists piece links with plain words and counts, skipping kinds no piece has", () => {
    expect(pieceLinkRows([{ from: "ui", to: "api", count: 3, examples: [] }, { from: "api", to: "database", count: 1, examples: [] }], "fr"))
      .toEqual([{ from: "ui", to: "api", text: "Site ou appli → Serveur", count: 3 }, { from: "api", to: "database", text: "Serveur → Base de données", count: 1 }]);
  });

  it("previews a summary as its first line, cut to 120", () => {
    expect(summaryPreview("Une boutique en ligne.\nAvec un site.")).toBe("Une boutique en ligne.");
    expect(summaryPreview("\n\n  Deuxième ligne")).toBe("Deuxième ligne");
    expect(summaryPreview(undefined)).toBe("");
    expect(summaryPreview("x".repeat(300))).toBe(`${"x".repeat(119)}…`);
  });
});

describe("drawn edges", () => {
  it("merges a link both ways into one double-headed arrow, keeping one-way links as they are", () => {
    expect(mergeTwoWay([
      { from: "server", to: "data", weight: 3 },
      { from: "ui", to: "server", weight: 4 },
      { from: "data", to: "server", weight: 1 },
    ])).toEqual([
      { from: "server", to: "data", weight: 4, twoWay: true },
      { from: "ui", to: "server", weight: 4, twoWay: false },
    ]);
  });

  it("names the project's top folder in plain words", () => {
    expect(plainModuleLabel("(root)/config", "dossier principal")).toBe("dossier principal");
    expect(plainModuleLabel("(root)/x#tests", "dossier principal")).toBe("dossier principal (tests)");
    expect(plainModuleLabel("src/components", "dossier principal")).toBe("components");
  });
});

describe("cardPieces", () => {
  it("shows each kind once, in the card's order, never tests or deploy, at most three then a count", () => {
    expect(cardPieces(["database", "ui", "ui", "tests", "deploy", "api"])).toEqual({ shown: ["ui", "api", "database"], more: 0 });
    expect(cardPieces(["external", "cache", "database", "jobs", "api", "chatbot", "ui"])).toEqual({ shown: ["ui", "chatbot", "api"], more: 4 });
    expect(cardPieces(["tests", "deploy"])).toEqual({ shown: [], more: 0 });
    expect(cardPieces(undefined)).toEqual({ shown: [], more: 0 });
  });
});

describe("flowLayout", () => {
  const piece = (kind: wirePieces.PieceKind, tech: string, path = "package.json"): wirePieces.Piece =>
    ({ kind, tech, evidence: [{ path, code: "dependency", reason: `depends on ${tech}` }], modules: [] });
  const shop = [piece("ui", "React"), piece("ui", "Vite"), piece("api", "Express"), piece("database", "PostgreSQL"), piece("external", "Stripe"), piece("external", "SendGrid"), piece("tests", ""), piece("deploy", "Docker")];
  const links: wirePieces.PieceLink[] = [
    { from: "ui", to: "api", count: 3, examples: [{ from: "web/A.tsx", to: "server/a.ts" }] },
    { from: "api", to: "database", count: 1, examples: [] },
    { from: "api", to: "external", count: 2, examples: [] },
  ];

  it("puts boxes in the four columns left to right, one box per kind, each outside service on its own", () => {
    const flow = flowLayout(shop, links, undefined, "fr");
    expect(flow.boxes.map((b) => b.key)).toEqual(["ui", "api", "database", "external:SendGrid", "external:Stripe"]);
    const x = (key: string) => flow.boxes.find((b) => b.key === key)!.rect.x;
    expect(x("ui")).toBeLessThan(x("api"));
    expect(x("api")).toBeLessThan(x("database"));
    expect(x("database")).toBeLessThan(x("external:Stripe"));
    expect(x("external:Stripe")).toBe(x("external:SendGrid"));
    expect(flow.columns.map((c) => c.id)).toEqual(["see", "work", "store", "outside"]);
    const ui = flow.boxes.find((b) => b.key === "ui")!;
    expect(ui).toMatchObject({ label: "Site ou appli", text: "Ce que les gens voient et utilisent.", described: false, techs: ["React", "Vite"] });
    expect(ui.pieces).toHaveLength(2);
    expect(flow.boxes.find((b) => b.key === "external:Stripe")).toMatchObject({ label: "Stripe", subtitle: "Service extérieur" });
  });

  it("puts tests and deploy in a quiet row underneath", () => {
    const flow = flowLayout(shop, links, undefined, "fr");
    expect(flow.build.map((b) => b.key)).toEqual(["tests", "deploy"]);
    const bottom = Math.max(...flow.boxes.map((b) => b.rect.y + b.rect.h));
    for (const b of flow.build) expect(b.rect.y).toBeGreaterThan(bottom);
    expect(flowLayout([piece("api", "Express")], [], undefined, "fr").build).toEqual([]);
  });

  it("uses the Cartographe's line for a box when there is one", () => {
    const flow = flowLayout(shop, links, { api: "Prend les commandes.", "external:Stripe": "Encaisse." }, "fr");
    expect(flow.boxes.find((b) => b.key === "api")).toMatchObject({ text: "Prend les commandes.", described: true });
    expect(flow.boxes.find((b) => b.key === "external:Stripe")).toMatchObject({ text: "Encaisse.", described: true });
  });

  it("draws each found link as a phrase, fans the server's link out to every outside service, and drops a link with a missing end", () => {
    const flow = flowLayout(shop, links, undefined, "fr");
    expect(flow.edges.map((e) => [e.fromKey, e.toKey, e.label])).toEqual([
      ["ui", "api", "envoie ses demandes au"],
      ["api", "database", "range les informations dans"],
      ["api", "external:SendGrid", "envoie les e-mails avec"],
      ["api", "external:Stripe", "encaisse les paiements avec"],
    ]);
    expect(new Set(flow.edges.map((e) => e.id)).size).toBe(4);
    for (const e of flow.edges) expect(e.label).not.toMatch(/\d/);
    const noServer = flowLayout([piece("ui", "React"), piece("database", "PostgreSQL")], links, undefined, "fr");
    expect(noServer.edges).toEqual([]);
  });

  it("says each link in plain words in both languages", () => {
    expect(linkPhrase({ from: "api", to: "cache", count: 1, examples: [] }, { kind: "cache", tech: "Redis" }, "fr")).toBe("garde sous la main dans");
    expect(linkPhrase({ from: "api", to: "external", count: 1, examples: [] }, { kind: "external", tech: "Twilio" }, "fr")).toBe("envoie les SMS avec");
    expect(linkPhrase({ from: "api", to: "external", count: 1, examples: [] }, { kind: "external", tech: "AWS" }, "en")).toBe("uses");
    expect(linkPhrase({ from: "ui", to: "api", count: 1, examples: [] }, { kind: "api", tech: "" }, "en")).toBe("sends its requests to");
  });

  it("an empty project lays out nothing", () => {
    expect(flowLayout([], [], undefined, "fr")).toMatchObject({ boxes: [], build: [], edges: [], columns: [] });
  });
});
