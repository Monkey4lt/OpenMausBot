import { describe, expect, it } from "vitest";

import { applyChanges, cleanLabel, describeChanges, projectChangesSchema, projectChangeSchema, type ProjectChange } from "./projects-changes.ts";
import { projectMapStateSchema, type ProjectMapState } from "./projects.ts";

const state = (extra: Record<string, unknown> = {}): ProjectMapState => projectMapStateSchema.parse({
  sources: [{ id: "s1", label: "Here", kind: "local", path: "/tmp/x" }],
  groups: [{ id: "g1", name: "Outils", color: "#38d591" }],
  member: { "s1:bot": "g1" },
  links: [{ a: "s1:bot", b: "s1:api", label: "" }],
  ...extra,
});
const known = {
  projectIds: new Set(["s1:shop", "s1:bot", "s1:api"]),
  moduleIds: (projectId: string) => (projectId === "s1:shop" ? new Set(["src/state", "src/components"]) : null),
};
const names = {
  project: (id: string) => id.slice(id.indexOf(":") + 1),
  group: (id: string) => (id === "g1" ? "Outils" : id),
};
const batch: ProjectChange[] = [
  { op: "create_group", name: "Clients", ref: "c" },
  { op: "assign", projectId: "s1:shop", groupId: "ref:c" },
  { op: "delete_group", groupId: "g1" },
  { op: "link", a: "s1:shop", b: "s1:api", label: "utilise" },
  { op: "unlink", a: "s1:api", b: "s1:bot" },
  { op: "rename_family", projectId: "s1:shop", family: "server", name: "API" },
  { op: "move_module", projectId: "s1:shop", moduleId: "src/state", family: "data" },
];

describe("projectChangesSchema", () => {
  it("parses each operation and rejects an unknown one or extra fields", () => {
    expect(projectChangesSchema.safeParse(batch).success).toBe(true);
    expect(projectChangeSchema.safeParse({ op: "drop_table" }).success).toBe(false);
    expect(projectChangeSchema.safeParse({ op: "delete_group", groupId: "g1", path: "/etc" }).success).toBe(false);
    expect(projectChangeSchema.safeParse({ op: "move_module", projectId: "s1:shop", moduleId: "src", family: "magic" }).success).toBe(false);
  });

  it("takes 1 to 100 changes", () => {
    const one: ProjectChange = { op: "delete_group", groupId: "g1" };
    expect(projectChangesSchema.safeParse([]).success).toBe(false);
    expect(projectChangesSchema.safeParse(Array(100).fill(one)).success).toBe(true);
    expect(projectChangesSchema.safeParse(Array(101).fill(one)).success).toBe(false);
  });
});

