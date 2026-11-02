import { describe, expect, it } from "vitest";

import type { Architecture } from "../shared/projects-architecture.ts";
import { projectMapStateSchema, type Project } from "./projects.ts";
import { summarizeArchitecture, summarizeMap } from "./projects-summary.ts";

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

  it("cuts files first, then module edges, under the limit", () => {
    const files = Array.from({ length: 3000 }, (_, i) => ({ path: `src/components/F${i}.tsx`, module: "src/components", uses: [], usedBy: [] }));
    const big = { ...arch, files };
    const out = summarizeArchitecture(big, undefined, true);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(20_000);
    expect(out.truncated).toBe(true);
    expect(out.modules).toEqual(arch.modules);
    expect(out.edges).toEqual(arch.edges);
    expect(out.files!.length).toBeGreaterThan(100);
    expect(out.files!.length).toBeLessThan(3000);

    const edges = Array.from({ length: 2000 }, (_, i) => ({ level: "module" as const, from: `m${i}`, to: `n${i}`, weight: 1 }));
    const wide = summarizeArchitecture({ ...arch, edges: [...arch.edges, ...edges] }, undefined, false);
    expect(JSON.stringify(wide).length).toBeLessThanOrEqual(20_000);
    expect(wide.truncated).toBe(true);
    expect(wide.edges[0]).toEqual(arch.edges[0]);
  });
});
