# Carte d'architecture des projets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans l'onglet Projets, ouvrir un projet sur une carte où ses fichiers sont rangés en familles puis en modules, reliés par des flèches pondérées calculées depuis les imports.

**Architecture:** Le calcul est pur et côté serveur (`server/projects-architecture.ts`) ; la lecture du contenu dépend de la source (`server/projects-sources.ts` : lecture locale, une commande `grep` SSH, une archive GitHub lue par `server/tar.ts`). Une route renvoie un résumé ; l'interface (`src/components/projects/ArchitectureView.tsx`) l'affiche en trois niveaux. La géométrie de la toile sort de `ProjectsPage.tsx` vers `src/lib/projects-map.ts`.

**Tech Stack:** Node ≥ 24 (type stripping), TypeScript, zod 4, React 19, Tailwind 4, vitest 4 (`renderToStaticMarkup` pour l'UI), aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-11-02-projects-architecture-map-design.md` (contient l'audit de l'existant, le tableau des familles et les plafonds).

## Global Constraints

- Aucune nouvelle dépendance npm ; gunzip via `node:zlib`, tar lu à la main.
- Côté serveur, tout import de type s'écrit `import type` (le serveur tourne en type stripping).
- Nouvelles routes uniquement dans `server/routes/projects.ts` ; rien d'ajouté à `server/index.ts`.
- Plafonds : 3 000 fichiers de code lus par projet, 256 Ko par fichier, module = au moins 3 fichiers, profondeur de module ≤ 3 segments.
- Extensions de code lues : `.ts .tsx .js .jsx .mjs .cjs .vue .svelte .py .go .rs .css .scss`.
- Chemins internes toujours avec `/`, relatifs à la racine du projet, même sous Windows.
- Toute chaîne visible passe par `t()` avec une clé dans `src/locales/en.json` et `src/locales/fr.json` ; `pnpm i18n:check` passe.
- Commentaires selon `AGENTS.md` (aucune narration).
- Fin de chaque tâche : `pnpm typecheck` et `pnpm lint` passent.

## Review Focus

- Fichiers en CRLF ou avec BOM : les imports sont trouvés comme en LF (test dans la tâche 7).
- Imports circulaires A ↔ B : deux arêtes, pas de boucle infinie, pas de doublon (test dans la tâche 9).
- Projet sans aucun fichier de code (que de la doc) : carte avec familles et zéro arête, pas d'erreur (test dans la tâche 9).
- Source locale sous Windows : chemins `\` convertis en `/` avant classement et résolution (test dans la tâche 10).
- Projet plus grand que 3 000 fichiers de code : `truncated: true` renvoyé et bandeau visible dans l'UI (tests dans les tâches 9 et 14).

---

### Task 1: Vérification de base de l'existant

**Files:**
- Modify (si nécessaire) : `server/projects.ts`, `server/projects-github.ts`, `server/routes/projects.ts`, `src/components/ProjectsPage.tsx`, `src/components/SidebarProfileMenu.tsx`

**Interfaces:**
- Consumes : rien.
- Produces : une base qui passe typecheck, lint et tests ; aucune signature ne change.

- [ ] **Step 1 :** `pnpm install` puis `pnpm typecheck && pnpm lint && pnpm i18n:check`. Attendu : sortie sans erreur.
- [ ] **Step 2 :** `pnpm vitest run server/projects.test.ts src/components/SidebarProfileMenu.test.ts src/components/SidebarFooterNav.test.ts`. Attendu : PASS.
- [ ] **Step 3 :** Corriger chaque erreur trouvée sans changer le comportement ; relancer jusqu'au vert.
- [ ] **Step 4 :** Commit `fix(projects): pass typecheck, lint and existing tests`.

### Task 2: Tests des routes existantes

**Files:**
- Test : `server/routes/projects.test.ts`

**Interfaces:**
- Consumes : `createProjectRoutes({ dataDir }): RouteHandler` (`server/routes/projects.ts`), `PASS` (`server/routes/table.ts`).
- Produces : un helper de test local `call(route, method, path, body?) → { status, body }` construit sur des `req`/`res` factices, réutilisé en tâche 13.

- [x] **Step 1 : Write the failing tests**

```ts
it("GET /api/projects on an empty data dir returns no sources and no projects", async () => {
  expect(await call(route, "GET", "/api/projects")).toEqual({ status: 200, body: { state: expect.objectContaining({ sources: [] }), projects: [], errors: [] } });
});
it("PUT /api/projects/state rejects an SSH host that starts with a dash", async () => {
  const bad = { sources: [{ id: "s1", label: "x", kind: "ssh", host: "-oProxyCommand=x", path: "/" }] };
  expect((await call(route, "PUT", "/api/projects/state", bad)).status).toBe(400);
});
it("PUT then GET returns the saved groups and scans a local source", async () => { /* fixture dir with api/src/a.ts → projects[0].id === "s1:api" */ });
it("an unreadable source is reported in errors, other sources still load", async () => { /* local path that does not exist + valid one */ });
it("other paths PASS", async () => { expect(await route(ctx("GET", "/api/other"))).toBe(PASS); });
```

- [x] **Step 2 :** `pnpm vitest run server/routes/projects.test.ts` → les tests qui touchent un comportement manquant échouent (attendu : l'erreur de source inexistante n'est pas reportée car `scanLocalLines` renvoie `[]`).
- [x] **Step 3 :** Dans `scanSource`, une source locale dont le dossier n'existe pas lève `Error("Folder not found: <path>")`.
- [x] **Step 4 :** Relancer → PASS.
- [x] **Step 5 :** Commit `test(projects): cover the projects routes`.

### Task 3: Tests du module GitHub

**Files:**
- Modify : `server/projects-github.ts`
- Test : `server/projects-github.test.ts`

**Interfaces:**
- Consumes : rien de nouveau.
- Produces : `setGithubTransport(t: { fetch: typeof fetch; credential: (interactive: boolean) => Promise<string | null> } | null): void` (point d'injection pour les tests ; `null` remet le vrai transport et vide `session` et le cache des arbres).

- [x] **Step 1 : Write the failing tests** (fetch simulé qui répond selon l'URL)

```ts
it("owner/repo gives one project built from the recursive tree", async () => { /* /repos/o/r + /git/trees/main?recursive=1 → lines "d r", "f r/src/a.ts" */ });
it("an account the login owns lists /user/repos (private included)", async () => { /* credential → "tok", /user → {login:"o"}; expect fetch called with "/user/repos?affiliation=owner" */ });
it("another account lists /users/<owner>/repos", async () => {});
it("an account with no visible repository says which login is used", async () => {
  await expect(listGithubRepos("lonelyRaph")).rejects.toThrow("signed in to GitHub as Monkey4lt");
});
it("a rejected token falls back to anonymous once", async () => { /* 401 then 200 */ });
it("an empty repository gives an empty project, not an error", async () => { /* trees → 409 "Git Repository is empty." */ });
it("a tree is fetched again only after a new push", async () => { /* same pushed_at → 1 trees call; new pushed_at → 2 */ });
```

- [x] **Step 2 :** `pnpm vitest run server/projects-github.test.ts` → FAIL (`setGithubTransport` n'existe pas).
- [x] **Step 3 :** Ajouter `setGithubTransport` ; `gh()` et `gitCredential()` passent par le transport courant.
- [x] **Step 4 :** Relancer → PASS.
- [x] **Step 5 :** Commit `test(projects): cover GitHub listing, sign-in fallback and tree cache`.

### Task 4: Extraire la géométrie de la toile

**Files:**
- Create : `src/lib/projects-map.ts`
- Modify : `src/components/ProjectsPage.tsx` (supprimer `edge`, le calcul des zones et `arrange`, importer depuis la lib)
- Test : `src/lib/projects-map.test.ts`

**Interfaces:**
- Produces :
  - `type Rect = { x: number; y: number; w: number; h: number }`
  - `edgePoint(from: Rect, to: Rect, gap = 8): [number, number]`
  - `groupZone(rects: Rect[], pad = { x: 22, top: 52, bottom: 22 }): Rect | null`
  - `arrangeByGroup(buckets: { id: string; h: number }[][], opts = { perRow: 4, step: 340, rowGap: 36, groupGap: 150, x0: 60, y0: 90 }): Record<string, { x: number; y: number }>`

- [x] **Step 1 : Write the failing tests**

```ts
it("edgePoint leaves the right side for a target on the right", () => {
  expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 })).toEqual([108, 25]);
});
it("edgePoint of two rects with the same center is the center", () => { expect(edgePoint(r, r)).toEqual([50, 25]); });
it("groupZone wraps all rects with the label room on top", () => {
  expect(groupZone([{ x: 100, y: 100, w: 300, h: 200 }])).toEqual({ x: 78, y: 48, w: 344, h: 274 });
});
it("groupZone of nothing is null", () => { expect(groupZone([])).toBeNull(); });
it("arrangeByGroup wraps after 4 blocks and leaves a gap between groups", () => { /* 5 blocks h=100 in group 1, 1 in group 2 → [4]=(60,226), group 2 at y=426 */ });
```

- [x] **Step 2 :** `pnpm vitest run src/lib/projects-map.test.ts` → FAIL (module absent).
- [x] **Step 3 :** Écrire les trois fonctions (logique actuelle de `ProjectsPage.tsx`, sans changement de valeurs) et remplacer leur usage dans la page.
- [x] **Step 4 :** Relancer → PASS ; ouvrir Projets dans l'app : rendu identique.
- [x] **Step 5 :** Commit `refactor(projects): move canvas geometry into a tested lib`.

### Task 5: Classer un fichier dans une famille

**Files:**
- Create : `server/projects-architecture.ts`
- Test : `server/projects-architecture.test.ts`

**Interfaces:**
- Produces :
  - `type Family = "tests" | "docs" | "i18n" | "data" | "config" | "scripts" | "assets" | "ui" | "server" | "other"`
  - `FAMILY_ORDER: readonly Family[]` (l'ordre de priorité ci-dessus)
  - `classify(path: string): Family`

- [x] **Step 1 : Write the failing tests** — un `it.each` sur le tableau de la spec, plus l'ordre :

```ts
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
```

- [x] **Step 2 :** Run → FAIL.
- [x] **Step 3 :** `classify` teste les règles dans `FAMILY_ORDER` : segments de dossier (comparés en minuscules), puis nom de fichier, puis extension. Un `.ts`/`.js` hors dossier reconnu → `server` ; un `.tsx`/`.jsx` → `ui`.
- [x] **Step 4 :** Run → PASS.
- [x] **Step 5 :** Commit `feat(projects): classify files into families`.

### Task 6: Modules et corrections de l'utilisateur

**Files:**
- Modify : `server/projects-architecture.ts`, `server/projects.ts` (schéma d'état)
- Test : `server/projects-architecture.test.ts`, `server/projects.test.ts`

**Interfaces:**
- Consumes : `classify`, `Family`.
- Produces :
  - `type ArchOverrides = { moduleFamily: Record<string, Family>; familyNames: Partial<Record<Family, string>> }`
  - `type ModuleInfo = { id: string; family: Family; files: string[] }` — `id` = préfixe de chemin (`src/components`) ou `"(root)/<family>"`
  - `modulesOf(paths: string[], overrides?: ArchOverrides): ModuleInfo[]`
  - Dans `projectMapStateSchema` : `overrides: z.record(idSchema, archOverridesSchema).default({})`

- [x] **Step 1 : Write the failing tests**

```ts
it("groups files of a family under the shortest prefix that holds at least 3 of them", () => {
  const m = modulesOf(["src/components/A.tsx", "src/components/B.tsx", "src/components/c/C.tsx", "src/state/s.ts"]);
  expect(m.find((x) => x.id === "src/components")?.files).toHaveLength(3);
});
it("never makes a module deeper than 3 segments", () => { /* a/b/c/d/e/x{1..3}.ts → module "a/b/c" */ });
it("files that fit no module go to (root)/<family>", () => { /* README.md → "(root)/docs" */ });
it("an override moves a whole module to another family", () => {
  expect(modulesOf(paths, { moduleFamily: { "src/state": "data" }, familyNames: {} }).find((m) => m.id === "src/state")?.family).toBe("data");
});
it("the saved state keeps overrides per project and rejects an unknown family", () => { /* projectMapStateSchema.safeParse */ });
```

- [x] **Step 2 :** Run → FAIL. **Step 3 :** implémenter. **Step 4 :** Run → PASS.
- [x] **Step 5 :** Commit `feat(projects): split families into modules with user overrides`.

### Task 7: Lire les imports d'un fichier

**Files:**
- Modify : `server/projects-architecture.ts` — Test : `server/projects-architecture.test.ts`

**Interfaces:**
- Produces : `type ImportRef = { spec: string; line: number }` ; `parseImports(path: string, text: string): ImportRef[]`

- [x] **Step 1 : Write the failing tests**

```ts
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
it("CRLF and a BOM give the same result as LF", () => {
  expect(parseImports("a.ts", '\uFEFFimport a from "./a";\r\nimport b from "./b";\r\n')).toEqual([{ spec: "./a", line: 1 }, { spec: "./b", line: 2 }]);
});
```

- [x] **Step 2 :** Run → FAIL. **Step 3 :** une expression régulière par langage, choisie par extension ; commentaires `//` et `/* */` retirés pour JS/TS/CSS, `#` pour Python. **Step 4 :** PASS.
- [x] **Step 5 :** Commit `feat(projects): parse imports for JS/TS, Python, Go, Rust and CSS`.

