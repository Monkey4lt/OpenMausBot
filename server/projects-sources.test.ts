import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CODE_EXTENSIONS } from "./projects-architecture.ts";
import { isCodeFile, MAX_FILE_BYTES, readLocalImports, toPosix } from "./projects-sources.ts";

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
    expect(MAX_FILE_BYTES).toBe(256 * 1024);
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
