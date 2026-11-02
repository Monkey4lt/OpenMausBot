import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CODE_EXTENSIONS } from "./projects-architecture.ts";
import { setGithubTransport } from "./projects-github.ts";
import {
  isCodeFile, MAX_FILE_BYTES, parseGrepOutput, parseSshImportOutput, readGithubImports, readLocalImports, readSshImports, sshImportCommand, toPosix, unpackGithubTarball,
} from "./projects-sources.ts";
import { tar } from "./testing/tar-builder.ts";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "projmap-src-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fixture(files: Record<string, string>): string {
  const root = tmp();
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, ...path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...path.split("/")), text);
  }
  return root;
}

describe("local import reading", () => {
  it("reads imports of code files only, under 256 KB", async () => {
    const root = fixture({
      "src/a.ts": 'import b from "./b";\nimport c from "./c";',
      "src/big.ts": 'import x from "./x";\n' + "//".repeat(MAX_FILE_BYTES / 2 + 10),
      "src/empty.ts": "",
      "logo.png": "import x from './no'",
      "README.md": "import x from './no'",
    });
    const set = await readLocalImports(root, ["src/a.ts", "src/big.ts", "src/empty.ts", "logo.png", "README.md"]);
    expect(set.read).toEqual([
      { path: "src/a.ts", imports: [{ spec: "./b", line: 1 }, { spec: "./c", line: 2 }] },
      { path: "src/empty.ts", imports: [] },
    ]);
  });

  it("a listed file that vanished is skipped, not an error", async () => {
    const root = fixture({ "a.ts": 'import "./b";' });
    expect((await readLocalImports(root, ["a.ts", "gone.ts"])).read).toEqual([{ path: "a.ts", imports: [{ spec: "./b", line: 1 }] }]);
  });

  it("returns the tsconfig text when present", async () => {
    const tsconfig = '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }';
    const set = await readLocalImports(fixture({ "tsconfig.json": tsconfig, "go.mod": "module example.com/app\n" }), []);
    expect(set).toEqual({ read: [], tsconfig, goMod: "module example.com/app\n" });
    expect(await readLocalImports(fixture({ "a.ts": "" }), [])).toEqual({ read: [], tsconfig: null, goMod: null });
  });

  it("falls back to tsconfig.app.json when tsconfig.json has no paths", async () => {
    const app = '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }';
    const root = fixture({ "tsconfig.json": '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }', "tsconfig.app.json": app });
    expect((await readLocalImports(root, [])).tsconfig).toBe(app);
    const plain = '{ "compilerOptions": { "strict": true } }';
    expect((await readLocalImports(fixture({ "tsconfig.json": plain }), [])).tsconfig).toBe(plain);
  });

  it("converts Windows separators", () => {
    expect(toPosix("src\\lib\\a.ts")).toBe("src/lib/a.ts");
    expect(toPosix("src/lib/a.ts")).toBe("src/lib/a.ts");
  });

  it("takes Windows-style paths in and gives posix paths out", async () => {
    const root = fixture({ "src/lib/a.ts": 'import "../b";' });
    expect((await readLocalImports(root, ["src\\lib\\a.ts"])).read).toEqual([{ path: "src/lib/a.ts", imports: [{ spec: "../b", line: 1 }] }]);
  });

  it("refuses paths that leave the project", async () => {
    const outer = fixture({ "secret.ts": 'import "./leak";' });
    const root = join(outer, "inner");
    mkdirSync(root);
    expect((await readLocalImports(root, ["../secret.ts", "/etc/passwd.ts"])).read).toEqual([]);
  });

  it("never follows a symlink, to a file or through a folder", async () => {
    const outer = fixture({ "secret.ts": 'import "./leak";', "secrets/x.ts": 'import "./leak";' });
    const root = join(outer, "inner");
    mkdirSync(root);
    writeFileSync(join(root, "a.ts"), 'import "./b";');
    symlinkSync(join(outer, "secret.ts"), join(root, "link.ts"));
    symlinkSync(join(outer, "secrets"), join(root, "dir"));
    const set = await readLocalImports(root, ["a.ts", "link.ts", "dir/x.ts"]);
    expect(set.read.map((f) => f.path)).toEqual(["a.ts"]);
  });

  it("reads a file whose name starts with two dots", async () => {
    const root = fixture({ "..foo.ts": 'import "./b";', "src/..bar.ts": "" });
    expect((await readLocalImports(root, ["..foo.ts", "src/..bar.ts"])).read.map((f) => f.path)).toEqual(["..foo.ts", "src/..bar.ts"]);
  });

  it("stops at the limit", async () => {
    const root = fixture({ "a.ts": "", "b.ts": "", "c.ts": "", "d.ts": "" });
    expect((await readLocalImports(root, ["a.ts", "b.ts", "c.ts", "d.ts"], 2)).read.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("isCodeFile follows the shared extension list", () => {
    expect(CODE_EXTENSIONS.every((ext) => isCodeFile(`x${ext}`))).toBe(true);
    expect(isCodeFile("SRC/A.TS")).toBe(true);
    expect(isCodeFile("README.md")).toBe(false);
    expect(isCodeFile("Makefile")).toBe(false);
  });
});

describe("SSH import reading", () => {
  it("quotes the path and keeps ~ for the remote shell", () => {
    expect(sshImportCommand("~/my proj's/api")).toContain(`cd ~/'my proj'\\''s/api'`);
    expect(sshImportCommand("/srv/app; rm -rf /")).toContain(`cd '/srv/app; rm -rf /' `);
    expect(sshImportCommand("~")).toContain("cd ~ ");
  });

  it("excludes hidden and heavy folders and only greps code extensions", () => {
    const c = sshImportCommand("/srv/api");
    expect(c).toContain("--exclude-dir=node_modules");
    expect(c).toContain("--exclude-dir='.[!.]*'");
    expect(c).toContain("--include='*.ts'");
    expect(c).toContain("--include='*.svelte'");
    expect(c).not.toContain("--include='*.md'");
    expect(c).toContain("grep -rEnIZ");
    expect(c).toContain("--exclude='*.min.*'");
    expect(c).toContain("| cut -c1-4096 | head -n 200000");
    for (const marker of ["---TSCONFIG---", "---TSCONFIG_APP---", "---GOMOD---"]) expect(c).toContain(`printf '\\n${marker}\\n'`);
    expect(c).toContain("head -c 262144 tsconfig.json 2>/dev/null");
  });

  it("parses ./path:line:text output into imports per file", () => {
    expect(parseGrepOutput('./src/a.ts:3:import b from "./b";\n./app/x.py:1:from .m import y\n')).toEqual([
      { path: "src/a.ts", imports: [{ spec: "./b", line: 3 }] }, { path: "app/x.py", imports: [{ spec: ".m.y", line: 1 }] },
    ]);
  });

  it("a path containing a colon is split on the first :<digits>: only", () => {
    expect(parseGrepOutput('./src/we:ird.ts:12:import x from "./y:2:z";\n')).toEqual([
      { path: "src/we:ird.ts", imports: [{ spec: "./y:2:z", line: 12 }] },
    ]);
  });

  it("with grep -Z the file name ends at the NUL, whatever it contains", () => {
    expect(parseGrepOutput('./src/a:1:b.ts\u00007:import x from "./y";\n./c.ts\u00001:import "./d";\n')).toEqual([
      { path: "src/a:1:b.ts", imports: [{ spec: "./y", line: 7 }] },
      { path: "c.ts", imports: [{ spec: "./d", line: 1 }] },
    ]);
  });

  it("reads CRLF files as LF ones", () => {
    expect(parseGrepOutput('./a.ts\u00001:import {\r\n./a.ts\u00003:} from "./b";\r\n./c.ts:2:import "./d";\r\n')).toEqual([
      { path: "a.ts", imports: [{ spec: "./b", line: 1 }] },
      { path: "c.ts", imports: [{ spec: "./d", line: 2 }] },
    ]);
  });

  it("ignores lines that are not code files or have no line number", () => {
    expect(parseGrepOutput('./README.md:1:import x from "./y";\ngrep: warning\n./a.ts:x:import "./b";\n')).toEqual([]);
  });

  it("joins a file's matched lines so a multi-line import is still found at its line", () => {
    const out = [
      "./src/a.tsx:4:import {",
      './src/a.tsx:9:} from "./ab";',
      './src/a.tsx:10:const x = require("./r");',
      "./main.go:3:import (",
      './main.go:4:  "fmt"',
      './main.go:5:  db "example.com/app/db"',
      "./main.go:6:)",
      "./src/lib.rs:1:use crate::api::routes;",
      "./src/lib.rs:2:mod db;",
    ].join("\n");
    expect(parseGrepOutput(out)).toEqual([
      { path: "src/a.tsx", imports: [{ spec: "./ab", line: 4 }, { spec: "./r", line: 10 }] },
      { path: "main.go", imports: [{ spec: "fmt", line: 4 }, { spec: "example.com/app/db", line: 5 }] },
      { path: "src/lib.rs", imports: [{ spec: "crate::api::routes", line: 1 }, { spec: "self::db", line: 2 }] },
    ]);
  });

  it("a multi-line Python name list keeps only the names grep saw", () => {
    const out = "./app/x.py:1:from . import (\n./app/x.py:4:)\n./app/x.py:5:from .db import (a,\n";
    expect(parseGrepOutput(out)).toEqual([{ path: "app/x.py", imports: [{ spec: ".", line: 1 }, { spec: ".db.a", line: 5 }] }]);
  });

  it("splits a captured output into imports, tsconfig and go.mod", () => {
    const tsconfig = '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }';
    const out = `./src/a.ts\u00001:import b from "@/b";\n\n---TSCONFIG---\n{ "files": [] }\n\n---TSCONFIG_APP---\n${tsconfig}\n---GOMOD---\nmodule example.com/app\n`;
    expect(parseSshImportOutput(out)).toEqual({
      read: [{ path: "src/a.ts", imports: [{ spec: "@/b", line: 1 }] }],
      tsconfig,
      goMod: "module example.com/app\n",
    });
    expect(parseSshImportOutput("\n---TSCONFIG---\n\n---TSCONFIG_APP---\n\n---GOMOD---\n")).toEqual({ read: [], tsconfig: null, goMod: null });
    expect(parseSshImportOutput("")).toEqual({ read: [], tsconfig: null, goMod: null });
  });

  it("runs one ssh command with the host after --, in batch mode", async () => {
    const calls: { args: string[]; timeout: number; maxBuffer: number }[] = [];
    const set = await readSshImports("me@vps", "/srv/api", async (args, options) => {
      calls.push({ args, ...options });
      return './a.ts\u00001:import "./b";\n\n---TSCONFIG---\n\n---TSCONFIG_APP---\n\n---GOMOD---\n';
    });
    expect(set.read).toEqual([{ path: "a.ts", imports: [{ spec: "./b", line: 1 }] }]);
    expect(calls).toEqual([{
      args: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", "me@vps", sshImportCommand("/srv/api")],
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    }]);
  });
});

describe("SSH grep command on a real shell", () => {
  it("finds import lines, Go block lines and the config files, and skips hidden and heavy folders", async () => {
    const { execFileSync } = await import("node:child_process");
    const root = fixture({
      "src/a.tsx": 'const x = 1;\nimport {\n  a,\n} from "./ab";\nconst r = require("./r");\n',
      "src/crlf.ts": 'import {\r\n  a,\r\n} from "./ab";\r\n',
      "main.go": 'package main\n\nimport (\n  "fmt"\n)\n',
      "node_modules/m/i.ts": 'import "./no";',
      ".hidden/i.ts": 'import "./no";',
      "notes.md": 'import "./no";',
      "src/vendor.min.js": 'import "./no";',
      "src/long.ts": `import "./ok";\nconst s = "${"x".repeat(10_000)}"; import "./cut";\n`,
      "tsconfig.json": '{ "files": [] }',
      "go.mod": "module example.com/app\n",
    });
    const parsed = parseSshImportOutput(execFileSync("sh", ["-c", sshImportCommand(root)], { encoding: "utf8" }));
    parsed.read.sort((x, y) => (x.path < y.path ? -1 : 1));
    expect(parsed).toEqual({
      read: [
        { path: "main.go", imports: [{ spec: "fmt", line: 4 }] },
        { path: "src/a.tsx", imports: [{ spec: "./ab", line: 2 }, { spec: "./r", line: 5 }] },
        { path: "src/crlf.ts", imports: [{ spec: "./ab", line: 1 }] },
        { path: "src/long.ts", imports: [{ spec: "./ok", line: 1 }] },
      ],
      tsconfig: '{ "files": [] }',
      goMod: "module example.com/app\n",
    });
  });
});

describe("GitHub import reading", () => {
  afterEach(() => setGithubTransport(null));
  const repo = { name: "r", fullName: "o/r", defaultBranch: "main", pushedAt: "2026-01-01T00:00:00Z" };
  const top = "o-r-0123abc";

  function serve(archive: () => Uint8Array) {
    const calls: string[] = [];
    setGithubTransport({
      credential: async () => null,
      fetch: (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        if (url.pathname === `/repos/o/r/tarball/main`) return new Response(new Uint8Array(archive()), { status: 200, headers: { "content-type": "application/x-gzip" } });
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }) as typeof globalThis.fetch,
    });
    return calls;
  }

  it("strips the GitHub top folder <owner>-<repo>-<sha>/", async () => {
    serve(() => gzipSync(tar([
      { name: `${top}/`, type: "5" },
      { name: `${top}/src/a.ts`, data: 'import b from "./b";' },
      { name: `${top}/tsconfig.json`, data: '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }' },
      { name: `${top}/go.mod`, data: "module example.com/app\n" },
      { name: `${top}/README.md`, data: 'import "./no"' },
      { name: `${top}/src/big.ts`, data: "x".repeat(MAX_FILE_BYTES + 1) },
    ])));
    expect(await readGithubImports(repo)).toEqual({
      read: [{ path: "src/a.ts", imports: [{ spec: "./b", line: 1 }] }],
      tsconfig: '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      goMod: "module example.com/app\n",
    });
  });

  it("skips archive entries that would land outside the project", async () => {
    const set = await unpackGithubTarball("o/r", gzipSync(tar([
      { name: `${top}/a.ts`, data: "" },
      { name: `${top}/../evil.ts`, data: "" },
      { name: `${top}/src/../../evil2.ts`, data: "" },
      { name: "/abs.ts", data: "" },
      { name: `${top}//abs2.ts`, data: "" },
      { name: `${top}/src/./ok.ts`, data: "" },
    ])));
    expect(set.read.map((f) => f.path)).toEqual(["a.ts", "src/ok.ts"]);
  });

  it("downloads the tarball once per push", async () => {
    const calls = serve(() => gzipSync(tar([{ name: `${top}/a.ts`, data: "" }])));
    await readGithubImports(repo);
    await readGithubImports(repo);
    expect(calls).toHaveLength(1);
    await readGithubImports({ ...repo, pushedAt: "2026-02-01T00:00:00Z" });
    expect(calls).toHaveLength(2);
  });

  it("a tarball GitHub refuses is an error with its message", async () => {
    setGithubTransport({
      credential: async () => null,
      fetch: (async () => new Response(JSON.stringify({ message: "Git Repository is empty." }), { status: 404 })) as typeof globalThis.fetch,
    });
    await expect(readGithubImports(repo)).rejects.toThrow("GitHub: not found");
  });

  it("an archive larger than the cap once unpacked is a clear error", async () => {
    const gz = gzipSync(new Uint8Array(2048));
    await expect(unpackGithubTarball("o/r", gz, 1024)).rejects.toThrow("GitHub archive of o/r is larger than 1 KB unpacked");
    expect((await unpackGithubTarball("o/r", gzipSync(tar([{ name: `${top}/a.ts`, data: "" }])), 4096)).read).toEqual([{ path: "a.ts", imports: [] }]);
  });

  it("refuses a download announced as larger than the cap", async () => {
    const calls: string[] = [];
    setGithubTransport({
      credential: async () => null,
      fetch: (async () => { calls.push("x"); return new Response(new Uint8Array(10), { headers: { "content-length": String(101 * 1024 * 1024) } }); }) as typeof globalThis.fetch,
    });
    await expect(readGithubImports(repo)).rejects.toThrow("GitHub archive of o/r is larger than 100 MB to download");
  });

  it("stops reading a download that grows past the cap", async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    setGithubTransport({
      credential: async () => null,
      fetch: (async () => new Response(new ReadableStream({
        pull(controller) { sent += 1; controller.enqueue(chunk); },
      }))) as typeof globalThis.fetch,
    });
    await expect(readGithubImports(repo)).rejects.toThrow("GitHub archive of o/r is larger than 100 MB to download");
    expect(sent).toBeLessThan(110);
  });

  it("a download that is not gzip is a clear error", async () => {
    serve(() => new TextEncoder().encode("<html>nope</html>"));
    await expect(readGithubImports(repo)).rejects.toThrow("GitHub archive of o/r could not be read");
  });
});