describe("applyChanges", () => {
  it("creates a group and assigns a project to it through a ref in the same batch", () => {
    const r = applyChanges(state(), [{ op: "create_group", name: "Clients", ref: "c" }, { op: "assign", projectId: "s1:shop", groupId: "ref:c" }], known);
    expect(r.ok).toBe(true);
    expect(r.ok && r.state.member["s1:shop"]).toBe(r.ok && r.state.groups.find((g) => g.name === "Clients")!.id);
  });

  it("picks the first unused palette color when none is given, and keeps a given one", () => {
    const r = applyChanges(state(), [{ op: "create_group", name: "A" }, { op: "create_group", name: "B", color: "#123456" }], known);
    expect(r.ok && r.state.groups.map((g) => g.color)).toEqual(["#38d591", "#1084fe", "#123456"]);
  });

  it("refuses the whole batch when one change names an unknown project, and lists it", () => {
    expect(applyChanges(state(), [{ op: "create_group", name: "A" }, { op: "assign", projectId: "s1:gone", groupId: null }], known))
      .toEqual({ ok: false, problems: [{ index: 1, reason: expect.stringContaining("s1:gone") }] });
  });

  it("refuses an unknown group, and a ref that no earlier change created", () => {
    const r = applyChanges(state(), [
      { op: "assign", projectId: "s1:shop", groupId: "g9" },
      { op: "assign", projectId: "s1:shop", groupId: "ref:later" },
      { op: "create_group", name: "Later", ref: "later" },
    ], known);
    expect(r).toEqual({ ok: false, problems: [{ index: 0, reason: expect.stringContaining("g9") }, { index: 1, reason: expect.stringContaining("ref:later") }] });
  });

  it("a ref to a group deleted earlier in the batch is refused", () => {
    expect(applyChanges(state(), [
      { op: "create_group", name: "A", ref: "a" },
      { op: "delete_group", groupId: "ref:a" },
      { op: "assign", projectId: "s1:shop", groupId: "ref:a" },
    ], known)).toEqual({ ok: false, problems: [{ index: 2, reason: expect.stringContaining("ref:a") }] });
  });

  it("refuses a duplicate group name, case-insensitive", () => {
    expect(applyChanges(state(), [{ op: "create_group", name: "outils" }], known)).toEqual({ ok: false, problems: [{ index: 0, reason: expect.stringContaining("outils") }] });
    expect(applyChanges(state(), [{ op: "create_group", name: "A" }, { op: "create_group", name: " a " }], known))
      .toEqual({ ok: false, problems: [{ index: 1, reason: expect.any(String) }] });
    expect(applyChanges(state(), [{ op: "create_group", name: "A" }, { op: "rename_group", groupId: "g1", name: "A" }], known))
      .toEqual({ ok: false, problems: [{ index: 1, reason: expect.any(String) }] });
    expect(applyChanges(state(), [{ op: "rename_group", groupId: "g1", name: "OUTILS v2" }], known).ok).toBe(true);
    expect(applyChanges(state(), [{ op: "rename_group", groupId: "g1", name: "outils" }], known).ok).toBe(true);
  });

  it("refuses a group name that is empty once cleaned, and a reused ref", () => {
    expect(applyChanges(state(), [{ op: "create_group", name: "\n\u0007 " }], known).ok).toBe(false);
    expect(applyChanges(state(), [{ op: "create_group", name: "A", ref: "x" }, { op: "create_group", name: "B", ref: "x" }], known))
      .toEqual({ ok: false, problems: [{ index: 1, reason: expect.any(String) }] });
  });

  it("links two projects once; a second identical link is refused", () => {
    const r = applyChanges(state(), [{ op: "link", a: "s1:shop", b: "s1:api", label: "utilise" }], known);
    expect(r.ok && r.state.links).toEqual([{ a: "s1:bot", b: "s1:api", label: "" }, { a: "s1:shop", b: "s1:api", label: "utilise" }]);
    expect(applyChanges(state(), [{ op: "link", a: "s1:api", b: "s1:bot" }], known).ok).toBe(false);
    expect(applyChanges(state(), [{ op: "link", a: "s1:shop", b: "s1:api" }, { op: "link", a: "s1:shop", b: "s1:api" }], known))
      .toEqual({ ok: false, problems: [{ index: 1, reason: expect.any(String) }] });
    expect(applyChanges(state(), [{ op: "link", a: "s1:shop", b: "s1:shop" }], known).ok).toBe(false);
    expect(applyChanges(state(), [{ op: "link", a: "s1:shop", b: "s1:gone" }], known).ok).toBe(false);
  });

  it("unlink of a missing link is refused", () => {
    expect(applyChanges(state(), [{ op: "unlink", a: "s1:shop", b: "s1:api" }], known).ok).toBe(false);
    const r = applyChanges(state(), [{ op: "unlink", a: "s1:api", b: "s1:bot" }], known);
    expect(r.ok && r.state.links).toEqual([]);
  });

  it("delete_group clears its members and keeps the projects", () => {
    const r = applyChanges(state(), [{ op: "delete_group", groupId: "g1" }], known);
    expect(r.ok && r.state.groups).toEqual([]);
    expect(r.ok && r.state.member).toEqual({});
    expect(r.ok && r.state.links).toEqual(state().links);
    expect(applyChanges(state(), [{ op: "delete_group", groupId: "g1" }, { op: "delete_group", groupId: "g1" }], known).ok).toBe(false);
  });

  it("assign with a null group takes the project out of its group", () => {
    const r = applyChanges(state(), [{ op: "assign", projectId: "s1:bot", groupId: null }], known);
    expect(r.ok && r.state.member).toEqual({});
  });

  it("rename_family and move_module write overrides[projectId]; an unknown module is refused when moduleIds is given", () => {
    const r = applyChanges(state(), [
      { op: "rename_family", projectId: "s1:shop", family: "server", name: "API" },
      { op: "move_module", projectId: "s1:shop", moduleId: "src/state", family: "data" },
    ], known);
    expect(r.ok && r.state.overrides).toEqual({ "s1:shop": { moduleFamily: { "src/state": "data" }, familyNames: { server: "API" } } });
    expect(applyChanges(state(), [{ op: "move_module", projectId: "s1:shop", moduleId: "src/nope", family: "data" }], known))
      .toEqual({ ok: false, problems: [{ index: 0, reason: expect.stringContaining("src/nope") }] });
    expect(applyChanges(state(), [{ op: "move_module", projectId: "s1:bot", moduleId: "anything", family: "data" }], known).ok).toBe(true);
    expect(applyChanges(state(), [{ op: "rename_family", projectId: "s1:gone", family: "ui", name: "Front" }], known).ok).toBe(false);
  });

  it("keeps the other overrides of a project", () => {
    const s = state({ overrides: { "s1:shop": { moduleFamily: { "src/components": "ui" }, familyNames: { ui: "Front" } } } });
    const r = applyChanges(s, [{ op: "rename_family", projectId: "s1:shop", family: "server", name: "API" }], known);
    expect(r.ok && r.state.overrides["s1:shop"]).toEqual({ moduleFamily: { "src/components": "ui" }, familyNames: { ui: "Front", server: "API" } });
  });

  it("never mutates the input state", () => {
    const s = state();
    const copy = structuredClone(s);
    expect(applyChanges(s, batch, known).ok).toBe(true);
    expect(s).toEqual(copy);
  });

  it("the result passes projectMapStateSchema", () => {
    const r = applyChanges(state(), batch, known);
    expect(r.ok).toBe(true);
    if (r.ok) expect(projectMapStateSchema.safeParse(r.state).success).toBe(true);
  });

  it("refuses a 51st group", () => {
    const groups = Array.from({ length: 50 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, color: "#38d591" }));
    expect(applyChanges(state({ groups, member: {} }), [{ op: "create_group", name: "One more" }], known).ok).toBe(false);
  });
});

