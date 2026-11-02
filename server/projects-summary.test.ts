import { describe, expect, it } from "vitest";

import type { Architecture } from "../shared/projects-architecture.ts";
import { projectMapStateSchema, type Project } from "./projects.ts";
import { summarizeArchitecture, summarizeMap } from "./projects-summary.ts";

const within = (value: unknown, limit = 20_000) => expect(JSON.stringify(value).length).toBeLessThanOrEqual(limit);

const state = projectMapStateSchema.parse({
  sources: [{ id: "s1", label: "VPS", kind: "ssh", host: "me@vps", path: "~/secret/projets" }],
  groups: [{ id: "g1", name: "Clients", color: "#38d591" }],
  member: { "s1:shop": "g1", "s1:gone": "g1", "s1:api": "g-missing" },
  links: [{ a: "s1:shop", b: "s1:api", label: "utilise" }],
  pos: { "s1:shop": { x: 1, y: 2 } },
});

const project = (name: string, extra: Partial<Project> = {}): Project => ({
  id: `s1:${name}`, name, sourceId: "s1", files: 3, dirs: 3, truncated: false,
  tree: [
    { n: "src", t: "d", c: [{ n: "components", t: "d", c: [{ n: "deep", t: "d", c: [{ n: "a.ts", t: "f" }] }] }, { n: "b.ts", t: "f" }] },
    { n: "docs", t: "d", c: [] },
    { n: "README.md", t: "f" },
  ],
  ...extra,
});

describe("summarizeMap", () => {
  it("the Cartographe map summary lists note texts, cleaned and within the 20 000-char cap", () => {
    const noted = projectMapStateSchema.parse({ ...state, annotations: [
      { id: "n1", kind: "sticky", x: 0, y: 0, w: 200, h: 140, text: "Migrer \u202Ela base\u0007 avant juin", color: "accent" },
      { id: "t1", kind: "text", x: 0, y: 0, text: "Clients", size: "m" },
      { id: "s1", kind: "shape", shape: "rect", x: 0, y: 0, w: 10, h: 10 },
      { id: "n2", kind: "sticky", x: 0, y: 0, w: 200, h: 140, text: "   ", color: "accent" },
    ] });
    const out = summarizeMap(noted, [project("shop")], []);
    expect(out.notes).toEqual([{ kind: "sticky", text: "Migrer la base avant juin" }, { kind: "text", text: "Clients" }]);
    expect(out.truncated).toBe(false);
    const crowded = projectMapStateSchema.parse({ ...state, annotations: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, kind: "sticky", x: 0, y: 0, w: 1, h: 1, text: "é".repeat(2000), color: "accent" })) });
    const cut = summarizeMap(crowded, [project("shop")], []);
    within(cut);
    expect(cut.truncated).toBe(true);
    expect(cut.notes.length).toBeGreaterThan(0);
    expect(cut.notes.length).toBeLessThan(40);
    expect(cut.projects).toHaveLength(1);
  });

  it("lists sources without host or path, groups, each project with two levels of folders, links and errors", () => {
    const out = summarizeMap(state, [project("shop"), project("api")], [{ sourceId: "s2", message: "boom" }]);
    expect(out).toEqual({
      sources: [{ id: "s1", label: "VPS", kind: "ssh" }],
      groups: [{ id: "g1", name: "Clients", color: "#38d591" }],
      projects: [
        { id: "s1:shop", name: "shop", source: "s1", groupId: "g1", dirs: 3, files: 3, folders: ["src", "src/components", "docs"] },
        { id: "s1:api", name: "api", source: "s1", groupId: null, dirs: 3, files: 3, folders: ["src", "src/components", "docs"] },
      ],
      links: [{ a: "s1:shop", b: "s1:api", label: "utilise" }],
      errors: [{ sourceId: "s2", message: "boom" }],
      notes: [],
      truncated: false,
    });
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("stays under the limit and says truncated when projects had to be left out", () => {
    const many = Array.from({ length: 2000 }, (_, i) => project(`p${String(i).padStart(4, "0")}`));
    const out = summarizeMap(state, many, []);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(20_000);
    expect(out.truncated).toBe(true);
    expect(out.projects.length).toBeGreaterThan(50);
    expect(out.projects[0].id).toBe("s1:p0000");
    expect(out.groups).toEqual(state.groups);
  });

  it("drops the second level of folders before dropping projects", () => {
    const many = Array.from({ length: 150 }, (_, i) => project(`p${i}`));
    const full = JSON.stringify(summarizeMap(state, many, [], 1_000_000)).length;
    const out = summarizeMap(state, many, [], full - 10);
    expect(out.projects).toHaveLength(150);
    expect(out.projects[0].folders).toEqual(["src", "docs"]);
    expect(out.truncated).toBe(true);
  });

  it("honours a small limit even when only links are left to cut", () => {
    const linked = projectMapStateSchema.parse({ ...state, links: Array.from({ length: 400 }, (_, i) => ({ a: `s1:a${i}`, b: `s1:b${i}`, label: "x".repeat(40) })) });
    const out = summarizeMap(linked, [project("shop")], [], 3_000);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(3_000);
    expect(out.truncated).toBe(true);
  });
});

