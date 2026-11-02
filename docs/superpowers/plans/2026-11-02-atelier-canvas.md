# Atelier, partie A : la toile commune — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une toile commune style workflow (déplacement, zoom, fils courbes, points d'accroche, barre d'outils, mini-carte, notes et dessins), sur laquelle passent la carte des projets — page renommée « Atelier » — et la carte détaillée d'un projet.

**Architecture:** Logique pure dans `src/lib/canvas/` (géométrie, modèle, gestes) testée sans navigateur ; composants minces dans `src/components/canvas/`. La page Projets et `ArchitectureView` remplacent leur défilement par `<Canvas>`. Les annotations sont enregistrées dans `projects-map.json`.

**Tech Stack:** React 19, Tailwind 4, TypeScript, vitest ; aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-11-02-atelier-design.md` (phases A1–A3). La partie B (workflows) aura son propre plan, écrit sur les interfaces livrées ici.

## Global Constraints

- Aucune nouvelle dépendance ; ne pas modifier `src/components/TeamCanvas.tsx` ni `src/lib/team-canvas.ts` (fichiers amont).
- Vue `{x, y, scale}`, échelle bornée à `[0.2, 2.5]`, transformation CSS `translate(x,y) scale(scale)` ; seuil de 5 px avant tout glisser.
- Ctrl/⌘ + molette = zoom autour du curseur ; molette seule = déplacer ; flèches = déplacer de 60 px ; `+`/`-` = zoom ×1.2 ; `0` = ajuster.
- Annotations : 500 au plus par carte ; texte d'une note ≤ 2 000 caractères ; un trait ≤ 2 000 points après simplification.
- Couleurs uniquement via les jetons de thème (marche avec tous les thèmes, Aurora compris).
- Textes fr + en ; `generate-locale --check` passe ; navigation et titre : « Atelier » (fr) / « Workshop » (en).
- Les tâches 5 à 7 ne commencent qu'une fois la branche `cartographe` (partie 2) fusionnée dans `main` (mêmes fichiers).

## Review Focus

- Une carte enregistrée avant ce changement (pas d'`annotations`, `zoom` 0.8) : s'ouvre au même cadrage, sans perte (test tâche 5).
- Un trackpad qui envoie beaucoup de petits `wheel` avec `ctrlKey` (pincer) : zoom fluide, jamais d'échelle hors bornes (test tâche 3).
- Un clic sur un bouton ou un champ dans un bloc : ne démarre jamais un glisser ni un déplacement de la toile (test tâche 3).
- Une note collée avec 10 000 caractères ou des caractères de contrôle : tronquée et nettoyée à l'enregistrement, Cartographe compris (test tâche 6).
- Une toile vide (aucun projet) : « Ajuster » ne produit pas de NaN et revient à la vue par défaut (test tâche 1).

---

### Task 1: Géométrie

**Files:** Create `src/lib/canvas/geometry.ts` — Test `src/lib/canvas/geometry.test.ts`

**Interfaces:**
- Produces: `type View = { x: number; y: number; scale: number }`, `type Rect = { x: number; y: number; w: number; h: number }`, `type Side = "left" | "right" | "top" | "bottom"`, `MIN_SCALE = 0.2`, `MAX_SCALE = 2.5`, `DEFAULT_VIEW: View = { x: 0, y: 0, scale: 1 }`, `clampScale(s)`, `screenToWorld(view, p: {x,y}): {x,y}`, `worldToScreen(view, p)`, `zoomAt(view, factor, at: {x,y}): View`, `boundsOf(rects: Rect[]): Rect | null`, `fitRects(rects, viewport: {w,h}, padding = 48): View`, `portPoint(rect, side, index = 0, count = 1): {x,y}`, `bezierPath(from: {x,y; side}, to: {x,y; side}): string`, `edgeLabelPoint(from, to): {x,y}`, `simplifyStroke(points, tolerance = 1.5): {x,y}[]`.

- [ ] **Step 1: Write the failing tests**

```ts
it("zoomAt keeps the point under the cursor fixed", () => {
  const v = zoomAt({ x: 10, y: 20, scale: 1 }, 2, { x: 110, y: 120 });
  expect(worldToScreen(v, screenToWorld({ x: 10, y: 20, scale: 1 }, { x: 110, y: 120 }))).toEqual({ x: 110, y: 120 });
});
it("zoomAt never leaves [0.2, 2.5]", () => { expect(zoomAt(DEFAULT_VIEW, 100, { x: 0, y: 0 }).scale).toBe(2.5); });
it("fitRects of nothing is the default view, never NaN", () => { expect(fitRects([], { w: 800, h: 600 })).toEqual(DEFAULT_VIEW); });
it("fitRects centres the bounds with padding and caps the scale at 1", () => {});
it("portPoint spreads several ports evenly on a side", () => {});
it("bezierPath from a right port to a left port is a horizontal cubic curve", () => { expect(bezierPath({ x: 0, y: 0, side: "right" }, { x: 100, y: 0, side: "left" })).toMatch(/^M0 0 C/); });
it("simplifyStroke keeps the ends and drops collinear points", () => {});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implémenter. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(atelier): canvas geometry`.

### Task 2: Modèle des éléments de la toile

**Files:** Create `src/lib/canvas/model.ts` — Test `src/lib/canvas/model.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `type Annotation = { id: string; kind: "sticky"; x: number; y: number; w: number; h: number; text: string; color: string } | { id; kind: "text"; x; y; text: string; size: "s" | "m" | "l" } | { id; kind: "shape"; shape: "rect" | "ellipse" | "diamond"; x; y; w; h } | { id; kind: "ink"; points: { x: number; y: number }[] }` ; `MAX_ANNOTATIONS = 500`, `MAX_NOTE_CHARS = 2000`, `MAX_INK_POINTS = 2000` ; `cleanAnnotation(a: unknown): Annotation | null` (types, bornes finies, texte nettoyé des caractères de contrôle sauf retours à la ligne, tronqué) ; `cleanAnnotations(list: unknown): Annotation[]` (≤ 500, ids uniques) ; `annotationBounds(a): Rect`.
- Le schéma zod serveur (tâche 6) reprend exactement ces bornes.