### Task 8: Résoudre un import vers un fichier du projet

**Files:**
- Modify : `server/projects-architecture.ts` — Test : `server/projects-architecture.test.ts`

**Interfaces:**
- Consumes : `ImportRef`.
- Produces : `aliasesFromTsconfig(text: string): Record<string, string>` (ex. `{ "@/": "src/" }`, JSON avec commentaires toléré) ; `aliasesFromGoMod(text: string): Record<string, string>` (ex. `{ "example.com/app/": "" }`) ; `resolveImport(from: string, spec: string, files: ReadonlySet<string>, aliases: Record<string, string>): string | null` (`null` = externe).

- [x] **Step 1 : Write the failing tests**

```ts
const files = new Set(["src/a.ts", "src/b.tsx", "src/lib/index.ts", "src/theme.css", "app/models.py", "app/db/__init__.py", "src/api/routes.rs", "src/db/mod.rs", "db/store.go"]);
it.each([
  ["src/a.ts", "./b", "src/b.tsx"], ["src/a.ts", "./lib", "src/lib/index.ts"], ["src/a.ts", "./theme.css", "src/theme.css"],
  ["src/a.ts", "@/lib", "src/lib/index.ts"], ["src/a.ts", "react", null],
  ["app/x.py", ".models", "app/models.py"], ["app/x.py", "app.db", "app/db/__init__.py"], ["app/x.py", "os", null],
  ["src/main.rs", "crate::api::routes", "src/api/routes.rs"], ["src/main.rs", "self::db", "src/db/mod.rs"],
  ["cmd/main.go", "example.com/app/db", "db/store.go"], ["cmd/main.go", "fmt", null],
])("%s imports %s", (from, spec, to) => expect(resolveImport(from, spec, files, { "@/": "src/", "example.com/app/": "" })).toBe(to));
it("reads paths aliases from a tsconfig with comments", () => {
  expect(aliasesFromTsconfig('{ // c\n "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }')).toEqual({ "@/": "src/" });
});
```

