import { describe, expect, it } from "vitest";

import { classify, FAMILY_ORDER, modulesOf, parseImports } from "./projects-architecture.ts";

describe("classify", () => {
  it.each([
    ["src/components/Button.test.tsx", "tests"], ["tests/e2e/login.py", "tests"], ["pkg/db/store_test.go", "tests"],
    ["README.md", "docs"], ["docs/setup.md", "docs"],
    ["src/locales/fr.json", "i18n"], ["po/fr.po", "i18n"],
    ["migrations/001_init.sql", "data"], ["prisma/schema.prisma", "data"], ["app/models/user.rb", "data"],
    ["package.json", "config"], ["vite.config.ts", "config"], [".github/workflows/ci.yml", "config"], ["Dockerfile", "config"],
    ["scripts/deploy.sh", "scripts"], ["Makefile", "scripts"],
    ["public/logo.png", "assets"], ["src/assets/font.woff2", "assets"],
    ["src/components/Button.tsx", "ui"], ["src/styles.css", "ui"], ["web/index.html", "ui"],
    ["server/routes/users.ts", "server"], ["bot/handlers/start.py", "server"], ["cmd/main.go", "server"],
    ["LICENSE", "docs"], ["notes.txt", "other"],
  ])("%s → %s", (path, family) => expect(classify(path)).toBe(family));

  it.each([
    ["app/test_users.py", "tests"], ["src/__tests__/a.ts", "tests"], ["spec/user_spec.rb", "tests"], ["src/a.spec.ts", "tests"],
    ["CHANGELOG", "docs"], ["guide.mdx", "docs"], ["src/components/README.md", "docs"],
    ["src/i18n/en.ts", "i18n"], ["db/seed.ts", "data"],
    ["tsconfig.node.json", "config"], ["docker-compose.yml", "config"], ["compose.yaml", "config"], ["pyproject.toml", "config"], [".env.example", "config"],
    ["bin/run", "scripts"], ["build.ps1", "scripts"],
    ["static/x.svg", "assets"], ["logo.jpg", "assets"],
    ["Src/Components/x.ts", "ui"], ["src/App.vue", "ui"],
    ["src/state/store.ts", "server"], ["index.js", "server"], ["lib/x.rs", "server"],
  ])("%s → %s (more rules)", (path, family) => expect(classify(path)).toBe(family));

  it("lists the families in priority order", () => {
    expect(FAMILY_ORDER).toEqual(["tests", "docs", "i18n", "data", "config", "scripts", "assets", "ui", "server", "other"]);
  });
});

describe("modulesOf", () => {
  const paths = ["src/components/A.tsx", "src/components/B.tsx", "src/components/c/C.tsx", "src/state/s.ts", "src/state/t.ts", "src/state/u.ts", "README.md"];

  it("groups files of a family under the shortest prefix that holds at least 3 of them", () => {
    const m = modulesOf(["src/components/A.tsx", "src/components/B.tsx", "src/components/c/C.tsx", "src/state/s.ts"]);
    expect(m.find((x) => x.id === "src/components")?.files).toHaveLength(3);
    expect(m.find((x) => x.id === "src/components")).toEqual({ id: "src/components", family: "ui", files: ["src/components/A.tsx", "src/components/B.tsx", "src/components/c/C.tsx"] });
    expect(m.find((x) => x.id === "(root)/server")?.files).toEqual(["src/state/s.ts"]);
  });

  it("never makes a module deeper than 3 segments", () => {
    const m = modulesOf(["a/b/c/d/e/x1.ts", "a/b/c/d/e/x2.ts", "a/b/c/d/e/x3.ts"]);
    expect(m).toEqual([{ id: "a/b/c", family: "server", files: ["a/b/c/d/e/x1.ts", "a/b/c/d/e/x2.ts", "a/b/c/d/e/x3.ts"] }]);
  });

  it("files that fit no module go to (root)/<family>", () => {
    const m = modulesOf(paths);
    expect(m.find((x) => x.id === "(root)/docs")).toEqual({ id: "(root)/docs", family: "docs", files: ["README.md"] });
    expect(m.map((x) => x.id)).toEqual(["(root)/docs", "src/components", "src/state"]);
  });

  it("every file lands in exactly one module", () => {
    const m = modulesOf([...paths, "src/components/x/1.tsx", "src/components/x/2.tsx", "src/components/x/3.tsx"]);
    expect(m.flatMap((x) => x.files).sort()).toEqual([...paths, "src/components/x/1.tsx", "src/components/x/2.tsx", "src/components/x/3.tsx"].sort());
    expect(m.find((x) => x.id === "src/components/x")?.files).toHaveLength(3);
  });

  it("a folder shared by two families gives the smaller one its own id", () => {
    const m = modulesOf(["src/ui/A.tsx", "src/ui/B.tsx", "src/ui/C.tsx", "src/ui/D.tsx", "src/ui/A.test.tsx", "src/ui/B.test.tsx", "src/ui/C.test.tsx"]);
    expect(m.map((x) => [x.id, x.family, x.files.length])).toEqual([["src/ui#tests", "tests", 3], ["src/ui", "ui", 4]]);
  });

  it("an override moves a whole module to another family", () => {
    expect(modulesOf(paths, { moduleFamily: { "src/state": "data" }, familyNames: {} }).find((m) => m.id === "src/state")?.family).toBe("data");
    expect(modulesOf(paths).find((m) => m.id === "src/state")?.family).toBe("server");
  });
});

