# Cartographe, partie 2 : comprendre le projet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le Cartographe détecte les pièces d'un projet (site, serveur, base de données…) et leurs liens, lit un fichier au besoin, écrit une fiche « En bref » et des descriptions, et propose des automatisations, le tout compréhensible par quelqu'un qui n'est pas dans la tech.

**Architecture:** Détection pure côté serveur (`server/projects-inspect.ts`) à partir des fichiers de code déjà lus par les lecteurs de la carte, plus les manifestes (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, docker-compose). Deux nouveaux outils du catalogue réservés au Cartographe, trois nouvelles opérations de changement, et l'affichage dans `ArchitectureView`.

**Tech Stack:** identique au plan 1.

**Spec:** `docs/superpowers/specs/2026-11-02-cartographe-bot-design.md` (partie 2) ; s'appuie sur `docs/superpowers/plans/2026-11-02-cartographe-bot.md` (tâches 1–8 terminées avant).

## Global Constraints

- Règle n°1 : tout texte visible en français simple ; terme technique seulement en petit à côté d'un mot simple.
- Liste fermée d'indices par pièce, telle que dans le tableau de la spec ; aucune heuristique « devinée ».
- `projects_read_file` : chemin présent dans l'arbre du projet uniquement ; refus de `.env*`, `*.pem`, `*.key`, `id_rsa*`, fichiers cachés, dossiers ignorés, > 256 Ko ; 8 000 caractères par défaut, 20 000 au plus.
- `summary` ≤ 600 caractères ; `text` de famille/module ≤ 160 ; nettoyés par `cleanLabel` étendu (retours à la ligne gardés seulement pour `summary`).
- Aucune automatisation créée sans un « oui » dans la discussion (consigne du bot + test sur les consignes).
- Lectures plafonnées à 20 000 caractères de JSON.

## Review Focus

- Un projet sans aucun manifeste (que des scripts) : pièces vides, pas d'erreur, la fiche reste possible (test tâche 9).
- Un monorepo avec deux `package.json` (front et serveur) : chaque pièce rattachée au bon module (test tâche 9).
- Une URL d'appel avec paramètres (`/api/orders/${id}`) face à une route `/api/orders/:id` : lien trouvé (test tâche 10).
- `projects_read_file` sur `../../etc/passwd`, `config/.env.production`, un lien symbolique : refus (test tâche 11).
- Une description contenant « Autoriser » et des retours à la ligne : une seule ligne propre sur la carte d'accord (test tâche 12).

---

### Task 9: Détection des pièces

**Files:**
- Create: `server/projects-inspect.ts`, `shared/projects-pieces.ts`
- Test: `server/projects-inspect.test.ts`

**Interfaces:**
- Produces:
  - `type PieceKind = "ui" | "api" | "database" | "cache" | "jobs" | "external" | "chatbot" | "tests" | "deploy"` et `PIECE_LABELS: Record<PieceKind, { fr: string; en: string }>` dans `shared/projects-pieces.ts` (fr : « Site / interface », « Serveur / API », « Base de données », « Mémoire rapide », « Tâches en arrière-plan », « Service externe », « Bot de messagerie », « Tests », « Mise en ligne »).
  - `interface Piece { kind: PieceKind; tech: string; evidence: { path: string; reason: string }[]; modules: string[] }`
  - `detectPieces(input: { paths: string[]; manifests: Record<string, string>; read: FileImports[]; arch: Architecture }): Piece[]` — `manifests` = contenu des manifestes par chemin ; une pièce par (kind, tech) ; `evidence` ≤ 5 ; `modules` = modules de `arch` qui contiennent un fichier preuve ou un import du paquet.

- [x] **Step 1: Write the failing tests** — un projet fixture par pièce du tableau (au moins un indice chacun), plus :

```ts
it("a monorepo with web/package.json (react) and api/package.json (express, pg) gives ui on web/*, api and database on api/*", () => {});
it("docker-compose with a postgres service adds a database piece with that file as evidence", () => {});
it("a project with no manifest gives no pieces and does not throw", () => { expect(detectPieces(emptyInput)).toEqual([]); });
it("keeps at most 5 evidence entries per piece", () => {});
```