- [x] **Step 2 :** FAIL. **Step 3 :** extensions essayées dans l'ordre `["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".css", ".scss", "/index.ts", "/index.tsx", "/index.js"]` ; Python : points → `/`, `.py` puis `/__init__.py` ; Rust : `crate::`/`self::` → `src/` (fichier du `from`), `.rs` puis `/mod.rs` ; Go : alias du module puis le premier `.go` du dossier. **Step 4 :** PASS.
- [x] **Step 5 :** Commit `feat(projects): resolve imports to project files`.

### Task 9: Construire l'architecture

**Files:**
- Modify : `server/projects-architecture.ts` — Test : `server/projects-architecture.test.ts`

**Interfaces:**
- Consumes : `classify`, `modulesOf`, `resolveImport`, `ArchOverrides`, `ImportRef`.
- Produces :

```ts
export type FileImports = { path: string; imports: ImportRef[] };
export interface Architecture {
  families: { id: Family; name: string; files: number; modules: string[] }[];
  modules: { id: string; family: Family; files: number }[];
  files: { path: string; module: string; uses: string[]; usedBy: string[] }[];
  edges: { level: "family" | "module"; from: string; to: string; weight: number }[];
  external: { name: string; count: number }[];
  truncated: boolean;
}
export function buildArchitecture(paths: string[], read: FileImports[], aliases: Record<string, string>, overrides?: ArchOverrides, limit?: number): Architecture;
```

