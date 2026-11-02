import { describe, expect, it } from "vitest";

import { buildArchitecture, parseImports } from "./projects-architecture.ts";
import { detectPieces, findCalls, findRoutes, isManifestPath, languagesOf, linkPieces, pieceDiagramHtml, routeMatches } from "./projects-inspect.ts";
import { EVIDENCE_CODES, type Piece } from "../shared/projects-pieces.ts";

function project(files: Record<string, string>) {
  const paths = Object.keys(files);
  const read = paths.map((path) => ({ path, imports: parseImports(path, files[path]) })).filter((f) => f.imports.length);
  const manifests = Object.fromEntries(paths.filter(isManifestPath).map((p) => [p, files[p]]));
  return { paths, manifests, read, arch: buildArchitecture(paths, read, {}) };
}

const pieces = (files: Record<string, string>) => detectPieces(project(files));
const find = (list: Piece[], kind: Piece["kind"], tech: string) => list.find((p) => p.kind === kind && p.tech === tech);
const kinds = (list: Piece[]) => list.map((p) => `${p.kind}:${p.tech}`);

const emptyInput = project({});

describe("detectPieces", () => {
  it("names a server from its folder when no known framework was found, and only then", () => {
    const loose = pieces({ "server/a.js": "x", "server/b.js": "x", "server/c.js": "x", "server/notes.json": "{}" });
    expect(kinds(loose)).toEqual(["api:"]);
    expect(loose[0]!.evidence.map((e) => e.code)).toEqual(["folder", "folder", "folder"]);
    expect(loose[0]!.evidence.map((e) => e.path)).toEqual(["server/a.js", "server/b.js", "server/c.js"]);
    expect(loose[0]!.modules.length).toBeGreaterThan(0);
    expect(kinds(pieces({ "server/a.js": "x", "server/b.js": "x" }))).toEqual([]);
    const named = pieces({ "package.json": JSON.stringify({ dependencies: { express: "4" } }), "server/a.js": "x", "server/b.js": "x", "server/c.js": "x" });
    expect(kinds(named)).toEqual(["api:Express"]);
    expect(named[0]!.evidence.map((e) => e.code)).toEqual(["dependency"]);
  });

  it("names a site from its folder, and leaves a bot's own code out of any server", () => {
    expect(kinds(pieces({ "components/a.jsx": "x", "components/b.jsx": "x", "components/c.jsx": "x" }))).toEqual(["ui:"]);
    const bot = pieces({ "package.json": JSON.stringify({ dependencies: { telegraf: "4" } }), "bot/a.js": "x", "bot/b.js": "x", "bot/c.js": "x" });
    expect(kinds(bot)).toEqual(["chatbot:Telegraf"]);
  });

  it("caps the folder evidence at five files", () => {
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`api/f${i}.py`, "x"]));
    expect(pieces(many)[0]!.evidence).toHaveLength(5);
  });


  it("a project with no manifest gives no pieces and does not throw", () => {
    expect(detectPieces(emptyInput)).toEqual([]);
    expect(pieces({ "scripts/a.sh": "echo", "scripts/b.sh": "echo", "run.py": "import os\n" })).toEqual([]);
  });

  it("finds a website from react in package.json, on the modules importing it", () => {
    const list = pieces({
      "package.json": JSON.stringify({ dependencies: { React: "18" } }),
      "src/components/A.tsx": 'import React from "react";\n', "src/components/B.tsx": 'import { useState } from "react";\n', "src/components/C.tsx": "export const c = 1;\n",
    });
    expect(kinds(list)).toEqual(["ui:React"]);
    expect(list[0]).toEqual({ kind: "ui", tech: "React", evidence: [{ path: "package.json", code: "dependency", reason: "depends on React" }], modules: ["src/components"] });
  });

  it("finds a server, a database, a cache, background tasks and an outside service from package.json", () => {
    const list = pieces({
      "package.json": JSON.stringify({ dependencies: { express: "4", pg: "8", ioredis: "5", bullmq: "5", "@aws-sdk/client-s3": "3", "@sendgrid/mail": "8", stripe: "1" }, devDependencies: { "node-cron": "3" } }),
    });
    expect(kinds(list)).toEqual(["api:Express", "database:PostgreSQL", "cache:Redis", "jobs:BullMQ", "jobs:node-cron", "external:AWS", "external:SendGrid", "external:Stripe"]);
  });

  it("finds Python pieces in requirements.txt and pyproject.toml, with the import name of the package", () => {
    const list = pieces({
      "requirements.txt": "# deps\nFastAPI==0.110\npsycopg2-binary>=2\npython_telegram_bot[job-queue]~=21\n-r other.txt\n",
      "pyproject.toml": '[project]\nname = "x"\ndependencies = [\n  "celery>=5",\n  "SQLAlchemy",\n]\n[tool.poetry.dependencies]\npython = "^3.12"\naiogram = "^3"\n',
      "bot/handlers/start.py": "from telegram.ext import Application\n", "bot/handlers/stop.py": "import telegram\n", "bot/handlers/help.py": "x = 1\n",
    });
    expect(kinds(list)).toEqual(["api:FastAPI", "database:PostgreSQL", "database:SQLAlchemy", "jobs:Celery", "chatbot:aiogram", "chatbot:python-telegram-bot"]);
    expect(find(list, "chatbot", "python-telegram-bot")!.modules).toEqual(["bot/handlers"]);
  });

  it("finds Go, Rust and Ruby pieces in go.mod, Cargo.toml and Gemfile", () => {
    const list = pieces({
      "go.mod": "module example.com/shop\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1\nrequire (\n\tgorm.io/gorm v1.25.0 // indirect\n\tgithub.com/labstack/echo/v4 v4.11.0\n)\n",
      "svc/Cargo.toml": '[package]\nname = "svc"\n\n[dependencies]\naxum = "0.7"\nserde = { version = "1" }\n\n[dependencies.diesel]\nversion = "2"\n\n[dev-dependencies]\nsqlx = "0.7"\n',
      "Gemfile": "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\n",
      "cmd/a/main.go": 'package main\nimport "github.com/gin-gonic/gin"\n', "cmd/a/b.go": "package main\n", "cmd/a/c.go": "package main\n",
    });
    expect(kinds(list)).toEqual(["api:Axum", "api:Echo", "api:Gin", "api:Rails", "database:Diesel", "database:GORM", "database:SQLx"]);
    expect(find(list, "api", "Gin")!.modules).toEqual(["cmd/a"]);
  });

  it("finds the other closed cues of each piece", () => {
    const list = pieces({
      "package.json": JSON.stringify({ dependencies: { vue: "3", "@angular/core": "17", "@nestjs/core": "10", mongoose: "8", "better-sqlite3": "9", memcached: "1", "@anthropic-ai/sdk": "1", "discord.js": "14", telegraf: "4" } }),
    });
    expect(kinds(list)).toEqual(["ui:Angular", "ui:Vue", "api:NestJS", "database:MongoDB", "database:SQLite", "cache:Memcached", "external:Anthropic", "chatbot:discord.js", "chatbot:Telegraf"]);
  });

  it("finds the tests family and the ways of going online", () => {
    const list = pieces({
      "tests/a.test.ts": "", "tests/b.test.ts": "", "tests/c.test.ts": "",
      "Dockerfile": "FROM node", ".github/workflows/ci.yml": "on: push", "vercel.json": "{}", "netlify.toml": "", "fly.toml": "", "Procfile": "web: node .",
    });
    expect(kinds(list)).toEqual(["tests:", "deploy:Docker", "deploy:Fly.io", "deploy:GitHub Actions", "deploy:Netlify", "deploy:Procfile", "deploy:Vercel"]);
    expect(find(list, "tests", "")!.modules).toEqual(["tests"]);
    expect(find(list, "deploy", "GitHub Actions")!.evidence).toEqual([{ path: ".github/workflows/ci.yml", code: "ci_workflow", reason: "GitHub workflow" }]);
  });

  it("finds a database from migrations, SQL files and a Prisma schema", () => {
    expect(kinds(pieces({ "db/migrations/001.sql": "", "db/migrations/002.sql": "", "db/migrations/003.py": "" }))).toEqual(["database:"]);
    expect(kinds(pieces({ "prisma/schema.prisma": "", "package.json": "{}" }))).toEqual(["database:Prisma"]);
  });

  it("drops a file-only website or database when a named one is found", () => {
    const list = pieces({
      "package.json": JSON.stringify({ dependencies: { react: "18", pg: "8" } }),
      "index.html": "", "src/A.tsx": "", "migrations/001.sql": "",
    });
    expect(kinds(list)).toEqual(["ui:React", "database:PostgreSQL"]);
    expect(kinds(pieces({ "index.html": "", "src/App.vue": "" }))).toEqual(["ui:Vue"]);
    expect(kinds(pieces({ "index.html": "", "src/A.tsx": "" }))).toEqual(["ui:"]);
  });

  it("a monorepo with web/package.json (react) and api/package.json (express, pg) gives ui on web/*, api and database on api/*", () => {
    const list = pieces({
      "web/package.json": JSON.stringify({ dependencies: { react: "18" } }),
      "api/package.json": JSON.stringify({ dependencies: { express: "4", pg: "8" } }),
      "web/src/components/A.tsx": 'import React from "react";\nimport pg from "pg";\n', "web/src/components/B.tsx": "", "web/src/components/C.tsx": "",
      "api/routes/a.ts": 'import express from "express";\nimport React from "react";\n', "api/routes/b.ts": "", "api/routes/c.ts": "",
      "api/db/pool.ts": 'import { Pool } from "pg";\n', "api/db/q.ts": "", "api/db/r.ts": "",
    });
    expect(kinds(list)).toEqual(["ui:React", "api:Express", "database:PostgreSQL"]);
    expect(find(list, "ui", "React")).toEqual({ kind: "ui", tech: "React", evidence: [{ path: "web/package.json", code: "dependency", reason: "depends on react" }], modules: ["web/src/components"] });
    expect(find(list, "api", "Express")!.modules).toEqual(["api/routes"]);
    expect(find(list, "database", "PostgreSQL")!.modules).toEqual(["api/db"]);
  });

  it("docker-compose with a postgres service adds a database piece with that file as evidence", () => {
    const list = pieces({
      "docker-compose.prod.yml": 'services:\n  db:\n    image: "postgres:16-alpine"\n  cache:\n    image: library/redis@sha256:abc\n  web:\n    image: ghcr.io/me/web:1 # postgres\n',
    });
    expect(kinds(list)).toEqual(["database:PostgreSQL", "cache:Redis", "deploy:Docker"]);
    expect(find(list, "database", "PostgreSQL")!.evidence).toEqual([{ path: "docker-compose.prod.yml", code: "compose_image", reason: "runs the postgres image" }]);
  });

  it("gives every evidence entry a code from the closed list", () => {
    const list = pieces({
      "package.json": JSON.stringify({ dependencies: { react: "1" } }), "src/App.vue": "", "a.svelte": "", "b.tsx": "", "c.html": "",
      "prisma/schema.prisma": "", "migrations/1.sql": "", "q.sql": "", "Dockerfile": "", "compose.yml": "image: redis", ".github/workflows/x.yml": "",
      "vercel.json": "", "netlify.toml": "", "fly.toml": "", "Procfile": "", "tests/a.test.ts": "", "tests/b.test.ts": "", "tests/c.test.ts": "",
    });
    const codes = new Set(list.flatMap((p) => p.evidence.map((e) => e.code)));
    for (const code of codes) expect(EVIDENCE_CODES).toContain(code);
    expect(codes.size).toBeGreaterThan(10);
  });

  it("keeps at most 5 evidence entries per piece, in path order", () => {
    const files: Record<string, string> = {};
    for (const n of [7, 3, 9, 1, 5, 2, 8]) files[`svc${n}/Dockerfile`] = "FROM x";
    const docker = find(pieces(files), "deploy", "Docker")!;
    expect(docker.evidence.map((e) => e.path)).toEqual(["svc1/Dockerfile", "svc2/Dockerfile", "svc3/Dockerfile", "svc5/Dockerfile", "svc7/Dockerfile"]);
  });

  it("ignores broken manifests", () => {
    expect(pieces({ "package.json": "{ not json", "pyproject.toml": "[project\ndependencies = [" })).toEqual([]);
  });

  it("reads large manifests quickly", () => {
    const deps = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`pkg-${i}`, "1"]));
    const requirements = Array.from({ length: 20000 }, (_, i) => `pkg_${i}${"=".repeat(i % 50)}1`).join("\n");
    const compose = `${"image:".repeat(20000)}\n${" ".repeat(50000)}image: x`;
    const start = performance.now();
    detectPieces(project({ "package.json": JSON.stringify({ dependencies: deps }), "requirements.txt": requirements, "docker-compose.yml": compose, "pyproject.toml": `dependencies = [${'"a",'.repeat(20000)}` }));
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("routeMatches", () => {
  it.each([
    ["/api/orders/${id}", "/api/orders/:id", true], ["/api/orders/42", "/api/orders/{order_id}", true],
    ["https://x.test/api/users", "/api/users", true], ["/api/users", "/api/orders", false],
    ["/api/users/", "/api/users", true], ["/api/users?page=2", "/api/users", true], ["/items/7", "/items/<int:item_id>", true],
    ["/api/users/7/posts", "/api/users/:id", false], ["/api", "/api/users", false], ["users", "/users", false],
  ])("routeMatches(%s, %s) = %s", (a, b, ok) => expect(routeMatches(a as string, b as string)).toBe(ok));
});

