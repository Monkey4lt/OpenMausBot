import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findProject, projectMapStateSchema, projectsFromLines, withoutStamp, readProjectMapState, scanLocalLines, sshFindCommand, writeProjectMapState } from "./projects.ts";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "projmap-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("projects map", () => {
  it("turns each first-level folder into a project with its tree, skipping hidden and heavy folders", () => {
    const root = tmp();
    mkdirSync(join(root, "api", "src", "utils"), { recursive: true });
    mkdirSync(join(root, "api", "node_modules", "x"), { recursive: true });
    mkdirSync(join(root, ".secret"), { recursive: true });
    writeFileSync(join(root, "api", "src", "utils", "a.ts"), "");
    writeFileSync(join(root, "api", "README.md"), "");
    writeFileSync(join(root, "api", ".env"), "");
    writeFileSync(join(root, "loose.txt"), "");

    const [api, ...rest] = projectsFromLines("local", scanLocalLines(root));
    expect(rest).toEqual([]);
    expect(api).toMatchObject({ id: "local:api", name: "api", dirs: 2, files: 2, truncated: false });
    expect(api.tree).toEqual([
      { n: "src", t: "d", c: [{ n: "utils", t: "d", c: [{ n: "a.ts", t: "f" }] }] },
      { n: "README.md", t: "f" },
    ]);
  });

  it("quotes the remote path and keeps a leading ~ for the remote shell", () => {
    expect(sshFindCommand("~/my proj's")).toContain(`find ~/'my proj'\\''s' `);
    expect(sshFindCommand("/srv/app; rm -rf /")).toContain(`find '/srv/app; rm -rf /' `);
  });

  it("with stamps, the remote find also prints each file's mtime and size, which the tree ignores", () => {
    expect(sshFindCommand("/srv")).not.toContain("%T@");
    expect(sshFindCommand("/srv", { stamps: true })).toContain("-printf 'f %P\\t%T@ %s\\n'");
    expect(withoutStamp("f api/a.ts\t1730000000.5 120")).toBe("f api/a.ts");
    expect(withoutStamp("d api")).toBe("d api");
    expect(projectsFromLines("s", ["d api", "f api/a.ts\t1730000000.5 120"])[0].tree).toEqual([{ n: "a.ts", t: "f" }]);
  });

  it("refuses an SSH host that looks like an option", () => {
    const source = { id: "s1", label: "x", kind: "ssh", path: "/" };
    expect(projectMapStateSchema.safeParse({ sources: [{ ...source, host: "-oProxyCommand=x" }] }).success).toBe(false);
    expect(projectMapStateSchema.safeParse({ sources: [source] }).success).toBe(false);
    expect(projectMapStateSchema.safeParse({ sources: [{ ...source, host: "me@vps" }] }).success).toBe(true);
    expect(projectMapStateSchema.safeParse({ sources: [{ ...source, host: "me@vps", path: "-delete" }] }).success).toBe(false);
    expect(projectMapStateSchema.safeParse({ sources: [{ ...source, host: "me@vps", path: "  -x" }] }).success).toBe(false);
    expect(projectMapStateSchema.safeParse({ sources: [{ ...source, host: "me@vps", path: "srv/-x" }] }).success).toBe(true);
  });

  it("accepts a GitHub account or repository, nothing else", () => {
    const github = (path: string) => projectMapStateSchema.safeParse({ sources: [{ id: "g1", label: "GitHub", kind: "github", path }] }).success;
    expect(github("octocat")).toBe(true);
    expect(github("octocat/Hello-World")).toBe(true);
    expect(github("octocat/a/b")).toBe(false);
    expect(github("../etc")).toBe(false);
  });

  it("the saved state keeps overrides per project and rejects an unknown family", () => {
    const overrides = { "local:api": { moduleFamily: { "src/state": "data" }, familyNames: { ui: "Front" } } };
    const parsed = projectMapStateSchema.safeParse({ overrides });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.overrides).toEqual(overrides);
    expect(projectMapStateSchema.parse({}).overrides).toEqual({});
    expect(projectMapStateSchema.parse({ overrides: { "local:api": {} } }).overrides).toEqual({ "local:api": { moduleFamily: {}, familyNames: {} } });
    expect(projectMapStateSchema.safeParse({ overrides: { "local:api": { moduleFamily: { "src/state": "magic" }, familyNames: {} } } }).success).toBe(false);
    expect(projectMapStateSchema.safeParse({ overrides: { "local:api": { moduleFamily: {}, familyNames: { magic: "x" } } } }).success).toBe(false);
    const described = { "local:api": { moduleFamily: {}, familyNames: {}, summary: "Une API.\nSimple.", familyText: { ui: "Écrans" }, moduleText: { "src/state": "Le panier" } } };
    expect(projectMapStateSchema.parse({ overrides: described }).overrides).toEqual(described);
    expect(projectMapStateSchema.safeParse({ overrides: { "local:api": { summary: "x".repeat(601) } } }).success).toBe(false);
    expect(projectMapStateSchema.safeParse({ overrides: { "local:api": { familyText: { ui: "x".repeat(161) } } } }).success).toBe(false);
    expect(projectMapStateSchema.safeParse({ overrides: { "local:api": { moduleText: { "src/a": "x".repeat(161) } } } }).success).toBe(false);
  });

  it("findProject maps an id back to its source and folder", () => {
    const state = projectMapStateSchema.parse({ sources: [
      { id: "s1", label: "VPS", kind: "ssh", host: "me@vps", path: "~/projets" },
      { id: "g1", label: "GitHub", kind: "github", path: "octo" },
      { id: "g2", label: "One", kind: "github", path: "octo/web" },
    ] });
    expect(findProject(state, "s1:api")).toEqual({ source: state.sources[0], name: "api" });
    expect(findProject(state, "g1:web")?.source.id).toBe("g1");
    expect(findProject(state, "g2:Web")?.name).toBe("Web");
    for (const id of ["g2:other", "s1:a/b", "s1:..", "s1:.git", "s1:node_modules", "zz:api", "s1:", "nocolon", ""]) expect(findProject(state, id)).toBeNull();
    for (const id of ["g1:we b", "g1:a?b", "g1:a#b", "g1:%2e%2e", "g1:é", `g1:${"x".repeat(101)}`, "g1:..", "g1:."]) expect(findProject(state, id)).toBeNull();
    expect(findProject(state, "g1:my.repo-2_x")?.name).toBe("my.repo-2_x");
    expect(findProject(state, "s1:mon projet")?.name).toBe("mon projet");
    for (const id of [`s1:${"x".repeat(200)}`, "s1:a\u0000b", "s1:a\nb", "s1:a\u007fb"]) expect(findProject(state, id)).toBeNull();
  });

  it("saves and reads the layout, and starts empty without a file", () => {
    const dataDir = tmp();
    expect(readProjectMapState(dataDir).sources).toEqual([]);
    const state = projectMapStateSchema.parse({ groups: [{ id: "g1", name: "Clients", color: "#38d591" }], member: { "local:api": "g1" } });
    const written = writeProjectMapState(dataDir, state);
    expect(written).toEqual({ ...state, rev: 1 });
    expect(readProjectMapState(dataDir)).toEqual(written);
  });

  it("each write bumps rev from what is on disk", () => {
    const dataDir = tmp();
    expect(readProjectMapState(dataDir).rev).toBe(0);
    expect(writeProjectMapState(dataDir, projectMapStateSchema.parse({})).rev).toBe(1);
    expect(writeProjectMapState(dataDir, projectMapStateSchema.parse({ rev: 0 })).rev).toBe(2);
    expect(writeProjectMapState(dataDir, projectMapStateSchema.parse({ rev: 40 })).rev).toBe(3);
    expect(readProjectMapState(dataDir).rev).toBe(3);
  });

  it("a file saved before rev existed reads as rev 0", () => {
    const dataDir = tmp();
    writeFileSync(join(dataDir, "projects-map.json"), JSON.stringify({ groups: [{ id: "g1", name: "Clients", color: "#38d591" }] }));
    expect(readProjectMapState(dataDir)).toMatchObject({ rev: 0, groups: [{ id: "g1" }] });
    expect(projectMapStateSchema.safeParse({ rev: -1 }).success).toBe(false);
    expect(projectMapStateSchema.safeParse({ rev: 1.5 }).success).toBe(false);
  });

  it("the server schema accepts the annotations of task 2 and rejects 501 of them", () => {
    const annotations = [
      { id: "n1", kind: "sticky", x: 10, y: 20, w: 200, h: 140, text: "Penser aux factures", color: "accent" },
      { id: "t1", kind: "text", x: -40, y: 5, text: "Clients", size: "l" },
      { id: "s1", kind: "shape", shape: "diamond", x: 0, y: 0, w: 80, h: 60 },
      { id: "i1", kind: "ink", points: [{ x: 0, y: 0 }, { x: 10, y: 4 }, { x: 30, y: 30 }] },
    ];
    const parsed = projectMapStateSchema.parse({ annotations });
    expect(parsed.annotations).toEqual(annotations);
    expect(projectMapStateSchema.parse({}).annotations).toEqual([]);
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `n${i}`, kind: "text", x: i, y: 0, text: "x", size: "s" }));
    expect(projectMapStateSchema.safeParse({ annotations: many }).success).toBe(false);
    expect(projectMapStateSchema.safeParse({ annotations: many.slice(0, 500) }).success).toBe(true);
  });

  it("a 10 000-char note with control characters is cleaned and cut to 2 000 on save", () => {
    const dataDir = tmp();
    const text = `a\u0000b\u202Ec\n${"x".repeat(10_000)}`;
    const state = projectMapStateSchema.parse({ annotations: [{ id: "n1", kind: "sticky", x: 0, y: 0, w: 200, h: 140, text, color: "nope" }, { id: "bad", kind: "sticky", x: Number.NaN }] });
    writeProjectMapState(dataDir, state);
    const [note, ...rest] = readProjectMapState(dataDir).annotations;
    expect(rest).toEqual([]);
    expect(note).toMatchObject({ kind: "sticky", color: "warning" });
    const saved = (note as { text: string }).text;
    expect(saved).toHaveLength(2000);
    expect(saved.startsWith("abc\nxxx")).toBe(true);
  });

  it("an old saved map without annotations reads with none and keeps its zoom", () => {
    const dataDir = tmp();
    writeFileSync(join(dataDir, "projects-map.json"), JSON.stringify({ zoom: 0.8, pos: { "s1:a": { x: 40, y: 60 } }, rev: 3 }));
    expect(readProjectMapState(dataDir)).toMatchObject({ zoom: 0.8, pos: { "s1:a": { x: 40, y: 60 } }, annotations: [], rev: 3 });
  });
});

