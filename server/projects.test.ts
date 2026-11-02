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
    writeProjectMapState(dataDir, state);
    expect(readProjectMapState(dataDir)).toEqual(state);
  });
});