describe("findCalls and findRoutes", () => {
  it("finds fetch, axios, httpx and requests calls", () => {
    expect(findCalls("src/api.ts", [
      'fetch("/api/users");',
      "await fetch(`${API}/api/orders/${id}`, { method: 'POST' });",
      "fetch('https://shop.test/api/cart?x=1')",
      "axios.get('/api/products'); axios.post(\"/api/orders\", body); axios('/api/me');",
      "fetch(url); axios.get(base + '/x'); fetch('relative/path');",
    ].join("\n"))).toEqual(["/api/users", "/api/orders/${id}", "/api/cart", "/api/products", "/api/orders", "/api/me"]);
    expect(findCalls("client.py", 'httpx.get(f"{BASE}/api/items/{item_id}")\nrequests.post("http://localhost:8000/api/items")\nrequests.get(url)\n')).toEqual(["/api/items/{item_id}", "/api/items"]);
  });

  it("finds express, fastify, fastapi, flask and gin routes", () => {
    expect(findRoutes("server/app.ts", [
      "app.get('/api/users', list);", 'router.post("/api/orders", create);', "app.delete(`/api/orders/:id`, del);",
      "fastify.get('/health', h); fastify.route({ method: 'GET', url: '/api/cart', handler });",
      "axios.get('/not-a-route'); app.get(path, x);",
    ].join("\n"))).toEqual(["/api/users", "/api/orders", "/api/orders/:id", "/health", "/api/cart"]);
    expect(findRoutes("main.py", '@app.get("/items/{item_id}")\ndef read(): ...\n@router.post("/items")\n@app.route("/legacy/<int:id>", methods=["GET"])\n@bp.route(\'/bp\')\nrequests.get("/no")\n')).toEqual(["/items/{item_id}", "/items", "/legacy/<int:id>", "/bp"]);
    expect(findRoutes("main.go", 'r := gin.Default()\nr.GET("/ping", ping)\nv1.POST("/api/orders", create)\n')).toEqual(["/ping", "/api/orders"]);
    expect(findRoutes("src/main.rs", 'let app = Router::new().route("/api/users", get(list));\nApp::new().route("/health", web::get().to(h))\n')).toEqual(["/api/users", "/health"]);
  });

  it("stays fast on large and hostile input", () => {
    const hostile = [
      "fetch(".repeat(20000), "fetch(`" + "a".repeat(100000), "app.get('/" + "x".repeat(100000),
      ".route({" + " ".repeat(100000), "@app.get(" + "f".repeat(50000), "r".repeat(100000) + ".GET(",
      "fetch('/a');app.get('/a');".repeat(5000),
    ].join("\n");
    const start = performance.now();
    findCalls("big.ts", hostile);
    findRoutes("big.ts", hostile);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("linkPieces", () => {
  const shop = () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ dependencies: { react: "18", express: "4", pg: "8", stripe: "1" } }),
      "web/components/Orders.tsx": 'import React from "react";\nexport const load = (id: string) => fetch(`/api/orders/${id}`);\nfetch("/api/users");\n',
      "web/components/Cart.tsx": 'import React from "react";\naxios.post("/api/cart");\nfetch("/api/unknown");\n',
      "web/components/C.tsx": "",
      "server/routes/orders.ts": 'import express from "express";\nimport { pool } from "../db/pool";\nrouter.get("/api/orders/:id", h);\nrouter.post("/api/cart", h);\n',
      "server/routes/users.ts": 'import Stripe from "stripe";\napp.get("/api/users", h);\n',
      "server/routes/c.ts": "",
      "server/db/pool.ts": 'import { Pool } from "pg";\n', "server/db/q.ts": 'import pg from "pg";\n', "server/db/r.ts": "",
    };
    const input = project(files);
    return { input, pieces: detectPieces(input), texts: Object.entries(files).map(([path, text]) => ({ path, text })) };
  };

  it("ui → api link counts matched calls with one example each", () => {
    const { input, pieces: list, texts } = shop();
    const link = linkPieces(list, texts, input.read).find((l) => l.from === "ui" && l.to === "api");
    expect(link).toEqual({
      from: "ui", to: "api", count: 3,
      examples: [
        { from: "web/components/Cart.tsx", to: "server/routes/orders.ts" },
        { from: "web/components/Orders.tsx", to: "server/routes/orders.ts" },
        { from: "web/components/Orders.tsx", to: "server/routes/users.ts" },
      ],
    });
  });

  it("api → database link comes from modules importing the database client", () => {
    const { input, pieces: list, texts } = shop();
    const links = linkPieces(list, texts, input.read);
    expect(links.map((l) => `${l.from}>${l.to}:${l.count}`)).toEqual(["ui>api:3", "api>database:2", "api>external:1"]);
    expect(links.find((l) => l.to === "database")!.examples).toEqual([{ from: "server/db/pool.ts", to: "pg" }, { from: "server/db/q.ts", to: "pg" }]);
  });

  it("a project with ui and api but no matching call has no ui → api link", () => {
    const files = {
      "package.json": JSON.stringify({ dependencies: { react: "18", express: "4" } }),
      "web/A.tsx": 'fetch("/api/nothing");\n', "server/a.ts": 'app.get("/api/users", h);\n',
    };
    const input = project(files);
    expect(linkPieces(detectPieces(input), Object.entries(files).map(([path, text]) => ({ path, text })), input.read)).toEqual([]);
  });

  it("no pieces gives no links", () => {
    expect(linkPieces([], [{ path: "a.ts", text: 'fetch("/x"); app.get("/x", h);' }], [])).toEqual([]);
  });
});