const arch: Architecture = {
  families: [{ id: "ui", name: "Front", files: 2, modules: ["src/components"] }, { id: "server", name: "server", files: 1, modules: ["src/server"] }],
  modules: [{ id: "src/components", family: "ui", files: 2 }, { id: "src/server", family: "server", files: 1 }],
  files: [
    { path: "src/components/A.tsx", module: "src/components", uses: ["src/server/x.ts"], usedBy: [] },
    { path: "src/components/B.tsx", module: "src/components", uses: [], usedBy: [] },
    { path: "src/server/x.ts", module: "src/server", uses: [], usedBy: ["src/components/A.tsx"] },
  ],
  edges: [{ level: "family", from: "ui", to: "server", weight: 1 }, { level: "module", from: "src/components", to: "src/server", weight: 1 }],
  external: [{ name: "zod", count: 2 }],
  truncated: false,
};

describe("summarizeArchitecture", () => {
  it("gives families, modules, edges, external deps and saved corrections, without files", () => {
    const overrides = { moduleFamily: { "src/components": "ui" as const }, familyNames: { ui: "Front" } };
    expect(summarizeArchitecture(arch, overrides, false)).toEqual({
      families: [{ id: "ui", name: "Front", files: 2 }, { id: "server", name: "server", files: 1 }],
      modules: arch.modules,
      edges: arch.edges,
      external: arch.external,
      overrides,
      truncated: false,
    });
  });

  it("adds file paths only with includeFiles, and empty corrections when none are saved", () => {
    const out = summarizeArchitecture(arch, undefined, true);
    expect(out.files).toEqual(["src/components/A.tsx", "src/components/B.tsx", "src/server/x.ts"]);
    expect(out.overrides).toEqual({ moduleFamily: {}, familyNames: {} });
  });

  it("keeps the server's own truncated flag", () => {
    expect(summarizeArchitecture({ ...arch, truncated: true }, undefined, false).truncated).toBe(true);
  });

  it("gives files a page at a time, 300 unless asked, with nextOffset while more remain", () => {
    const files = Array.from({ length: 3000 }, (_, i) => ({ path: `F${String(i).padStart(4, "0")}.ts`, module: "src/components", uses: [], usedBy: [] }));
    const big = { ...arch, files };
    const out = summarizeArchitecture(big, undefined, true);
    expect(out.files).toHaveLength(300);
    expect(out.nextOffset).toBe(300);
    expect(out.truncated).toBe(false);
    const next = summarizeArchitecture(big, undefined, { offset: 300, limit: 1000 });
    expect(next.files![0]).toBe("F0300.ts");
    expect(next.files).toHaveLength(1000);
    expect(next.nextOffset).toBe(1300);
    const last = summarizeArchitecture(big, undefined, { offset: 2900, limit: 5000 });
    expect(last.files).toHaveLength(100);
    expect(last.nextOffset).toBeUndefined();
    expect(summarizeArchitecture(big, undefined, { offset: 9999 }).files).toEqual([]);
  });

  it("narrows files to one module or one family, the other family included", () => {
    const withOther = { ...arch, families: [...arch.families, { id: "other" as const, name: "other", files: 1, modules: ["(root)/other"] }], modules: [...arch.modules, { id: "(root)/other", family: "other" as const, files: 1 }], files: [...arch.files, { path: "notes.txt", module: "(root)/other", uses: [], usedBy: [] }] };
    expect(summarizeArchitecture(withOther, undefined, { module: "src/server" }).files).toEqual(["src/server/x.ts"]);
    expect(summarizeArchitecture(withOther, undefined, { family: "ui" }).files).toEqual(["src/components/A.tsx", "src/components/B.tsx"]);
    expect(summarizeArchitecture(withOther, undefined, { family: "other" }).files).toEqual(["notes.txt"]);
    expect(summarizeArchitecture(withOther, undefined, { module: "nope" }).files).toEqual([]);
  });

  it("cuts a page of files to stay under the limit, and nextOffset says where to go on", () => {
    const files = Array.from({ length: 3000 }, (_, i) => ({ path: `src/components/${"deep/".repeat(10)}F${i}.tsx`, module: "src/components", uses: [], usedBy: [] }));
    const out = summarizeArchitecture({ ...arch, files }, undefined, { limit: 1000 });
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(20_000);
    expect(out.files!.length).toBeGreaterThan(100);
    expect(out.files!.length).toBeLessThan(1000);
    expect(out.nextOffset).toBe(out.files!.length);
    expect(out.modules).toEqual(arch.modules);
  });

  it("cuts module edges under the limit", () => {

    const edges = Array.from({ length: 2000 }, (_, i) => ({ level: "module" as const, from: `m${i}`, to: `n${i}`, weight: 1 }));
    const wide = summarizeArchitecture({ ...arch, edges: [...arch.edges, ...edges] }, undefined, false);
    expect(JSON.stringify(wide).length).toBeLessThanOrEqual(20_000);
    expect(wide.truncated).toBe(true);
    expect(wide.edges[0]).toEqual(arch.edges[0]);
  });
});

