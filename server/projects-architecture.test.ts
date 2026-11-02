import { describe, expect, it } from "vitest";

import { classify, FAMILY_ORDER } from "./projects-architecture.ts";

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
