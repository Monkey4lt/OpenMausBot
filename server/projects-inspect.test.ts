import { describe, expect, it } from "vitest";

import { buildArchitecture, parseImports } from "./projects-architecture.ts";
import { detectPieces, isManifestPath } from "./projects-inspect.ts";
import type { Piece } from "../shared/projects-pieces.ts";

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
    expect(list[0]).toEqual({ kind: "ui", tech: "React", evidence: [{ path: "package.json", reason: "depends on React" }], modules: ["src/components"] });
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
    expect(find(list, "deploy", "GitHub Actions")!.evidence).toEqual([{ path: ".github/workflows/ci.yml", reason: "GitHub workflow" }]);
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
    expect(find(list, "ui", "React")).toEqual({ kind: "ui", tech: "React", evidence: [{ path: "web/package.json", reason: "depends on react" }], modules: ["web/src/components"] });
    expect(find(list, "api", "Express")!.modules).toEqual(["api/routes"]);
    expect(find(list, "database", "PostgreSQL")!.modules).toEqual(["api/db"]);
  });

  it("docker-compose with a postgres service adds a database piece with that file as evidence", () => {
    const list = pieces({
      "docker-compose.prod.yml": 'services:\n  db:\n    image: "postgres:16-alpine"\n  cache:\n    image: library/redis@sha256:abc\n  web:\n    image: ghcr.io/me/web:1 # postgres\n',
    });
    expect(kinds(list)).toEqual(["database:PostgreSQL", "cache:Redis", "deploy:Docker"]);
    expect(find(list, "database", "PostgreSQL")!.evidence).toEqual([{ path: "docker-compose.prod.yml", reason: "runs the postgres image" }]);
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