describe("the 20 000-character guarantee", () => {
  it("cuts one huge error to a short flat line without hosts or paths", () => {
    const message = `ssh: connect to host me@vps.example.com port 22 failed in /home/raph/secret/projets\n${"x".repeat(30_000)}`;
    const out = summarizeMap(state, [project("shop")], [{ sourceId: "s1", message }]);
    within(out);
    expect(out.errors[0]!.message.length).toBeLessThanOrEqual(300);
    expect(out.errors[0]!.message.includes("\n")).toBe(false);
    expect(out.errors[0]!.message).not.toContain("/home/raph");
    expect(out.errors[0]!.message).not.toContain("me@vps.example.com");
    expect(out.errors[0]!.message).not.toContain("secret");
  });

  it("cleans group and source names and stays under the limit with 50 groups and 20 sources", () => {
    const groups = Array.from({ length: 50 }, (_, i) => ({ id: `g${i}`, name: `Pôle\u0007\u202e ${i} ${"n".repeat(40)}`, color: "#38d591" }));
    const sources = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, label: `Src\u0000\n${i}${"l".repeat(50)}`, kind: "local", path: `/srv/${i}` }));
    const big = projectMapStateSchema.parse({ sources, groups });
    const projects = Array.from({ length: 3000 }, (_, i) => project(`p${i}`));
    const errors = Array.from({ length: 200 }, (_, i) => ({ sourceId: `s${i % 20}`, message: "e".repeat(1000) }));
    const out = summarizeMap(big, projects, errors);
    within(out);
    expect(out.truncated).toBe(true);
    for (const g of out.groups) expect(/[\u0000-\u001f\u202e]/.test(g.name)).toBe(false);
    for (const src of out.sources) expect(/[\u0000-\u001f]/.test(src.label)).toBe(false);
    for (const limit of [2_000, 500, 100]) within(summarizeMap(big, projects, errors, limit), limit);
  });

  it("keeps only the saved corrections of modules that still exist, and stays under the limit with 2 000 of them", () => {
    const moduleFamily = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`src/gone-${i}-${"m".repeat(40)}`, "data" as const]));
    const overrides = { moduleFamily: { ...moduleFamily, "src/components": "ui" as const }, familyNames: { ui: "Front" } };
    const out = summarizeArchitecture(arch, overrides, false);
    within(out);
    expect(out.overrides).toEqual({ moduleFamily: { "src/components": "ui" }, familyNames: { ui: "Front" } });
  });

  it("never passes the limit, even when every module is kept and the limit is tiny", () => {
    const modules = Array.from({ length: 2000 }, (_, i) => ({ id: `src/m${i}-${"z".repeat(60)}`, family: "server" as const, files: 1 }));
    const moduleFamily = Object.fromEntries(modules.map((m) => [m.id, "data" as const]));
    const wide = { ...arch, modules, families: [{ id: "server" as const, name: "server", files: 2000, modules: modules.map((m) => m.id) }] };
    for (const limit of [20_000, 1_000, 200]) within(summarizeArchitecture(wide, { moduleFamily, familyNames: {} }, true, limit), limit);
  });
});