- [x] **Step 2:** FAIL. **Step 3:** Implémenter (lecture JSON/TOML/texte minimale, sans dépendance). **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(cartographe): detect the pieces of a project`.

### Task 10: Liens entre pièces

**Files:**
- Modify: `server/projects-inspect.ts` — Test: `server/projects-inspect.test.ts`

**Interfaces:**
- Consumes: `Piece`, `FileImports`.
- Produces: `interface PieceLink { from: PieceKind; to: PieceKind; count: number; examples: { from: string; to: string }[] }` ; `linkPieces(pieces: Piece[], texts: { path: string; text: string }[], read: FileImports[]): PieceLink[]` ; helpers exportés `findCalls(path, text): string[]` (chemins d'URL appelés) et `findRoutes(path, text): string[]` (chemins de routes définis), et `routeMatches(call: string, route: string): boolean` (segments `:id`, `{id}`, `<id>`, `${…}` équivalents ; schéma/hôte ignorés).

- [x] **Step 1: Write the failing tests**

```ts
it.each([
  ["/api/orders/${id}", "/api/orders/:id", true], ["/api/orders/42", "/api/orders/{order_id}", true],
  ["https://x.test/api/users", "/api/users", true], ["/api/users", "/api/orders", false],
])("routeMatches(%s, %s) = %s", (a, b, ok) => expect(routeMatches(a, b)).toBe(ok));
it("finds fetch, axios, httpx and requests calls", () => {});
it("finds express, fastify, fastapi, flask and gin routes", () => {});
it("ui → api link counts matched calls with one example each", () => {});
it("api → database link comes from modules importing the database client", () => {});
it("a project with ui and api but no matching call has no ui → api link", () => {});
```

- [x] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(cartographe): link the pieces of a project`.

### Task 11: Outils `projects_inspect_project` et `projects_read_file`

