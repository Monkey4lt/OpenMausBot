import { describe, expect, it } from "vitest";

import { classify, FAMILY_ORDER, modulesOf } from "./projects-architecture.ts";

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
