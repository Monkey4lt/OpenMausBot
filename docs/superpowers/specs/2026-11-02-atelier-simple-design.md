# Atelier : spec « simple d'abord »

Two words only on screen: **pôle** (a group of projects) and **bloc** (a part of a project). A project is a **projet**, shown as a card, never called a "bloc". Everything technical stays reachable, but only behind « Voir les fichiers » or « Vue détaillée ».

## 1. Walkthrough as the user (current state → verdict)

- **First open (7 real projects):** he sees seven tall boxes filled with monospace folder names (`archives`, `nginx`, `cloudflare`…), each scrolling on its own, plus `79 fichiers` / `4735+ fichiers`. Nothing says what a project *does*. The header icons (network, chain, chevron) carry no meaning. The source icon (SSH / GitHub / disk) is noise.
- **No En bref yet:** the box has no sentence at all, and the only way to get one is buried inside the map (« Demander au Cartographe une fiche En bref »).
- **Huge repo (OpenMausBot, 4735+):** the box looks like every other box, so size means nothing. Opening the map shows a long « Lecture des fichiers du projet… » with no hint of how long it takes, then a yellow bar « Carte partielle : seuls les 3000 premiers fichiers de code… ».
- **1 file (lonelyBot, README.md):** the map shows one "Documentation" family with "1 fichier". That's an empty, puzzling screen.
- **Inside a map:** families (Interface/Serveur/Données/Configuration/Autre) and the pieces (Site / interface **React**, Serveur / API **Express**) say the same thing twice in two vocabularies. Arrows show bare numbers (`1`). On top of that come « Liens entre pièces » with counts and « Outils externes utilisés » `react 4 · pg 1`.