- [x] **Step 1 : Write the failing tests**

```ts
it("aggregates file imports into weighted module and family edges", () => { /* 2 imports ui→server → family edge weight 2 */ });
it("ignores an import of the same module at module level and of the same family at family level", () => {});
it("circular imports give one edge each way and no duplicate", () => {});
it("a project with only docs has families and no edges", () => { expect(buildArchitecture(["README.md", "docs/a.md"], [], {}).edges).toEqual([]); });
it("external packages are counted by package name", () => { /* "react", "react-dom/client" → react 1, react-dom 1 */ });
it("more files than the limit sets truncated", () => { expect(buildArchitecture(paths4, read4, {}, undefined, 3).truncated).toBe(true); });
it("family names use the overrides", () => {});
```

- [x] **Step 2 :** FAIL. **Step 3 :** implémenter (familles dans `FAMILY_ORDER`, vides omises ; noms par défaut = clés, l'UI traduit). **Step 4 :** PASS.
- [x] **Step 5 :** Commit `feat(projects): build the project architecture graph`.

### Task 10: Lire le contenu en local

**Files:**
- Create : `server/projects-sources.ts` — Test : `server/projects-sources.test.ts`

**Interfaces:**
- Consumes : `parseImports`, `FileImports`.
- Produces : `CODE_EXTENSIONS: readonly string[]` ; `isCodeFile(path: string): boolean` ; `type ImportSet = { read: FileImports[]; tsconfig: string | null; goMod: string | null }` ; `readLocalImports(root: string, paths: string[], limit?: number): Promise<ImportSet>` ; `toPosix(p: string): string`.

- [x] **Step 1 : Write the failing tests**

```ts
it("reads imports of code files only, under 256 KB", async () => { /* fixture: a.ts, big.ts (300 KB), logo.png → only a.ts */ });
it("returns the tsconfig text when present", async () => {});
it("converts Windows separators", () => { expect(toPosix("src\\lib\\a.ts")).toBe("src/lib/a.ts"); });
it("stops at the limit", async () => {});
```

- [x] **Step 2 :** FAIL. **Step 3 :** lecture via `readFile` avec `stat` préalable ; chemins en entrée et en sortie en `/`, joints avec `path.join` pour le disque. **Step 4 :** PASS.
- [x] **Step 5 :** Commit `feat(projects): read imports from local projects`.

### Task 11: Lire le contenu par SSH

**Files:**
- Modify : `server/projects-sources.ts`, `server/projects.ts` (exporter `shellQuote`) — Test : `server/projects-sources.test.ts`

**Interfaces:**
- Consumes : `shellQuote` (`server/projects.ts`), `parseImports`, `CODE_EXTENSIONS`.
- Produces : `sshImportCommand(projectPath: string): string` ; `parseGrepOutput(out: string): FileImports[]` ; `readSshImports(host: string, projectPath: string): Promise<ImportSet>` (la commande ajoute aussi `---GOMOD---` puis `cat go.mod`).

- [x] **Step 1 : Write the failing tests**

```ts
it("quotes the path and keeps ~ for the remote shell", () => {
  expect(sshImportCommand("~/my proj's/api")).toContain(`cd ~/'my proj'\\''s/api'`);
});
it("excludes hidden and heavy folders and only greps code extensions", () => {
  const c = sshImportCommand("/srv/api");
  expect(c).toContain("--exclude-dir=node_modules"); expect(c).toContain("--include=*.ts");
});
it("parses ./path:line:text output into imports per file", () => {
  expect(parseGrepOutput('./src/a.ts:3:import b from "./b";\n./app/x.py:1:from .m import y\n')).toEqual([
    { path: "src/a.ts", imports: [{ spec: "./b", line: 3 }] }, { path: "app/x.py", imports: [{ spec: ".m", line: 1 }] },
  ]);
});
it("a path containing a colon is split on the first :<digits>: only", () => {});
```

- [x] **Step 2 :** FAIL. **Step 3 :** la commande : `cd <chemin> && grep -rEnI --include=… --exclude-dir=… '<motif import>' . | head -n 200000 ; echo ---TSCONFIG--- ; cat tsconfig.json 2>/dev/null`, exécutée comme `scanSshLines` (`BatchMode=yes`, `--` avant l'hôte). **Step 4 :** PASS.
- [x] **Step 5 :** Commit `feat(projects): read imports over SSH with one command`.

### Task 12: Lire le contenu depuis GitHub

**Files:**
- Create : `server/tar.ts` — Test : `server/tar.test.ts`
- Modify : `server/projects-sources.ts`, `server/projects-github.ts` (exporter `githubTarball(fullName: string, ref: string): Promise<Uint8Array>` qui passe par le transport de la tâche 3) — Test : `server/projects-sources.test.ts`

**Interfaces:**
- Produces : `readTar(buf: Uint8Array): { path: string; data: Uint8Array }[]` (fichiers réguliers seulement, en-têtes `ustar` avec `prefix`, et en-têtes PAX `path=`) ; `readGithubImports(repo: GithubRepo): Promise<ImportSet>`, mis en cache par `pushedAt`.

- [x] **Step 1 : Write the failing tests**

```ts
it("reads a tar built in the test, with a long PAX path", () => { /* build 2 entries by hand: 512-byte headers + data */ });
it("ignores directories and symlinks", () => {});
it("strips the GitHub top folder <owner>-<repo>-<sha>/", async () => { /* simulated transport returns gzip(tar) */ });
it("downloads the tarball once per push", async () => {});
```

- [x] **Step 2 :** FAIL. **Step 3 :** `gunzipSync` puis `readTar` ; même filtre code/256 Ko qu'en local. **Step 4 :** PASS.
- [x] **Step 5 :** Commit `feat(projects): read imports from GitHub tarballs`.

### Task 13: Route de l'architecture

**Files:**
- Modify : `server/routes/projects.ts`, `server/projects.ts` (export `findProject(state, id)`) — Test : `server/routes/projects.test.ts`

**Interfaces:**
- Consumes : `buildArchitecture`, `readLocalImports`, `readSshImports`, `readGithubImports`, `aliasesFromTsconfig`, `aliasesFromGoMod`, helper `call` (tâche 2).
- Produces : `GET /api/projects/architecture?id=<sourceId:name>` → `200 Architecture` ; `404 { error }` si projet inconnu ; `502 { error }` si la source ne répond pas. Cache mémoire par `id` + empreinte de la liste des chemins.

- [x] **Step 1 : Write the failing tests**

```ts
it("returns the architecture of a local project", async () => { /* fixture ui→server import → edges contains family ui→server */ });
it("unknown project → 404", async () => {});
it("a source that fails → 502 with its message", async () => {});
it("a second call with the same files does not read them again", async () => {});
```

- [x] **Step 2 :** FAIL. **Step 3 :** implémenter. **Step 4 :** PASS.
- [x] **Step 5 :** Commit `feat(projects): serve the architecture of one project`.

### Task 14: Vue « Carte » dans l'interface

**Files:**
- Create : `src/components/projects/ArchitectureView.tsx`, `src/components/projects/ArchitectureView.test.ts`
- Modify : `src/components/ProjectsPage.tsx` (bouton « Carte » dans l'en-tête de chaque bloc, ouvre la vue à la place de la toile), `src/locales/en.json`, `src/locales/fr.json`

**Interfaces:**
- Consumes : route de la tâche 13, `Architecture`, `edgePoint` (tâche 4), PUT `/api/projects/state` pour `overrides`.
- Produces : `ArchitectureView({ project: { id: string; name: string }, onBack: () => void })` ; fonction pure exportée `levelOf(arch: Architecture, focus: { family?: Family; module?: string }): { nodes: { id: string; label: string; files: number }[]; edges: { from: string; to: string; weight: number }[] }`.
- Clés i18n : `projects.map.open`, `projects.map.back`, `projects.map.family.<famille>` (10), `projects.map.files`, `projects.map.uses`, `projects.map.usedBy`, `projects.map.external`, `projects.map.truncated`, `projects.map.moveTo`, `projects.map.rename`, `projects.map.loading`, `projects.map.error`.

- [x] **Step 1 : Write the failing tests** (`renderToStaticMarkup`, `setLocale("fr")`)

```ts
it("levelOf at the top shows families and family edges", () => {});
it("levelOf inside a family shows its modules and module edges between them", () => {});
it("renders family names in French", () => { expect(html).toContain("Interface"); expect(html).toContain("Serveur"); });
it("shows the truncated banner when truncated is true", () => { expect(html).toContain("Carte partielle"); });
it("a file panel lists uses and used by", () => {});
```

- [x] **Step 2 :** FAIL. **Step 3 :** implémenter ; épaisseur de flèche `1 + Math.log2(weight)`, couleurs de famille fixes ; menu « Déplacer vers… » sur un module → écrit `overrides`. **Step 4 :** PASS ; `pnpm i18n:check` PASS.
- [x] **Step 5 :** Commit `feat(projects): architecture map view`.

### Task 15: Vérification finale et revue

- [ ] **Step 1 :** `pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm vitest run server/projects*.test.ts server/tar.test.ts server/routes/projects.test.ts src/lib/projects-map.test.ts src/components/projects src/components/Sidebar*` → tout PASS.
- [ ] **Step 2 :** Instance isolée selon `docs/verification/README.md`, trois projets fixtures (TS + React, Python, Go) ; captures des trois niveaux de carte pour chacun.
- [ ] **Step 3 :** Revue par un agent qui n'a pas écrit le code (superpowers:requesting-code-review) ; corriger ce qui est retenu.
- [ ] **Step 4 :** Commit des corrections, push.