describe("parseImports", () => {
  it.each([
    ["a.ts", 'import { x } from "./b";', ["./b"]],
    ["a.ts", "import type { T } from '../t';", ["../t"]],
    ["a.ts", 'export * from "./c";', ["./c"]],
    ["a.ts", 'const m = await import("./lazy");', ["./lazy"]],
    ["a.js", 'const fs = require("fs");', ["fs"]],
    ["a.ts", '// import x from "./no"\n/* import y from "./no2" */', []],
    ["a.py", "import os\nfrom .models import User\nfrom app.db import x", ["os", ".models", "app.db"]],
    ["main.go", 'import (\n  "fmt"\n  "example.com/app/db"\n)', ["fmt", "example.com/app/db"]],
    ["lib.rs", "mod db;\nuse crate::api::routes;", ["self::db", "crate::api::routes"]],
    ["s.css", '@import "./theme.css";', ["./theme.css"]],
  ])("%s", (path, text, specs) => expect(parseImports(path, text).map((r) => r.spec)).toEqual(specs));

  it.each([
    ["multi-line named import", "a.tsx", 'import {\n  a,\n  b,\n} from "./ab";\nimport "./side.css";', ["./ab", "./side.css"]],
    ["export with names and a default import", "a.ts", 'export { a as b } from "./a";\nimport React, { useState } from "react";', ["./a", "react"]],
    ["a URL inside a string is not a comment", "a.ts", 'const u = "http://x"; import y from "./y";', ["./y"]],
    ["words that only look like imports", "a.ts", 'const s = "import x from y"; myimport("./no"); x.require("./no");', []],
    ["Vue single-file component", "A.vue", '<script setup>\nimport B from "./B.vue";\n</script>', ["./B.vue"]],
    ["Python lists, aliases, relative parents and comments", "a.py", "import os, sys as system  # import nope\nfrom .. import x\nfrom ..pkg.mod import (a, b)\n# import gone", ["os", "sys", "..", "..pkg.mod"]],
    ["Python docstring", "a.py", '"""\nimport nope\n"""\nimport real', ["real"]],
    ["Go single import with alias", "a.go", 'package main\n\nimport f "fmt"\nimport (\n  db "example.com/app/db" // the store\n  _ "embed"\n)', ["fmt", "example.com/app/db", "embed"]],
    ["Rust pub mod, grouped use and external crates", "lib.rs", "pub mod api;\nmod inline { }\nuse crate::api::{routes, auth};\nuse serde::Serialize;\n// use crate::gone;", ["self::api", "crate::api", "serde::Serialize"]],
    ["SCSS use and css url()", "a.scss", '@use "./vars";\n@import url("./reset.css");\n// @import "./gone";', ["./vars", "./reset.css"]],
  ])("%s", (_name, path, text, specs) => expect(parseImports(path, text).map((r) => r.spec)).toEqual(specs));

  it("gives the 1-based line of each import", () => {
    expect(parseImports("a.py", "import os\n\nfrom x import y\n")).toEqual([{ spec: "os", line: 1 }, { spec: "x", line: 3 }]);
    expect(parseImports("main.go", 'import (\n  "fmt"\n  "os"\n)')).toEqual([{ spec: "fmt", line: 2 }, { spec: "os", line: 3 }]);
  });

  it("CRLF and a BOM give the same result as LF", () => {
    expect(parseImports("a.ts", '\uFEFFimport a from "./a";\r\nimport b from "./b";\r\n')).toEqual([{ spec: "./a", line: 1 }, { spec: "./b", line: 2 }]);
    expect(parseImports("a.py", "\uFEFFimport a\r\nimport b\r\n")).toEqual([{ spec: "a", line: 1 }, { spec: "b", line: 2 }]);
  });

  it("a file in a language it does not read gives nothing", () => {
    expect(parseImports("notes.txt", 'import x from "./y"')).toEqual([]);
  });
});