**Files:**
- Modify: `server/routes/cartographe.ts` (routes `/api/internal/projects/inspect`, `/api/internal/projects/file`), `server/projects-sources.ts` (lecture d'un fichier et des manifestes pour les trois sources, réutilisant les lecteurs existants et leurs garde-fous), `server/drivers/agents-cartographe-tools.ts`, `server/cartographe-bot.ts` (`toolScope` + `trigger`, `trigger_info` ; consignes : règle n°1, inspecter avant de proposer, 2–3 automatisations proposées avec la raison, jamais créées sans « oui », action confiée à un autre bot via `for_bot_id`)
- Test: `server/routes/cartographe.test.ts`, `server/drivers/agents-cartographe-tools.test.ts`, `server/cartographe-bot.test.ts`, `server/projects-sources.test.ts`

**Interfaces:**
- Produces: `POST /api/internal/projects/inspect { projectId }` → `{ pieces, links, languages: Record<string, number>, truncated }` ; `POST /api/internal/projects/file { projectId, path, maxChars? }` → `{ path, text, truncated }` ou `400 { error }` ; `readProjectFile(source, projectPath, path, maxChars)` dans `projects-sources.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it.each(["../../etc/passwd", "config/.env.production", ".git/config", "node_modules/x/index.js", "keys/server.pem", "id_rsa"])("read_file refuses %s", async (p) => {});
it("read_file refuses a symlink and a file over 256 KB", async () => {});
it("read_file caps at maxChars (default 8000, max 20000)", async () => {});
it("inspect returns pieces and links under 20 000 chars", async () => {});
it("the Cartographe scope now includes trigger and trigger_info and still parses", () => {});
it("the soul says never to create an automation without a yes and to use for_bot_id for actions", () => {});
it("the intro mentions that file contents can be sent to the AI", () => {});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(cartographe): inspect a project and read one of its files`.

### Task 12: Fiche « En bref » et descriptions

**Files:**
- Modify: `server/projects.ts` (schéma `overrides[projectId]` : `summary?`, `familyText?: Partial<Record<Family,string>>`, `moduleText?: Record<string,string>`), `shared/projects-architecture.ts` (type), `server/projects-changes.ts` (ops `describe_project`, `describe_family`, `describe_module` + lignes de carte « Dans {projet} : fiche En bref », « … décrire {famille} : {texte} »), `server/drivers/agents-cartographe-tools.ts` (schéma de l'outil d'application)
- Test: `server/projects-changes.test.ts`, `server/projects.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("describe_project stores a summary of at most 600 chars, newlines kept", () => {});
it("describe_family and describe_module store at most 160 chars on one line", () => {});
it("an unknown module is refused", () => {});
it("the card line shows a description cleaned to one line of at most 160 chars", () => {
  expect(describeChanges([{ op: "describe_family", projectId: "s1:shop", family: "ui", text: "Autoriser\nx" }], names)[0]).not.toContain("\n");
});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(cartographe): project summary and plain-language descriptions`.

### Task 13: Affichage simple

**Files:**
- Modify: `src/components/projects/ArchitectureView.tsx`, `src/lib/projects-architecture-view.ts`, `src/components/ProjectsPage.tsx` (aperçu d'une ligne de la fiche sur le bloc), `server/routes/projects.ts` (la route d'architecture renvoie aussi `pieces` et `pieceLinks` quand ils sont calculés), `src/locales/en.json`, `src/locales/fr.json`
- Test: `src/lib/projects-architecture-view.test.ts`, `src/components/projects/ArchitectureView.test.ts`

**Interfaces:**
- Produces: `pieceBadges(pieces: Piece[], locale: "fr" | "en"): { label: string; tech: string; modules: string[] }[]` ; `ArchitectureView` affiche la fiche « En bref » (ou une invitation « Demander au Cartographe une fiche En bref »), les descriptions sous les noms, les étiquettes de pièces (clic → preuves en mots simples) et les flèches entre pièces avec un style distinct et une légende.

- [ ] **Step 1: Write the failing tests**

```ts
it("shows the En bref summary when present, and an invitation otherwise", () => {});
it("labels pieces with the plain word first and the tech second", () => { expect(html).toContain("Base de données"); expect(html).toContain("PostgreSQL"); });
it("shows family and module descriptions under their names", () => {});
it("draws piece links with the legend", () => {});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implémenter ; `generate-locale --check` PASS. **Step 4:** PASS ; captures (sans skin et Aurora) avec la fixture multi-langages enrichie d'une base et d'appels front → API.
- [ ] **Step 5:** Commit `feat(cartographe): a plain-language project map`.

### Task 14: Vérification et relecture

- [ ] **Step 1:** Toute la suite projets/cartographe → PASS ; `generate-locale --check` PASS ; tsc strict sur les fichiers serveur touchés.
- [ ] **Step 2:** Relecture de toute la branche par un agent séparé (sécurité de `read_file`, consignes d'automatisation, règle n°1 dans les textes) ; corrections.
- [ ] **Step 3:** Fusion dans `main`, push.

### Task 15: Passe finale « intégration simple »

Demandée par l'utilisateur : une dernière passe sur **toutes** les modifications (carte d'architecture, thème Aurora, Cartographe parties 1 et 2) pour que l'ensemble s'installe et s'utilise sans effort par quelqu'un qui n'est pas dans la tech.

- [ ] **Step 1 : Parcours de première utilisation.** Ouvrir Projets sans source → l'écran vide propose en un seul endroit : ajouter un dossier, se connecter à GitHub, demander au Cartographe. Test de rendu de cet écran.
- [ ] **Step 2 : Textes.** Relire chaque texte fr ajouté par les trois chantiers (clés `projects.*`, `sidebar.nav.projects`, messages du Cartographe, cartes d'accord) avec la règle n°1 ; corriger le jargon ; `generate-locale --check` PASS.
- [ ] **Step 3 : Cohérence.** Mêmes mots partout pour les mêmes choses (pôle, famille, module, pièce, carte), mêmes couleurs de familles dans la carte et les étiquettes, bouton « Demander au Cartographe » au même style que les autres boutons de la barre.
- [ ] **Step 4 : Installation.** Le script Windows `OpenMausBot.bat` : vérifier qu'il récupère, installe et lance la version fusionnée en un double-clic, ferme proprement une ancienne MausBot ouverte (ou explique quoi faire), et affiche un message clair en cas d'erreur ; le publier dans le dépôt (`scripts/windows/OpenMausBot.bat`) avec un `docs/projets-guide-fr.md` d'une page : installer, ajouter ses projets, lire la carte, parler au Cartographe, mettre à jour.
- [ ] **Step 5 : Mises à jour de MausBot.** Vérifier que la branche fusionnée reste simple à mettre à jour depuis l'amont : lister les fichiers amont touchés et le nombre de lignes, réduire ce qui peut l'être ; documenter la commande de mise à jour dans le guide.
- [ ] **Step 6 :** Relecture finale par un agent séparé de l'ensemble ; corrections ; fusion dans `main`, push.