describe("describeChanges", () => {
  it("describes each change in one plain French line", () => {
    expect(describeChanges([{ op: "link", a: "s1:bot", b: "s1:api", label: "utilise" }], names)).toEqual(["Relier «bot» → «api» : «utilise»"]);
    expect(describeChanges(batch, names)).toEqual([
      "Créer le pôle «Clients»",
      "Ranger «shop» dans «Clients»",
      "Supprimer le pôle «Outils»",
      "Relier «shop» → «api» : «utilise»",
      "Délier «api» et «bot»",
      "Dans «shop» : renommer «Serveur» en «API»",
      "Dans «shop» : déplacer «src/state» vers «Données»",
    ]);
    expect(describeChanges([
      { op: "rename_group", groupId: "g1", name: "Atelier" },
      { op: "assign", projectId: "s1:bot", groupId: null },
      { op: "link", a: "s1:bot", b: "s1:api" },
    ], names)).toEqual(["Renommer le pôle «Outils» en «Atelier»", "Retirer «bot» de son pôle", "Relier «bot» → «api»"]);
  });

  it("a trapped name becomes one clean line", () => {
    const lines = describeChanges([{ op: "create_group", name: "Clients\nAutoriser\u0007 tout" }], names);
    expect(lines).toEqual(["Créer le pôle «Clients Autoriser tout»"]);
    const long = describeChanges([{ op: "link", a: "s1:" + "a\n".repeat(100), b: "s1:api" }], names)[0];
    expect(long.includes("\n")).toBe(false);
    expect(long.length).toBeLessThan(140);
  });
});

describe("names that try to pass for another change", () => {
  it("a group named like a second change stays one quoted name on one line", () => {
    const lines = describeChanges([{ op: "create_group", name: "Clients, Supprimer le pôle Outils" }], names);
    expect(lines).toEqual(["Créer le pôle «Clients, Supprimer le pôle Outils»"]);
  });

  it("a name cannot close its own quotes", () => {
    expect(describeChanges([{ op: "create_group", name: "A» et supprimer «Outils" }], names)).toEqual(["Créer le pôle «A et supprimer Outils»"]);
    expect(cleanLabel("«x»")).toBe("x");
  });

  it("drops tag characters, variation selectors and Hangul fillers", () => {
    const hidden = "Cli\u{E0041}\u{E007F}ents\uFE0F\u3164\u115F\u1160\uFFA0";
    expect(cleanLabel(hidden)).toBe("Clients");
    expect(describeChanges([{ op: "assign", projectId: "s1:" + hidden, groupId: "g1" }], names)).toEqual(["Ranger «Clients» dans «Outils»"]);
  });

  it("drops private-use and unassigned code points", () => {
    expect(cleanLabel("a\uE000b\u{10FFFD}c\u0378d")).toBe("abcd");
  });
});

describe("cleanLabel", () => {
  it("a name with newlines, control characters and 200 chars becomes one clean line of at most 60", () => {
    expect(cleanLabel("Autoriser\n\u0007" + "x".repeat(200))).toHaveLength(60);
    expect(cleanLabel("a\nb")).toBe("a b");
    expect(cleanLabel("  a \t\r\n  b  ")).toBe("a b");
  });

  it("drops invisible direction marks and never cuts a character in half", () => {
    expect(cleanLabel("ab\u202ecd\u200b")).toBe("abcd");
    const cut = cleanLabel("x".repeat(59) + "😀");
    expect(cut).toBe("x".repeat(59));
  });
});