describe("pieceDiagramHtml", () => {
  const piece = (kind: Piece["kind"], tech: string): Piece => ({ kind, tech, evidence: [], modules: [] });

  it("draws one box per kind in the four columns of the app, with plain phrases on the arrows and no counts", () => {
    const html = pieceDiagramHtml({ pieces: [piece("ui", "React"), piece("ui", "Vite"), piece("api", "Express"), piece("database", "PostgreSQL")], links: [{ from: "ui", to: "api", count: 12, examples: [] }, { from: "api", to: "database", count: 3, examples: [] }] }, "shop");
    expect(html).toMatch(/^<!doctype html>/i);
    for (const text of ["Site ou appli", "Serveur", "Base de données", "envoie ses demandes au", "range les informations dans", "shop", "Ce que les gens voient"]) expect(html).toContain(text);
    expect(html).not.toContain("12 appels");
    expect(html).not.toContain("React");
    expect(html.match(/data-piece=/g)).toHaveLength(3);
    expect(html.match(/data-link=/g)).toHaveLength(2);
    const x = (kind: string) => Number(new RegExp(`data-piece="${kind}"><rect x="(-?[\\d.]+)"`).exec(html)![1]);
    expect(x("ui")).toBeLessThan(x("api"));
    expect(x("api")).toBeLessThan(x("database"));
    expect(html).not.toMatch(/<script|https?:\/\//i);
  });

  it("gives each outside service its own box, named by its brand, and fans the server's link out to each", () => {
    const html = pieceDiagramHtml({ pieces: [piece("api", "Express"), piece("database", "PostgreSQL"), piece("external", "Stripe"), piece("external", "SendGrid"), piece("tests", ""), piece("deploy", "Docker")], links: [{ from: "api", to: "external", count: 2, examples: [] }] }, "shop");
    const at = (key: string) => new RegExp(`data-piece="${key}"><rect x="(-?[\\d.]+)" y="(-?[\\d.]+)"`).exec(html)!.slice(1).map(Number);
    expect(at("external:Stripe")[0]).toBe(at("database")[0]);
    expect(at("external:Stripe")[1]).toBeGreaterThan(at("database")[1]);
    expect(html).toContain('data-piece="external:Stripe"');
    expect(html).toContain('data-piece="external:SendGrid"');
    expect(html).toContain("Service extérieur");
    expect(html).toContain("encaisse les paiements avec");
    expect(html).toContain("envoie les e-mails avec");
    expect(html.match(/data-link=/g)).toHaveLength(2);
    expect(html).toContain("Pour fabriquer et mettre en ligne");
    expect(html).toContain("Vérifications");
  });

  it("escapes every label and the title", () => {
    const html = pieceDiagramHtml({ pieces: [piece("external", '<img src=x onerror="alert(1)">&')], links: [] }, "</title><script>x</script>");
    expect(html).not.toContain('"alert');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;");
  });

  it("says plainly when nothing was found, and stays under 30 KB even when crowded", () => {
    expect(pieceDiagramHtml({ pieces: [], links: [] }, "vide")).toContain("Aucun grand bloc");
    const many = Array.from({ length: 60 }, (_, i) => piece((["ui", "api", "database", "external", "deploy"] as const)[i % 5], `Tech number ${i} ${"x".repeat(80)}`));
    const html = pieceDiagramHtml({ pieces: many, links: [{ from: "ui", to: "api", count: 1, examples: [] }] }, "t".repeat(500));
    expect(new TextEncoder().encode(html).length).toBeLessThanOrEqual(30 * 1024);
  });
});

describe("languagesOf", () => {
  it("counts files per language, most used first", () => {
    expect(languagesOf(["a.ts", "b.tsx", "c.py", "README.md", "d.TS", "x", "e.go", "f.py"])).toEqual({ TypeScript: 3, Python: 2, Go: 1 });
  });
});
