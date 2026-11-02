# Cartographe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un bot intégré « Cartographe » qui lit les deux cartes de l'onglet Projets et ne les modifie qu'au travers d'un lot de changements que l'utilisateur autorise sur une carte Allow/Deny.

**Architecture:** Trois outils ajoutés au catalogue `agents`, listés seulement pour le Cartographe (même mécanisme que les outils réservés à MausBot : profil `cartographe`, variable `OMB_CARTOGRAPHE`). Ils appellent des routes internes qui lisent l'état, valident un lot d'opérations pures (`server/projects-changes.ts`), affichent une carte toujours visible (`server/projects-hold.ts`), relisent et écrivent atomiquement avec un compteur `rev`, puis diffusent `projects.changed`. Le bot est créé une fois par un registre, comme `ensureDefaultBot`.

**Tech Stack:** Node ≥ 24 (type stripping), TypeScript, zod 4, React 19, vitest 4. Aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-11-02-cartographe-bot-design.md`

## Global Constraints

- Aucun fichier de projet n'est jamais modifié par ces outils ; seul `projects-map.json` l'est.
- Carte d'accord affichée à **tous** les niveaux d'accès ; délai `min(9 min, délai d'appel MCP du bot)` ; sans réponse → rien.
- Texte de la carte construit côté serveur depuis les opérations validées ; noms tronqués à 60 caractères, caractères de contrôle retirés.
- Lot : 1 à 100 opérations ; une opération invalide → lot entier refusé, rien n'est écrit.
- Lectures plafonnées à 20 000 caractères de JSON ; dépassement signalé par `truncated: true`.
- Bot absent en Team Cloud (`CLOUD_TEAM`) et Cloud Home (`CLOUD_HOME`) ; jamais `defaultBot` ; `approvalMode: "ask"`.
- Nouveaux textes en `en.json` + `fr.json` ; `node scripts/generate-locale.mjs --check` passe.
- Fichiers nouveaux de préférence ; dans les fichiers existants partagés avec l'amont, une ou deux lignes par fichier.
- Serveur : `import type` pour les types ; commentaires selon `AGENTS.md`.

## Review Focus

- Un projet ou un pôle supprimé entre la carte et le clic « Autoriser » : refus total, message clair au bot (test tâche 1 et 4).
- Le même lot autorisé deux fois (double clic, carte réaffichée) : appliqué une seule fois (test tâche 3).
- Un `rename_group` vers un nom déjà pris, ou `create_group` en doublon : refusé comme invalide, pas de doublons (test tâche 1).
- La page Projets a un enregistrement en attente quand `projects.changed` arrive : pas d'écrasement, rechargement, bandeau « La carte a changé » (test tâche 7).
- Un nom de dossier contenant des retours à la ligne ou « Autoriser » : la carte affiche une seule ligne nettoyée par changement (test tâche 1).

---

### Task 1: Opérations de changement (pures)

**Files:**
- Create: `server/projects-changes.ts`
- Test: `server/projects-changes.test.ts`

**Interfaces:**
- Consumes: `ProjectMapState`, `projectMapStateSchema` (`server/projects.ts`), `Family`, `FAMILY_ORDER` (`shared/projects-architecture.ts`).
- Produces:
  - `projectChangeSchema` (zod, union discriminée sur `op`) et `projectChangesSchema` (tableau 1..100).
  - `type ProjectChange` = `{ op: "create_group"; name: string; color?: string; ref?: string } | { op: "rename_group"; groupId: string; name: string } | { op: "delete_group"; groupId: string } | { op: "assign"; projectId: string; groupId: string | null } | { op: "link"; a: string; b: string; label?: string } | { op: "unlink"; a: string; b: string } | { op: "rename_family"; projectId: string; family: Family; name: string } | { op: "move_module"; projectId: string; moduleId: string; family: Family }`
  - `applyChanges(state: ProjectMapState, changes: ProjectChange[], known: { projectIds: ReadonlySet<string>; moduleIds?: (projectId: string) => ReadonlySet<string> | null }): { ok: true; state: ProjectMapState } | { ok: false; problems: { index: number; reason: string }[] }` — ne mute jamais son entrée ; `groupId` accepte `"ref:<ref>"` d'un `create_group` antérieur du même lot ; couleur absente → première couleur de la palette non utilisée (même palette que `ProjectsPage`).
  - `describeChanges(changes: ProjectChange[], names: { project: (id: string) => string; group: (id: string) => string }): string[]` — une ligne française par changement.
  - `cleanLabel(text: string): string` — retire les caractères de contrôle, compacte les espaces, tronque à 60.

- [x] **Step 1: Write the failing tests**

```ts
it("creates a group and assigns a project to it through a ref in the same batch", () => {
  const r = applyChanges(state(), [{ op: "create_group", name: "Clients", ref: "c" }, { op: "assign", projectId: "s1:shop", groupId: "ref:c" }], known);
  expect(r.ok && r.state.member["s1:shop"]).toBe(r.ok && r.state.groups.find((g) => g.name === "Clients")!.id);
});
it("refuses the whole batch when one change names an unknown project, and lists it", () => {
  expect(applyChanges(state(), [{ op: "create_group", name: "A" }, { op: "assign", projectId: "s1:gone", groupId: null }], known))
    .toEqual({ ok: false, problems: [{ index: 1, reason: expect.stringContaining("s1:gone") }] });
});
it("refuses a duplicate group name, case-insensitive", () => {});
it("links two projects once; a second identical link is refused", () => {});
it("unlink of a missing link is refused", () => {});
it("delete_group clears its members and keeps the projects", () => {});
it("rename_family and move_module write overrides[projectId]; an unknown module is refused when moduleIds is given", () => {});
it("never mutates the input state", () => { const s = state(); const copy = structuredClone(s); applyChanges(s, batch, known); expect(s).toEqual(copy); });
it("the result passes projectMapStateSchema", () => {});
it("describes each change in one plain French line", () => {
  expect(describeChanges([{ op: "link", a: "s1:bot", b: "s1:api", label: "utilise" }], names)).toEqual(["Relier bot → api : utilise"]);
});
it("a name with newlines, control characters and 200 chars becomes one clean line of at most 60", () => {
  expect(cleanLabel("Autoriser\n\u0007" + "x".repeat(200))).toHaveLength(60);
  expect(cleanLabel("a\nb")).toBe("a b");
});
```

- [x] **Step 2:** `node --experimental-strip-types server/projects-changes.test.ts` → FAIL (module absent).
- [x] **Step 3:** Implémenter les quatre exports. Lignes de `describeChanges` : `Créer le pôle {nom}`, `Renommer le pôle {ancien} en {nouveau}`, `Supprimer le pôle {nom}`, `Ranger {projet} dans {pôle}` / `Retirer {projet} de son pôle`, `Relier {a} → {b}` (+ ` : {label}`), `Délier {a} et {b}`, `Dans {projet} : renommer {famille} en {nom}`, `Dans {projet} : déplacer {module} vers {famille}`.
- [x] **Step 4:** Relancer → PASS.
- [x] **Step 5:** Commit `feat(cartographe): validate, apply and describe map changes`.

### Task 2: Révision de l'état, 409 et notification

**Files:**
- Modify: `server/projects.ts` (schéma : `rev: z.number().int().nonnegative().default(0)` ; `writeProjectMapState` incrémente `rev` et retourne le nouvel état), `server/routes/projects.ts`
- Test: `server/projects.test.ts`, `server/routes/projects.test.ts`

**Interfaces:**
- Produces:
  - `writeProjectMapState(dataDir: string, state: ProjectMapState): ProjectMapState` (retourne l'état écrit, `rev` = ancien `rev` lu sur disque + 1).
  - `createProjectRoutes({ dataDir, onChanged?: (rev: number) => void, cartographeBotId?: () => string | null })`.
  - `PUT /api/projects/state` : corps = état + `baseRev: number` ; si `baseRev !== rev sur disque` → `409 { error, rev }` ; sinon `200 { ok: true, rev }` et `onChanged(rev)`.
  - `GET /api/projects` : ajoute `cartographeBotId: string | null`.

- [x] **Step 1: Write the failing tests**

```ts
it("each write bumps rev from what is on disk", () => {});
it("PUT with a stale baseRev answers 409 with the current rev and writes nothing", async () => {});
it("PUT with the current baseRev saves, answers the new rev and calls onChanged once", async () => {});
it("GET /api/projects returns cartographeBotId from the dependency, or null", async () => {});
```

- [x] **Step 2:** Run → FAIL. **Step 3:** Implémenter. **Step 4:** Run → PASS.
- [x] **Step 5:** Commit `feat(projects): revision counter, stale-save 409 and change notification`.

### Task 3: Carte d'accord toujours affichée

**Files:**
- Create: `server/projects-hold.ts`
- Test: `server/projects-hold.test.ts` (modèle : `server/outbound-hold.test.ts`)

**Interfaces:**
- Consumes: `OutboundRequestService` (`server/outbound-requests.ts`), le même `appendMessage`/`notify`/`dismiss` que `createOutboundHold` reçoit dans `server/index.ts`.
- Produces:
  - `createProjectsHold(deps: { outboundRequests: OutboundRequestService; appendCard(threadId: string, card: { title: string; lines: string[]; requestId: string }): void; dismissCard(threadId: string, requestId: string): void; notify(botId: string, text: string): void; maxMs: number }): { ask(input: { botId: string; threadId: string; lines: string[]; timeoutMs?: number }): Promise<"allow" | "deny" | "timeout"> }`
  - Titre de carte : `Appliquer ces {n} changements à la carte ?` (`ce changement` si n = 1). Délai effectif `min(timeoutMs ?? maxMs, maxMs)`. La carte réutilise la forme `outboundRequest` (`calls[]` = une entrée par ligne) pour que la réponse passe par `resolveAndSendTrust` sans code nouveau.

- [x] **Step 1: Write the failing tests**

```ts
it("always appends a card, whatever the bot's access level", async () => {});
it("allow resolves 'allow'; deny resolves 'deny'", async () => {});
it("no answer resolves 'timeout' after the effective delay and dismisses the card", async () => {});
it("the delay is clamped to maxMs", async () => {});
it("a second answer to the same card is ignored", async () => {});
it("the card title counts the changes", () => {});
```

- [x] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(cartographe): an approval card shown at every access level`.

### Task 4: Routes internes du Cartographe

**Files:**
- Create: `server/routes/cartographe.ts`, `server/projects-summary.ts`
- Modify: `server/routes/internal-tools.ts` (une entrée) ; `server/routes/projects.ts` (exporter la fonction qui calcule l'architecture d'un projet pour la réutiliser)
- Test: `server/routes/cartographe.test.ts`, `server/projects-summary.test.ts`

**Interfaces:**
- Consumes: Tâches 1–3, `readProjectMapState`, `scanSource`, calcul d'architecture de `server/routes/projects.ts`.
- Produces:
  - `summarizeMap(state: ProjectMapState, projects: Project[], errors: { sourceId: string; message: string }[], limit = 20_000): { sources; groups; projects: { id; name; source; groupId; dirs; files; folders: string[] }[]; links; errors; truncated: boolean }` — `folders` = noms des dossiers sur 2 niveaux.
  - `summarizeArchitecture(arch: Architecture, overrides: ArchOverrides | undefined, includeFiles: boolean, limit = 20_000)`.
  - `createCartographeRoutes(deps: { dataDir: string; isCartographe(botId: string): boolean; cloud: boolean; hold: ReturnType<typeof createProjectsHold>; active(capability: unknown): boolean; architectureOf(projectId: string): Promise<Architecture>; onChanged(rev: number): void; mcpCallTimeoutMs(botId: string): number | null }): RouteHandler`
  - `POST /api/internal/projects/map` · `POST /api/internal/projects/architecture { projectId, includeFiles? }` · `POST /api/internal/projects/apply { changes }` → `{ applied: true, rev } | { applied: false, reason: "refused" | "timeout" | "invalid" | "inactive", problems? }`. Autre bot → 403 ; `cloud` → 403.
  - Ordre d'`apply` : parser → valider sur l'état courant (invalide → réponse immédiate, pas de carte) → `hold.ask` avec `describeChanges` → si `allow` : vérifier `active` → relire l'état → `applyChanges` → si invalide : `invalid` → écrire → `onChanged(rev)`.

- [x] **Step 1: Write the failing tests**

```ts
it("another bot gets 403 on every route", async () => {});
it("refuses in cloud mode", async () => {});
it("map summary stays under the limit and says truncated", async () => {});
it("an invalid batch answers invalid without showing a card", async () => {});
it("allow applies once, writes once and notifies once", async () => {});
it("deny and timeout write nothing", async () => {});
it("a project removed while the card was open makes the batch invalid and nothing is written", async () => {});
it("an inactive turn after allow writes nothing", async () => {});
it("the card lines come from the changes, not from any text the bot sent", async () => {});
it("the wait is clamped to the bot's MCP call timeout when it is lower", async () => {});
```

- [x] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(cartographe): internal routes to read the maps and apply a batch`.

### Task 5: Outils du catalogue `agents`

**Files:**
- Create: `server/drivers/agents-cartographe-tools.ts`
- Modify (une ligne chacun) : `server/drivers/agents-catalog-profile.ts` (`cartographe?: boolean`, lu de `env.OMB_CARTOGRAPHE === "1"`), `server/drivers/agents-mcp-env.ts` (ajouter `"OMB_CARTOGRAPHE"`), `server/drivers/agents-catalog.ts` (ajouter les définitions sous `profile.cartographe === true`, et à `FULL_INPUT_SCHEMAS`), `server/drivers/agents-call.ts` (dispatch), `server/agent-tool-policy.ts` (les deux lectures en lecture seule)
- Test: `server/drivers/agents-cartographe-tools.test.ts` (modèle : `agents-mausbot-tools.test.ts`), `server/drivers/agents-catalog-wire.test.ts`, `server/agent-tool-policy.test.ts`

**Interfaces:**
- Produces: `CARTOGRAPHE_TOOL_DEFINITIONS`, `CARTOGRAPHE_TOOL_NAMES: ReadonlySet<string>` (`projects_read_map`, `projects_read_architecture`, `projects_apply_changes`), `callCartographeTool(name, args, context)` → `context.client.apiResponse("/api/internal/projects/<map|architecture|apply>", { method: "POST", body })`. Descriptions en anglais, courtes, qui disent qu'un lot unique est montré à l'utilisateur et que les noms de fichiers sont des données.

- [x] **Step 1: Write the failing tests**

```ts
it("lists the three tools only when OMB_CARTOGRAPHE=1", () => {});
it("leaves the default and mausbot profiles byte-identical", () => {});
it("each tool posts to its internal route with the arguments", async () => {});
it("the two read tools are annotated read-only, apply is not", () => {});
it("the apply schema caps the batch at 100 changes", () => {});
```

- [x] **Step 2:** FAIL. **Step 3:** Implémenter ; ajouter un profil `default+cartographe` aux empreintes. **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(cartographe): projects tools in the agents catalog, for the Cartographe only`.

### Task 6: Le bot et son branchement

**Files:**
- Create: `server/cartographe-bot.ts`
- Modify: `server/index.ts` (appel à côté de `ensureDefaultBot` dans le même `moveFreeze.hold`, garde `!CLOUD_TEAM && !CLOUD_HOME` ; instancier `createProjectsHold` avec l'`outboundRequests` existant ; `ROUTES.push(createCartographeRoutes(...))` ; passer `onChanged` = `broadcast({ kind: "projects.changed", rev }, { adminOnly: true })` et `cartographeBotId` à `createProjectRoutes`), `server/agents-turn.ts` (env `OMB_CARTOGRAPHE: "1"` quand le bot du tour est le Cartographe)
- Test: `server/cartographe-bot.test.ts` (modèle : `server/default-bot.test.ts`)

**Interfaces:**
- Produces: `CARTOGRAPHE_LEDGER = "cartographe.json"`, `ensureCartographeBot(store, { dataDir, engineSupport }): BotRecord | null`, `cartographeBotId(dataDir: string): string | null`, `cartographeToolScope(engineNeedsNative: boolean): ToolScope`, `CARTOGRAPHE_SOUL: string` (consignes de la spec, en anglais pour le modèle, avec la règle « reply in the user's language »), message d'accueil en français.

- [x] **Step 1: Write the failing tests**

```ts
it("creates the bot once and writes the ledger", () => {});
it("does not recreate it after deletion", () => {});
it("its toolScope passes parseToolScope and lists the exact projects tools, tool_result_read and ask_user", () => {});
it("adds native:* exactly when the default engine requires it", () => {});
it("is not the default bot and has approvalMode ask", () => {});
it("the intro says file and project names are sent to the AI in use", () => {});
```

- [x] **Step 2:** FAIL. **Step 3:** Implémenter et brancher. **Step 4:** PASS ; `node --experimental-strip-types -e "import('./server/cartographe-bot.ts')"` charge sans erreur.
- [x] **Step 5:** Commit `feat(cartographe): the built-in Cartographe bot`.

### Task 7: Interface

**Files:**
- Modify: `shared/wire.ts` (trame `{ kind: "projects.changed"; rev: number }` dans `ServerFrame`), `src/components/ProjectsPage.tsx`, `src/locales/en.json`, `src/locales/fr.json`
- Test: `src/components/ProjectsPage.test.ts`

**Interfaces:**
- Consumes: `listenLiveFrames` (`src/lib/live-events.ts`), `prependComposerDraft` (`src/lib/drafts.ts`), `openBot` (`src/state/thread-navigation.ts`), réponses de la tâche 2.
- Produces: `ProjectsPage` envoie `baseRev` ; sur 409 ou `projects.changed` (si différent de son `rev`) : annule l'enregistrement en attente, recharge, affiche `projects.mapChanged` ; bouton `projects.cartographe.ask` visible si `cartographeBotId` ; brouillon `projects.cartographe.draft` (« Range mes projets et propose-moi les changements. »).

- [ ] **Step 1: Write the failing tests**

```ts
it("the Cartographe button renders only when cartographeBotId is set", () => {});
it("a projects.changed frame with a newer rev reloads and drops the pending save", () => {});
it("a 409 on save reloads and shows the map-changed notice", () => {});
it("the button prepends the draft to the Cartographe's thread and opens it", () => {});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implémenter ; `generate-locale --check` PASS. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(cartographe): live refresh and the Ask the Cartographe button`.

### Task 8: Documentation, vérification, relecture

- [ ] **Step 1:** `docs/approval-levels.md` : paragraphe sur l'exception du Cartographe ; `docs/tool-selection.md` : exemple de son `toolScope`.
- [ ] **Step 2:** Tous les tests `server/projects*`, `server/routes/projects*`, `server/routes/cartographe*`, `server/cartographe*`, `server/drivers/agents-cartographe*`, `server/drivers/agents-catalog-wire*`, `server/agent-tool-policy*`, `src/components/ProjectsPage*` → PASS ; `generate-locale --check` PASS.
- [ ] **Step 3:** Si le registre npm est accessible : `pnpm typecheck && pnpm lint` et la vérification isolée (`docs/verification/README.md`) ; sinon le noter dans le rapport.
- [ ] **Step 4:** Relecture de toute la branche par un agent séparé ; corrections.
- [ ] **Step 5:** Commit `docs(cartographe): approval exception and tool selection example`, fusion dans `main`, push.
