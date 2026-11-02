import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { aliasesFromGoMod, aliasesFromTsconfig, buildArchitecture, classify, CODE_EXTENSIONS, FAMILY_ORDER, modulesOf, parseImports, resolveImport } from "./projects-architecture.ts";
import type { FileImports } from "./projects-architecture.ts";

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
    expect(m.map((x) => [x.id, x.family, x.files.length])).toEqual([["src/ui", "tests", 3], ["src/ui#ui", "ui", 4]]);
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
    ["a.py", "import os\nfrom .models import User\nfrom app.db import x", ["os", ".models.User", "app.db.x"]],
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
    ["Python lists, aliases, relative parents and comments", "a.py", "import os, sys as system  # import nope\nfrom .. import x\nfrom ..pkg.mod import (a, b)\n# import gone", ["os", "sys", "..x", "..pkg.mod.a", "..pkg.mod.b"]],
    ["Python docstring", "a.py", '"""\nimport nope\n"""\nimport real', ["real"]],
    ["Go single import with alias", "a.go", 'package main\n\nimport f "fmt"\nimport (\n  db "example.com/app/db" // the store\n  _ "embed"\n)', ["fmt", "example.com/app/db", "embed"]],
    ["Rust pub mod, grouped use and external crates", "lib.rs", "pub mod api;\nmod inline { }\nuse crate::api::{routes, auth};\nuse serde::Serialize;\n// use crate::gone;", ["self::api", "crate::api::routes", "crate::api::auth", "serde::Serialize"]],
    ["SCSS use and css url()", "a.scss", '@use "./vars";\n@import url("./reset.css");\n// @import "./gone";', ["./vars", "./reset.css"]],
  ])("%s", (_name, path, text, specs) => expect(parseImports(path, text).map((r) => r.spec)).toEqual(specs));

  it("gives the 1-based line of each import", () => {
    expect(parseImports("a.py", "import os\n\nfrom x import y\n")).toEqual([{ spec: "os", line: 1 }, { spec: "x.y", line: 3 }]);
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

describe("resolveImport", () => {
  const files = new Set(["src/a.ts", "src/b.tsx", "src/lib/index.ts", "src/theme.css", "app/models.py", "app/db/__init__.py", "src/api/routes.rs", "src/db/mod.rs", "db/store.go"]);
  const aliases = { "@/": "src/", "example.com/app/": "" };

  it.each([
    ["src/a.ts", "./b", "src/b.tsx"], ["src/a.ts", "./lib", "src/lib/index.ts"], ["src/a.ts", "./theme.css", "src/theme.css"],
    ["src/a.ts", "@/lib", "src/lib/index.ts"], ["src/a.ts", "react", null],
    ["app/x.py", ".models", "app/models.py"], ["app/x.py", "app.db", "app/db/__init__.py"], ["app/x.py", "os", null],
    ["src/main.rs", "crate::api::routes", "src/api/routes.rs"], ["src/main.rs", "self::db", "src/db/mod.rs"],
    ["cmd/main.go", "example.com/app/db", "db/store.go"], ["cmd/main.go", "fmt", null],
  ])("%s imports %s", (from, spec, to) => expect(resolveImport(from, spec, files, aliases)).toBe(to));

  const more = new Set([
    "src/lib/util.ts", "src/lib/deep/x.ts", "src/a.ts", "app/pkg/__init__.py", "app/pkg/sub.py", "app/top.py",
    "src/api.rs", "src/api/auth.rs", "web/main.scss", "web/_vars.scss", "pkg/db/store_test.go", "pkg/db/store.go", "pkg/db/a_test.go",
  ]);
  it.each([
    ["an ESM .js specifier finds the .ts file", "src/lib/deep/x.ts", "../util.js", "src/lib/util.ts"],
    ["a parent folder import", "src/lib/deep/x.ts", "../../a", "src/a.ts"],
    ["an import that leaves the project is external", "src/a.ts", "../../outside", null],
    ["a missing relative file is external", "src/a.ts", "./missing", null],
    ["Python .. reaches the parent package", "app/pkg/sub.py", "..top", "app/top.py"],
    ["Python . alone is the package itself", "app/pkg/sub.py", ".", "app/pkg/__init__.py"],
    ["Rust use of an item inside a module file", "src/main.rs", "crate::api::Router", "src/api.rs"],
    ["Rust mod from a non-root file looks in its own folder", "src/api.rs", "self::auth", "src/api/auth.rs"],
    ["Rust external crate", "src/main.rs", "serde::Serialize", null],
    ["Go prefers a non-test file of the package", "cmd/main.go", "example.com/app/pkg/db", "pkg/db/store.go"],
    ["SCSS partial with underscore", "web/main.scss", "./vars", "web/_vars.scss"],
  ])("%s", (_name, from, spec, to) => expect(resolveImport(from, spec, more, aliases)).toBe(to));

  it("reads paths aliases from a tsconfig with comments", () => {
    expect(aliasesFromTsconfig('{ // c\n "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }')).toEqual({ "@/": "src/" });
  });

  it("reads baseUrl, block comments and trailing commas, and survives a broken file", () => {
    expect(aliasesFromTsconfig('{ /* c */ "compilerOptions": { "baseUrl": "./app", "paths": { "~/*": ["lib/*",], "#cfg": ["./config.ts"], }, }, }')).toEqual({ "~/": "app/lib/", "#cfg": "app/config.ts" });
    expect(aliasesFromTsconfig('{ "compilerOptions": { "paths": { "//x/*": ["lib/*"] } } }')).toEqual({ "//x/": "lib/" });
    expect(aliasesFromTsconfig("{ nope")).toEqual({});
    expect(aliasesFromTsconfig("{}")).toEqual({});
  });

  it("reads the module path of a go.mod", () => {
    expect(aliasesFromGoMod("// x\nmodule example.com/app\n\ngo 1.22\n")).toEqual({ "example.com/app/": "" });
    expect(aliasesFromGoMod("go 1.22")).toEqual({});
  });
});

describe("buildArchitecture", () => {
  const imp = (path: string, ...specs: string[]): FileImports => ({ path, imports: specs.map((spec, i) => ({ spec, line: i + 1 })) });
  const paths = [
    "src/components/A.tsx", "src/components/B.tsx", "src/components/C.tsx",
    "server/routes/users.ts", "server/routes/auth.ts", "server/routes/db.ts",
    "README.md",
  ];

  it("aggregates file imports into weighted module and family edges", () => {
    const arch = buildArchitecture(paths, [
      imp("src/components/A.tsx", "../../server/routes/users", "./B"),
      imp("src/components/C.tsx", "../../server/routes/auth"),
    ], {});
    expect(arch.edges).toEqual([
      { level: "family", from: "ui", to: "server", weight: 2 },
      { level: "module", from: "src/components", to: "server/routes", weight: 2 },
    ]);
    expect(arch.truncated).toBe(false);
    expect(arch.families).toEqual([
      { id: "docs", name: "docs", files: 1, modules: ["(root)/docs"] },
      { id: "ui", name: "ui", files: 3, modules: ["src/components"] },
      { id: "server", name: "server", files: 3, modules: ["server/routes"] },
    ]);
    expect(arch.modules).toEqual([
      { id: "(root)/docs", family: "docs", files: 1 },
      { id: "src/components", family: "ui", files: 3 },
      { id: "server/routes", family: "server", files: 3 },
    ]);
    expect(arch.files.find((f) => f.path === "src/components/A.tsx")).toEqual({
      path: "src/components/A.tsx", module: "src/components", uses: ["server/routes/users.ts", "src/components/B.tsx"], usedBy: [],
    });
    expect(arch.files.find((f) => f.path === "server/routes/users.ts")?.usedBy).toEqual(["src/components/A.tsx"]);
    expect(arch.files.find((f) => f.path === "README.md")).toEqual({ path: "README.md", module: "(root)/docs", uses: [], usedBy: [] });
  });

  it("ignores an import of the same module at module level and of the same family at family level", () => {
    const more = [...paths, "src/views/X.tsx", "src/views/Y.tsx", "src/views/Z.tsx"];
    const arch = buildArchitecture(more, [imp("src/components/A.tsx", "./B", "../views/X"), imp("server/routes/db.ts", "./users")], {});
    expect(arch.edges).toEqual([{ level: "module", from: "src/components", to: "src/views", weight: 1 }]);
  });

  it("circular imports give one edge each way and no duplicate", () => {
    const arch = buildArchitecture(paths, [
      imp("src/components/A.tsx", "../../server/routes/users", "../../server/routes/users"),
      imp("server/routes/users.ts", "../../src/components/A"),
      imp("server/routes/auth.ts", "../../src/components/B"),
    ], {});
    expect(arch.edges).toEqual([
      { level: "family", from: "server", to: "ui", weight: 2 },
      { level: "family", from: "ui", to: "server", weight: 2 },
      { level: "module", from: "server/routes", to: "src/components", weight: 2 },
      { level: "module", from: "src/components", to: "server/routes", weight: 2 },
    ]);
    expect(arch.files.find((f) => f.path === "src/components/A.tsx")).toMatchObject({ uses: ["server/routes/users.ts"], usedBy: ["server/routes/users.ts"] });
  });

  it("a file importing itself adds nothing", () => {
    const arch = buildArchitecture(paths, [imp("src/components/A.tsx", "./A")], {});
    expect(arch.edges).toEqual([]);
    expect(arch.files.find((f) => f.path === "src/components/A.tsx")).toMatchObject({ uses: [], usedBy: [] });
  });

  it("a project with only docs has families and no edges", () => {
    const arch = buildArchitecture(["README.md", "docs/a.md"], [], {});
    expect(arch.edges).toEqual([]);
    expect(arch.families).toEqual([{ id: "docs", name: "docs", files: 2, modules: ["(root)/docs"] }]);
    expect(arch.external).toEqual([]);
    expect(arch.truncated).toBe(false);
  });

  it("an empty project gives an empty map", () => {
    expect(buildArchitecture([], [], {})).toEqual({ families: [], modules: [], files: [], edges: [], external: [], truncated: false });
  });

  it("external packages are counted by package name", () => {
    const arch = buildArchitecture(paths, [
      imp("src/components/A.tsx", "react", "react-dom/client", "@tanstack/react-query/devtools", "./missing"),
      imp("src/components/B.tsx", "react", "node:fs"),
      imp("server/routes/db.ts", "zod"),
    ], {});
    expect(arch.external).toEqual([
      { name: "react", count: 2 },
      { name: "@tanstack/react-query", count: 1 },
      { name: "node:fs", count: 1 },
      { name: "react-dom", count: 1 },
      { name: "zod", count: 1 },
    ]);
  });

  it("names external packages per language", () => {
    const arch = buildArchitecture(["a.py", "main.go", "src/main.rs"], [
      imp("a.py", "os.path", "requests", ".local"),
      imp("main.go", "fmt", "github.com/spf13/cobra/doc"),
      imp("src/main.rs", "serde::Serialize", "crate::nope"),
    ], {});
    expect(arch.external.map((e) => e.name).sort()).toEqual(["fmt", "github.com/spf13/cobra", "os", "requests", "serde"]);
  });

  it("an alias that matches but finds no file is not an external package", () => {
    const arch = buildArchitecture(paths, [imp("src/components/A.tsx", "@/gone", "@/components/B")], { "@/": "src/" });
    expect(arch.external).toEqual([]);
    expect(arch.files.find((f) => f.path === "src/components/A.tsx")?.uses).toEqual(["src/components/B.tsx"]);
  });

  it("more files than the limit sets truncated", () => {
    const paths4 = ["a/1.ts", "a/2.ts", "a/3.ts", "a/4.ts"];
    const read4 = [imp("a/1.ts", "./2"), imp("a/2.ts", "./3"), imp("a/3.ts", "./4"), imp("a/4.ts", "./1")];
    const arch = buildArchitecture(paths4, read4, {}, undefined, 3);
    expect(arch.truncated).toBe(true);
    expect(arch.files.find((f) => f.path === "a/4.ts")).toMatchObject({ uses: [], usedBy: ["a/3.ts"] });
    expect(buildArchitecture(paths4, read4, {}, undefined, 4).truncated).toBe(false);
  });

  it("family names use the overrides", () => {
    const overrides = { moduleFamily: { "server/routes": "data" as const }, familyNames: { ui: "Front", data: "Back" } };
    const arch = buildArchitecture(paths, [imp("src/components/A.tsx", "../../server/routes/users")], {}, overrides);
    expect(arch.families).toEqual([
      { id: "docs", name: "docs", files: 1, modules: ["(root)/docs"] },
      { id: "data", name: "Back", files: 3, modules: ["server/routes"] },
      { id: "ui", name: "Front", files: 3, modules: ["src/components"] },
    ]);
    expect(arch.edges.filter((e) => e.level === "family")).toEqual([{ level: "family", from: "ui", to: "data", weight: 1 }]);
  });
});

describe("parseImports on hostile input", () => {
  it.each([
    ["a.ts", "export /*" + "x".repeat(50_000) + "*/ a"],
    ["a.ts", "import" + "\n".repeat(50_000)],
    ["a.ts", "import" + " ".repeat(50_000)],
    ["a.ts", "import " + "a, ".repeat(20_000)],
    ["a.ts", "import type" + " ".repeat(50_000) + "x"],
    ["a.ts", "import(".repeat(10_000)],
    ["a.ts", "'x' ".repeat(20_000) + 'import a from "./a"'],
    ["a.py", "from " + ".".repeat(50_000)],
    ["a.py", "import" + " ".repeat(50_000) + "#"],
    ["a.py", "from x import " + "a, ".repeat(20_000)],
    ["main.go", "import(".repeat(10_000)],
    ["main.go", "import " + "a".repeat(50_000)],
    ["lib.rs", "pub(" + "x".repeat(50_000)],
    ["lib.rs", "use " + ":".repeat(50_000) + "!"],
    ["lib.rs", "use crate::{" + "a, ".repeat(20_000)],
    ["s.css", "@import" + " ".repeat(50_000)],
    ["s.css", "@import url(" + " ".repeat(50_000)],
    ["dense.ts", 'import a from "./a";\n'.repeat(5_000)],
  ])("%s stays fast", (path, text) => {
    const start = performance.now();
    parseImports(path, text);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("a long but legal import list is still read", () => {
    expect(parseImports("a.ts", `import {${" a,".repeat(300)} } from "./many";`).map((r) => r.spec)).toEqual(["./many"]);
  });
});

describe("Rust use groups and super", () => {
  it.each([
    ["use crate::{api, db};", ["crate::api", "crate::db"]],
    ["use crate::api::{routes, auth::{login, Session}};", ["crate::api::routes", "crate::api::auth::login", "crate::api::auth::Session"]],
    ["use super::*;", ["super"]],
    ["use self::{a::*, b};", ["self::a", "self::b"]],
    ["use crate::{self as me, x};", ["crate", "crate::x"]],
    ["pub(crate) use super::model::User;", ["super::model::User"]],
  ])("%s", (text, specs) => expect(parseImports("src/lib.rs", text).map((r) => r.spec)).toEqual(specs));

  it("super, self and crate imports are never external", () => {
    const arch = buildArchitecture(["src/lib.rs", "src/a/b.rs"], [
      { path: "src/a/b.rs", imports: [{ spec: "super", line: 1 }, { spec: "crate::gone", line: 2 }, { spec: "self::x", line: 3 }, { spec: "crate", line: 4 }] },
    ], {});
    expect(arch.external).toEqual([]);
  });

  it("use super::* resolves to the parent module file", () => {
    const files = new Set(["src/lib.rs", "src/net.rs", "src/net/tcp.rs"]);
    expect(resolveImport("src/net/tcp.rs", "super", files, {})).toBe("src/net.rs");
  });
});

describe("Python imported names", () => {
  it.each([
    ["import os; import sys", ["os", "sys"]],
    ["import a, b", ["a", "b"]],
    ["x = 1; import json  # import nope", ["json"]],
    ["from . import views, models as m", [".views", ".models"]],
    ["from .. import (\n  a,\n  b,\n)", ["..a", "..b"]],
    ["from .pkg import mod", [".pkg.mod"]],
    ["from app.db import Session", ["app.db.Session"]],
    ["from x import *", ["x"]],
  ])("%s", (text, specs) => expect(parseImports("app/x.py", text).map((r) => r.spec)).toEqual(specs));

  const files = new Set(["app/__init__.py", "app/views.py", "app/models/__init__.py", "app/pkg/__init__.py", "app/pkg/mod.py", "app/db.py"]);
  it.each([
    ["from . import views gives the views module", ".views", "app/views.py"],
    ["a sub-package", ".models", "app/models/__init__.py"],
    ["a name inside a package falls back to the package", ".pkg.helper", "app/pkg/__init__.py"],
    ["a module of a package", ".pkg.mod", "app/pkg/mod.py"],
    ["a class from a module falls back to the module", "app.db.Session", "app/db.py"],
    ["a missing module stays external", "requests.get", null],
  ])("%s", (_name, spec, to) => expect(resolveImport("app/x.py", spec, files, {})).toBe(to));
});

describe("Python names in the architecture", () => {
  it("from .pkg import mod links to the module, and two names of one line count once", () => {
    const paths = ["app/x.py", "app/pkg/__init__.py", "app/pkg/mod.py", "app/db.py"];
    const read = [{ path: "app/x.py", imports: parseImports("app/x.py", "from .pkg import mod\nfrom .db import A, B\nfrom os.path import join") }];
    const arch = buildArchitecture(paths, read, {});
    expect(arch.files.find((f) => f.path === "app/x.py")?.uses).toEqual(["app/db.py", "app/pkg/mod.py"]);
    expect(arch.files.find((f) => f.path === "app/db.py")?.usedBy).toEqual(["app/x.py"]);
    expect(arch.external).toEqual([{ name: "os", count: 1 }]);
  });
});

describe("regex literals and markup comments", () => {
  it.each([
    ["a.ts", `const r = /[']/g; import z from "./z";`, ["./z"]],
    ["a.ts", "const r = /`/;\nimport a from \"./a\";\nimport b from \"./b\";", ["./a", "./b"]],
    ["a.ts", "if (/\"/.test(x)) {}\nimport a from \"./a\";", ["./a"]],
    ["a.ts", "const r = /[/'\"]/; const s = /\\/'/;\nimport a from \"./a\";", ["./a"]],
    ["a.ts", "x = [/'/, /\"/];\nimport a from \"./a\";", ["./a"]],
    ["a.ts", "const half = a / 2; const q = b / 'x'.length;\nimport a from \"./a\";", ["./a"]],
    ["a.ts", "return /'/.test(s) && require(\"./r\");", ["./r"]],
    ["A.vue", '<!-- import x from "./no" -->\n<script>\nimport B from "./B.vue";\n</script>', ["./B.vue"]],
    ["A.svelte", '<!--\n<script>import x from "./no";</script>\n-->\n<script>import C from "./C.svelte";</script>', ["./C.svelte"]],
  ])("%s %s", (path, text, specs) => expect(parseImports(path, text).map((r) => r.spec)).toEqual(specs));

  it("lines stay right after a regex and a markup comment", () => {
    expect(parseImports("A.vue", "<!-- a\nb -->\nconst r = /'/;\nimport x from \"./x\";")).toEqual([{ spec: "./x", line: 4 }]);
  });
});

describe("classify edge cases", () => {
  it.each([
    ["src/components/LicenseExpiryBanner.tsx", "ui"], ["server/license.ts", "server"], ["src/readme-parser.ts", "server"],
    ["LICENSE.txt", "docs"], ["README.rst", "docs"], ["CHANGELOG.md", "docs"], ["LICENSE", "docs"],
    ["app/main.py", "server"], ["app/controllers/users_controller.rb", "server"], ["app/Main.java", "server"],
    ["app/page.tsx", "ui"], ["app/layout.ts", "ui"], ["app/globals.css", "ui"],
  ])("%s → %s", (path, family) => expect(classify(path)).toBe(family));
});

describe("source text", () => {
  it("has no invisible characters", () => {
    const source = readFileSync(new URL("./projects-architecture.ts", import.meta.url), "utf8");
    expect(source.match(/[\u00A0\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g)).toBeNull();
  });
});

describe("module ids", () => {
  const shared = (ui: number, tests: number) => [
    ...Array.from({ length: ui }, (_, i) => `src/ui/C${i}.tsx`),
    ...Array.from({ length: tests }, (_, i) => `src/ui/C${i}.test.tsx`),
  ];
  const ids = (paths: string[]) => Object.fromEntries(modulesOf(paths).map((m) => [m.family, m.id]));

  it("changing file counts never swaps the ids of two families sharing a folder", () => {
    for (const [ui, tests] of [[3, 3], [10, 3], [3, 10], [4, 7]]) {
      expect(ids(shared(ui, tests))).toEqual({ tests: "src/ui", ui: "src/ui#ui" });
    }
  });

  it("leftover files next to a carved sub-module land in (root)/<family>", () => {
    const m = modulesOf(["src/lib/a.ts", "src/lib/deep/x.ts", "src/lib/deep/y.ts", "src/lib/deep/z.ts"]);
    expect(m).toEqual([
      { id: "(root)/server", family: "server", files: ["src/lib/a.ts"] },
      { id: "src/lib/deep", family: "server", files: ["src/lib/deep/x.ts", "src/lib/deep/y.ts", "src/lib/deep/z.ts"] },
    ]);
  });

  it("an override never reads inherited object keys", () => {
    const paths = ["constructor/a.ts", "constructor/b.ts", "constructor/c.ts", "toString/a.ts", "toString/b.ts", "toString/c.ts"];
    const m = modulesOf(paths, { moduleFamily: {}, familyNames: {} });
    expect(m.map((x) => [x.id, x.family])).toEqual([["constructor", "server"], ["toString", "server"]]);
    const arch = buildArchitecture(paths, [], {}, { moduleFamily: {}, familyNames: {} });
    expect(arch.families).toEqual([{ id: "server", name: "server", files: 6, modules: ["constructor", "toString"] }]);
  });
});

describe("code extensions", () => {
  it("lists every extension parseImports reads, including the plan's set", () => {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".py", ".go", ".rs", ".css", ".scss"]) expect(CODE_EXTENSIONS).toContain(ext);
    for (const ext of CODE_EXTENSIONS) expect(parseImports(`a${ext}`, 'import "./x";\n@import "./x";\nimport x\nuse crate::x;').length).toBeGreaterThan(0);
    expect(CODE_EXTENSIONS).not.toContain(".md");
  });

  it("truncated is false when every code file was read, even past the limit of non-code files", () => {
    const paths = ["a.ts", "b.ts", "README.md", "docs/x.md", "logo.png"];
    expect(buildArchitecture(paths, [{ path: "a.ts", imports: [] }, { path: "b.ts", imports: [] }], {}, undefined, 2).truncated).toBe(false);
    expect(buildArchitecture(paths, [{ path: "a.ts", imports: [] }], {}, undefined, 1).truncated).toBe(true);
  });
});