| On screen | Decision |
|---|---|
| File tree in each card | **Hide**: « Voir les fichiers (2 825) », a local toggle that isn't saved |
| `N fichiers` line under the name | **Move** into the « Voir les fichiers » button |
| Source icon SSH/GitHub/disk | **Remove** from the card (tooltip on the name only). Use the pôle color dot instead |
| Network icon (open map) | **Replace** with a text button « Comment ça marche » |
| Chain icon (relier) | **Keep** (it's a pôle-level feature), tooltip « Relier à un autre projet » |
| Fold chevron | **Remove** (nothing left to fold) |
| Search « …ou un fichier » | **Rename** to « Chercher un projet ». File search lives inside « Voir les fichiers » |
| Families / modules / files drill-down | **Vue détaillée** |
| Tech names (React, Express, PostgreSQL) | **Vue détaillée** / « Comment on le sait ». Exception: an outside service is *named* by its brand (Stripe) |
| Arrow numbers, « N appels / fichiers » | **Remove** from arrows; shown in the arrow's « Comment on le sait » |
| « Les pièces du projet » chips, « Liens entre pièces » legend | **Remove** (the canvas itself is now the pieces) |
| « Outils externes utilisés » strip | **Vue détaillée** only, renamed « Briques toutes faites utilisées » |
| Truncated warning | **Soften** to one grey line (see §5) |
| Header « Relire les dossiers » / help « Comment ça marche » | **Rename**: « Mettre à jour » / « Mode d'emploi » (the old help title collides with the new view) |

## 2. Overview card (fixed size, `BLOCK_W` 320 × ~176, identical for every project)

From top to bottom:
1. **Name**, plus the pôle dot (or « + Choisir un pôle »), plus the chain icon.
2. **One sentence**: the first line of En bref (`summaryPreview`, 2-line clamp).
   - **No summary:** grey « Pas encore décrit. » followed by the button « ✦ Demander au Cartographe de le décrire ». That button opens the panel with the existing `panelDraft({projectName})`.
3. **Bloc chips**: at most **3** chips, then « +2 ».
   - One chip per *kind*, so React and Vite count as one "Site ou appli".
   - Order: ui, chatbot, api, jobs, database, cache, external.
   - **tests and deploy never appear on the card.**
   - Each chip is icon + short word. No icons are shown until the bloc kinds are known (see §6 data).
4. **Footer**: « Comment ça marche » (main action), then on the right a quiet « Voir les fichiers (2 825) ».
   - Opening the files grows the card and shows the existing tree (max-h 330).
   - The `+` count format is kept for truncated projects.

**Click:** dragging the card surface still moves it. That's required because `NodeFrame.onSelect` fires on pointer-down, so it can't double as "open". Both the name and « Comment ça marche » open the project view. Both are buttons, so they never start a drag.

**Plain labels:** change `PIECE_LABELS.fr` once. That single table feeds the UI, the Cartographe and its diagram. All icons are already imported in `ArchitectureView.tsx`.

| kind | label (fr) | icon | default line when the Cartographe hasn't written one |
|---|---|---|---|
| ui | Site ou appli | Monitor | Ce que les gens voient et utilisent. |
| chatbot | Bot de messagerie | MessageSquare | Répond aux gens dans une messagerie. |
| api | Serveur | Server | Reçoit les demandes et fait le travail. |
| jobs | Tâches automatiques | Timer | Travaille tout seul, en fond ou à heure fixe. |
| database | Base de données | Database | Garde les informations pour plus tard. |
| cache | Mémoire rapide | Zap | Garde sous la main ce qui sert souvent. |
| external | *brand name* (Stripe…), with the subtitle « Service extérieur » | Plug | Un service d'une autre entreprise. |
| tests | Vérifications | FlaskConical | Vérifie que tout marche avant la mise en ligne. |
| deploy | Mise en ligne | Rocket | Met le projet en ligne. |

## 3. « Comment ça marche » view (the default when a project opens)

**Header and summary:**
- Header: ← Retour aux projets · project name · on the right a quiet « Vue détaillée ».
- Below it, the En bref paragraph, kept as is, or the « décrire » button.

**Layout:** a pure `flowLayout(pieces, links)` function places the blocs in 4 left→right columns. Each column has a faint heading:
1. « Ce que les gens voient » (ui, chatbot)
2. « Ce qui travaille derrière » (api, jobs)
3. « Où c'est rangé » (database, cache)
4. « Services extérieurs » (one box per external tech)

Each column is stacked top-down. Box rules:
- One box per kind. Pieces of the same kind merge; their tech names are only listed under « Comment on le sait ».
- Each box shows icon, label and a one-line description (the Cartographe's text, else the default line).
- tests and deploy sit in a slim, quiet row underneath: « Pour fabriquer et mettre en ligne ».
- Rendering reuses `Canvas` (readOnly), locked `NodeFrame` and `EdgeLayer` with its `label` (no new component).
- Align the server's `DIAGRAM_COLUMNS` to the same 4 columns so the Cartographe's picture matches.

**Arrows:** existing `PieceLink` kinds become phrases, read as "[from] → phrase → [to]". No counts on the arrows.

| link | phrase |
|---|---|
| ui → api (call matches a route) | envoie ses demandes au |
| api → database (imports db client) | range les informations dans |
| api → cache (imports redis…) | garde sous la main dans |
| api → external, Stripe | encaisse les paiements avec |
| api → external, Nodemailer / SendGrid | envoie les e-mails avec |
| api → external, Twilio | envoie les SMS avec |
| api → external, OpenAI / Anthropic | demande à l'IA de |
| api → external, AWS / Firebase / other | utilise |

The api → external link is one aggregate link. Draw it to every external box.

**Arrow rules:**
- Draw only detected links, no invented ones.
- A link whose end has no box is dropped.

**« Pourquoi »:** clicking a box or an arrow opens one small card under the canvas (the same spot as today's evidence card), titled « Comment on le sait ».
- For a box: plain reasons via `evidenceLine`, the paths in small grey text, the tech names, and « Voir ces fichiers dans la vue détaillée ».
- For an arrow: « Trouvé 3 fois dans le code », with up to 5 example pairs.

**Fallbacks:**
- **0 blocs:** show the En bref if there is one, then « Je n'ai pas encore reconnu de grands blocs dans ce projet. », the button « Demander au Cartographe de l'expliquer », and a « Vue détaillée » link.
- **≤ 3 files** (lonelyBot): skip the map and show the file list directly (« Ce projet contient 1 fichier : README.md »).

**Vue détaillée:**
- The button swaps the canvas for today's families → modules → files drill-down, unchanged. The En bref stays on top.
- The button then reads « ← Vue simple ». The breadcrumb's root also returns to the simple view.
- It always opens in simple mode and is never remembered, so he can't get stuck in detail.

## 4. Cartographe

- **Card sentence:** reuse `describe_project`. In the soul, the *first line* of the summary becomes the card sentence: ≤ 120 characters, what it does and for whom, no tech word. The lines after it are the En bref.
- **Bloc descriptions:** add one op, `describe_piece {projectId, piece, text≤160}`.
  - `piece` is the kind, or `external:<Tech>` for outside services.
  - It's stored in `ArchOverrides.pieceText`.
  - Don't reuse familyText: families ≠ blocs (the data family holds migrations and json files), and the mismatch would show.
- **Link phrases:** keep them deterministic (table above). No new field.
- **Soul changes:** propose the summary and `describe_piece` for each detected bloc. Write family and module descriptions only when asked, since those live in Vue détaillée.
- **Intro message:** replace « familles et modules » with « ses grands blocs ».
- **Draft text:** `projectDraft` becomes « Décris «{name}» : à quoi il sert en une phrase, puis chaque grand bloc en une ligne. »

## 5. Vocabulary sweep (fr, `projects.*`)

**Tu vs vous:** the overview says *tu* and the map says *vous*. Use **tu** everywhere.

| key | now | proposed |
|---|---|---|
| search | Chercher un projet ou un fichier | Chercher un projet |
| refresh | Relire les dossiers | Mettre à jour |
| fold | Plier / déplier | (remove). New: `files.show` « Voir les fichiers ({files}) », `files.hide` « Masquer les fichiers » |
| sources.intro | …devient un bloc. | …devient un projet. |
| help.title | Comment ça marche | Mode d'emploi |
| help.step1 | Chaque bloc est un projet. Clique sur les dossiers… | Chaque carte est un projet. « Comment ça marche » montre ses grands blocs. |
| help.step2 / step3 | …dans un bloc / l'icône lien d'un bloc | …sur un projet / l'icône lien d'un projet |
| help.step4 | Déplace les blocs… par le haut | Déplace les projets en les attrapant. |
| cartographe.projectDraft | Cartographie «{name}» : … schéma… | see §4 |
| map.openTitle | Ouvrir la carte de {name} | Comment marche {name} |
| map.briefAsk | Demander au Cartographe une fiche En bref | Demander au Cartographe de le décrire |
| map.pieces / pieceLinks | Les pièces du projet / Liens entre pièces | (remove) |
| map.piecesHint | Cliquez sur une pièce… | Clique sur un bloc pour voir comment on le sait. |
| map.pieceEvidence | Pourquoi « {name} » | Comment on le sait |
| map.pieceModules | Dans : {modules} | Rangé dans : {modules} |
| map.pieceLinkCalls/Files | {count} appels / fichiers | Trouvé {count} fois dans le code |
| map.external | Outils externes utilisés | Briques toutes faites utilisées |
| map.renameTitle | Renommer la famille {name} | Renommer « {name} » |
| map.renameText / pickFile | Laissez… / Choisissez… | Laisse… / Choisis… |
| map.family.config / scripts / assets | Configuration / Scripts / Ressources | Réglages / Petits programmes / Images et fichiers |
| map.loading | Lecture des fichiers du projet… | Je lis le projet… Un grand projet peut prendre une minute. |
| map.error | Impossible de dessiner la carte : | Impossible de lire ce projet : |
| map.truncated | Carte partielle : seuls les {limit} premiers… | Projet très grand : seule une partie a été lue, il peut manquer des blocs. |
| map.canvas | Carte du projet | Comment marche le projet |

**New keys:** `projects.card.notDescribed`, `projects.card.describe`, `projects.card.how`, `projects.flow.detail` (« Vue détaillée »), `projects.flow.simple` (« Vue simple »), `projects.flow.col.{see,work,store,outside,build}`, `projects.flow.phrase.*`, `projects.flow.none`, `projects.flow.fewFiles`.

**Outside `projects.*` (secondary):** `atelier.canvas.search` « Trouver un bloc » becomes « Trouver un projet ou une note » on the overview.

**Workflows also use « bloc »** (« Ajouter un bloc », `workflows.*`), which clashes with the new meaning. Rename those to « étape » (« Lancer cette étape » already uses that word). Other techy bits to flag in the workflow editor:
- « Workflow(s) » (English, and it would clash with « Automatisations ») → « Enchaînements »
- « Consigne système » → « Consigne permanente »
- Model picker « Claude Haiku 4.5 » → behind « Réglages avancés »
- « 20 étapes · 1,00 $ » → « 1 $ max par lancement »
- The `T` port glyph has no meaning for him
- « Déclencheur / Condition / Approbation » → « Quand démarrer / Question oui-non / Ton accord »

## 6. Minimal implementation plan

**Data already there:**
- pieces, pieceLinks, evidence and examples, via `GET /api/projects/architecture`
- summary (`overrides.summary`), `summaryPreview`
- PIECE_LABELS / ICONS / COLORS
- Canvas, NodeFrame, EdgeLayer labels
- `panelDraft`

**Missing:**
- (a) Bloc kinds on the overview. `/api/projects` only scans trees. Inspection reads every file and can take up to 180 s, so it must never run from the overview.
- (b) `pieceText`.
- (c) A fallback for projects whose server has no known framework. OpenMausBot itself may show no "Serveur".

**Steps:**
1. **`shared/projects-pieces.ts`:**
   - new fr labels
   - `pieceKey()`
   - `FLOW_COLUMNS`
   - `CARD_KINDS` (no tests/deploy)
   - `LINK_PHRASES` + `externalPhrase(tech)`
   - default lines (fr/en)
   - Add `pieceText?: Record<string,string>` to `ArchOverrides` (`shared/projects-architecture.ts`) and to the state schema.
2. **`server/projects-inspect.ts`:**
   - When no `api` or `ui` piece was found but the `server` or `ui` family has ≥ 3 code files, add a piece with tech "" and a new evidence code `folder` (« des fichiers rangés dans un dossier serveur »).
   - Align `DIAGRAM_COLUMNS` to the 4 flow columns.
3. **`server/routes/projects.ts`:**
   - After each inspection, write `projects-pieces.json` ({projectId: PieceKind[]}, atomic, 0600) in dataDir.
   - `GET /api/projects` returns `pieceKinds` from that file and never triggers an inspection.
   - Icons appear once a project was opened or described by the Cartographe.
4. **`server/projects-changes.ts` + `agents-cartographe-tools.ts`:**
   - `describe_piece` op: zod, apply, card line « Dans X : décrire le bloc «Serveur» : «…» ».
   - `summarizeArchitecture` keeps `pieceText`.
   - Soul and intro edits as in §4.
5. **`src/lib/projects-architecture-view.ts`:** pure `cardPieces(kinds)` (dedupe, order, max 3 + overflow), `flowLayout(pieces, links, texts)` → {rects, edges with phrase labels, columns}, `linkPhrase(link, piece)`.
6. **`ProjectsPage.tsx` card:**
   - Remove the source icon, fold button, map icon and default tree.
   - Add sentence or ask button, chips, footer buttons, local `filesOpen` state.
   - Search matches name + summary.
   - Leave `S.collapsed` untouched (no migration).
7. **`ArchitectureView.tsx`:**
   - `mode: "simple" | "detail"`, starting at "simple".
   - New `FlowCanvas` (reusing Canvas/NodeFrame/EdgeLayer) plus the « Comment on le sait » card.
   - Remove the badges and legend from `ProjectSummary`.
   - Move the external strip under detail.
   - Add the fallbacks.
8. **`fr.json` / `en.json`:** the sweep in §5. Workflow renames go in a separate PR.

**Tests:**
- `cardPieces`: dedupe, excludes tests/deploy, overflow count.
- `flowLayout`: column order, merged kinds, a link dropped when one end is missing, external fan-out, phrase per tech.
- detectPieces folder fallback: fires only without a named piece.
- `describe_piece`: validation (key format, 160 chars), apply, card text.
- `/api/projects`: returns cached kinds and does not call the reader's inspect.
- ArchitectureView renders:
  - opens in simple mode
  - « Vue détaillée » → families, and « Vue simple » comes back
  - 0-bloc fallback
  - ≤ 3-file list
- ProjectsPage card renders:
  - no tree by default
  - ask button without a summary
  - « Voir les fichiers » shows the tree
- Locale key parity.
- Screenshots (desk + phone, default + aurora): overview of 7 real-like projects, shop flow, lonelyBot, an OpenMausBot-sized repo.

**Risks:**
- Detection is a closed cue list. Several of his projects (bots, Python scripts) may show few blocs or none. The fallback and the Cartographe's descriptions carry them.
- Icons are absent on the first visit until each project has been opened once. Saying « Range mes projets » to the Cartographe fills them in.
- api → external is one aggregate link, so every outside service gets an arrow even if only one is really imported. Acceptable, and checkable from the examples.
- `pieceText` keys can go stale when a tech changes. Show nothing extra; the default line takes over.
- The « bloc » word stays ambiguous until the workflow rename ships.