- [ ] **Step 1: Write the failing tests** — un cas valide par type, plus : coordonnées `NaN`/`Infinity` rejetées, texte de 10 000 caractères tronqué à 2 000, caractères de contrôle retirés, 600 annotations ramenées à 500, ids en double dédupliqués, trait de 5 000 points simplifié puis plafonné.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(atelier): canvas annotation model`.

### Task 3: Gestes et vue (pur) + composant Canvas

**Files:** Create `src/lib/canvas/gestures.ts`, `src/components/canvas/Canvas.tsx`, `src/components/canvas/ZoomControls.tsx`, `src/components/canvas/useCanvasView.ts` — Test `src/lib/canvas/gestures.test.ts`, `src/components/canvas/Canvas.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `type Tool = "select" | "hand" | "pencil" | "sticky" | "shape" | "text"`.
  - `wheelToView(view, e: { deltaX; deltaY; ctrlKey; metaKey; clientX; clientY }, origin: {x,y}): View` ; `keyToView(view, key: string, viewport): View | null` ; `startsPan(target: { closest(sel: string): unknown } | null, tool: Tool, button: number, spaceHeld: boolean): boolean` (jamais sur `button, input, textarea, select, [contenteditable], [data-canvas-node]` sauf outil main) ; `passedThreshold(start, now, px = 5): boolean`.
  - `<Canvas view? onViewChange? tool onToolChange? readOnly? underlay? overlay? children toolbar? bottomLeft?>` : fond pointillé qui suit la vue, monde transformé (`data-canvas-world`), gestes, clavier quand la toile a le focus ; `useCanvasView(initial, persistKey?)` (localStorage protégé par try/catch) ; `<ZoomControls view onChange viewport rects>` (−, %, +, ajuster ; clic sur % = ajuster).

- [ ] **Step 1: Write the failing tests**

```ts
it("ctrl+wheel zooms around the cursor; plain wheel pans", () => {});
it("a burst of 50 small pinch events never leaves the scale bounds", () => {});
it("a press on a button, an input or a node never starts a pan with the select tool", () => {});
it("the hand tool pans from anywhere; space+drag pans with any tool", () => {});
it("arrows pan 60 px, + and - zoom 1.2x, 0 fits", () => {});
it("Canvas renders the world with the view transform and the zoom controls with 100%", () => {});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implémenter (modèle repris de `TeamCanvas`, sans l'importer). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(atelier): pan and zoom canvas`.

### Task 4: Blocs, fils, mini-carte, barre d'outils

**Files:** Create `src/components/canvas/NodeFrame.tsx`, `EdgeLayer.tsx`, `Minimap.tsx`, `Toolbar.tsx`, `src/lib/canvas/minimap.ts` — Test `src/lib/canvas/minimap.test.ts`, `src/components/canvas/EdgeLayer.test.ts`, `src/components/canvas/Toolbar.test.ts`

**Interfaces:**
- Produces:
  - `<NodeFrame id rect selected locked ports?: { side: Side; id: string; kind?: "text" | "yes" | "no" }[] onMove(id, x, y) onSelect(id) actions?>` (glisser après le seuil, `data-canvas-node`, poignées de points d'accroche, petite barre dupliquer / verrouiller / supprimer quand sélectionné et `actions` fourni).
  - `<EdgeLayer edges: { id; from: {x,y,side}; to: {x,y,side}; label?; dashed?: boolean; tone?: "default" | "accent" }[] onEdgeClick?>` (courbes `bezierPath`, zone de clic large invisible, étiquette en pastille).
  - `minimapTransform(world: Rect, box: {w,h}): { scale; dx; dy }`, `<Minimap rects view viewport onJump>`.
  - `<Toolbar tool onTool search? onAdd? addLabel?>` (sélection, main, crayon, note, forme, texte, recherche, bouton d'ajout optionnel), icônes lucide déjà utilisées ailleurs dans `src/components`.

- [ ] **Step 1: Write the failing tests** — minimap : rectangle du monde contenu dans la boîte, proportions gardées, saut au point cliqué ; EdgeLayer : un `path` par fil avec `stroke-dasharray` si `dashed`, étiquette rendue, zone de clic ; Toolbar : outil actif marqué `aria-pressed`, bouton d'ajout seulement avec `onAdd`.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(atelier): nodes, curved edges, minimap and toolbar`.

### Task 5: La carte des projets sur la toile, page « Atelier »

**Pré-requis :** branche `cartographe` (partie 2) fusionnée dans `main`.

**Files:** Modify `src/components/ProjectsPage.tsx`, `src/lib/projects-map.ts` (si besoin d'adapter `groupZone`/`arrangeByGroup` aux coordonnées monde), `src/locales/en.json`, `src/locales/fr.json` (`sidebar.nav.projects` → « Atelier » / « Workshop », titre de page) — Test `src/components/ProjectsPage.test.ts`, `src/lib/projects-map.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: la page rend `<Canvas>` ; blocs de projets via `NodeFrame` (sans ports) ; liens via `EdgeLayer` ; zones de pôles dans `underlay` ; « Ranger » inchangé ; `focus(projectId)` centre la vue ; l'ancien `zoom` sert d'échelle initiale ; la vue est mémorisée par appareil (`useCanvasView(…, "atelier.view")`).

- [ ] **Step 1: Write the failing tests**

```ts
it("an old saved map (no annotations, zoom 0.8) opens at scale 0.8 with every block at its saved position", () => {});
it("dragging a block saves its world position through the existing save path with baseRev", () => {});
it("the page title and the nav say Atelier in French", () => {});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implémenter ; captures (sans thème, Aurora). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(atelier): the projects map on the shared canvas, named Atelier`.

### Task 6: Notes, textes, formes, crayon, recherche

**Files:** Create `src/components/canvas/AnnotationLayer.tsx`, `src/components/canvas/CanvasSearch.tsx` — Modify `server/projects.ts` (`annotations` dans `projectMapStateSchema`, mêmes bornes que la tâche 2), `server/projects-summary.ts` (notes et textes nettoyés et plafonnés dans le résumé du Cartographe), `src/components/ProjectsPage.tsx` — Test `src/components/canvas/AnnotationLayer.test.ts`, `server/projects.test.ts`, `server/projects-summary.test.ts`

**Interfaces:**
- Produces: `<AnnotationLayer items tool selectedId onChange(items) onSelect>` : outil note → clic pose une note éditable ; texte → clic pose un texte ; forme → glisser dessine ; crayon → trait simplifié ; suppression avec Retirer/Suppr ; `<CanvasSearch items: { id; label; rect }[] onPick(id)>` (Ctrl/⌘+F quand la toile a le focus).

- [ ] **Step 1: Write the failing tests**

```ts
it("the server schema accepts the annotations of task 2 and rejects 501 of them", () => {});
it("a 10 000-char note with control characters is cleaned and cut to 2 000 on save", () => {});
it("the Cartographe map summary lists note texts, cleaned and within the 20 000-char cap", () => {});
it("search finds a project and a note by a word and centres on it", () => {});
it("the pencil tool stores a simplified stroke", () => {});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(atelier): notes, text, shapes, pencil and search on the canvas`.

### Task 7: Carte détaillée d'un projet sur la toile

**Files:** Modify `src/components/projects/ArchitectureView.tsx` — Test `src/components/projects/ArchitectureView.test.ts`

**Interfaces:** `MapCanvas` rendu dans `<Canvas readOnly>` ; positions de `layoutLevel` ; fils `bezierPath` (imports en trait plein, liens entre pièces en pointillés couleur d'accent, conformément à la partie 2) ; mini-carte et ajuster.

- [ ] **Step 1: Write the failing tests** — la vue détaillée rend la toile en lecture seule (aucun `NodeFrame` déplaçable), les fils d'import et de pièces ont deux styles, « ajuster » cadre tous les blocs.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(atelier): project detail map on the shared canvas`.

### Task 8: Vérification et relecture

- [ ] **Step 1:** Tous les tests `src/lib/canvas/*`, `src/components/canvas/*`, projets et Cartographe → PASS ; `generate-locale --check` PASS ; syntaxe esbuild des `.tsx` touchés.
- [ ] **Step 2:** Captures : vue d'ensemble, note posée, recherche, carte détaillée (sans thème et Aurora).
- [ ] **Step 3:** Relecture par un agent séparé ; corrections ; fusion dans `main`, push.
