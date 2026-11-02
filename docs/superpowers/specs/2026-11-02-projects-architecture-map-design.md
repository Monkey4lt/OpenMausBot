---
title: "design: Carte détaillée de l'intérieur d'un projet (onglet Projets)"
doc_type: spec+audit
execution: code
method: superpowers (brainstorming → plan → TDD rouge/vert/refactor → vérification → revue)
created: 2026-11-02
---

# feat: Carte détaillée de l'intérieur d'un projet

## Résumé

Aujourd'hui, l'onglet **Projets** montre chaque projet comme un bloc avec son arborescence brute.
On ajoute une **carte du projet** : quand on ouvre un projet, ses fichiers sont rangés
automatiquement en **familles** (Interface, Serveur, Données, Tests, Documentation,
Configuration, Ressources, Scripts, Traductions, Autre), chaque famille est découpée en
**modules** (ses sous-dossiers principaux), et des **flèches pondérées** montrent qui utilise qui,
calculées en lisant les `import` / `require` / `use` des fichiers. On peut descendre de niveau
(famille → module → fichier) et voir, pour un fichier, ce qu'il utilise et qui l'utilise.

## 1. Audit de l'existant (2026-11-02)

| Élément | État | Constat |
|---|---|---|
| `server/projects.ts` (184 l.) | Testé (5 tests) | Lit l'arborescence (local, SSH, GitHub). Ne lit **jamais le contenu** des fichiers : impossible de trouver les liens sans ajout. Plafond 5 000 entrées par projet. |
| `server/projects-github.ts` (147 l.) | **Non testé** | Liste des dépôts et arbres via l'API ; connexion via Git Credential Manager. Aucune lecture de contenu. Logique réseau mélangée à la logique pure. |
| `server/routes/projects.ts` (46 l.) | **Non testé** | 4 routes. Pas de test de route (le dépôt en a pour d'autres modules : à reproduire). |
| `src/components/ProjectsPage.tsx` (659 l.) | **Non testé** | Un seul gros fichier : dialogues, arbre, toile, dessin des liens et rangement. La géométrie (`edge`, rangement, zones de pôles) est du calcul pur enfermé dans le composant : à extraire et tester avant d'ajouter la carte. |
| Vérifications | Partielles | Tests serveur exécutés hors du dépôt (sans `pnpm install` ici). `pnpm typecheck`, `pnpm lint`, `vitest` jamais lancés sur ce code. Le hook pre-push du dépôt (lint + typecheck + i18n) ne tourne pas pour les pushes faits depuis Claude. |
| i18n | OK | Clés en anglais + français, `i18n:check` passe. |
| Sécurité | OK | Chemin SSH échappé et testé, hôte refusé s'il commence par `-`, nom GitHub validé. Routes réservées au propriétaire (pas dans `CLIENT_ALLOW`). |

**Dette à rembourser d'abord (phase 0)** : lancer la vraie suite (`pnpm typecheck && pnpm lint && pnpm vitest run server/projects.test.ts`) sur une machine avec les dépendances, corriger ce qui casse, puis extraire la géométrie de `ProjectsPage.tsx` dans `src/lib/projects-map.ts` sous tests.

## 2. Ce qu'on construit (spécification)

### Niveaux de la carte

1. **Familles** : jusqu'à 10 blocs, couleur fixe par famille, nombre de fichiers.
2. **Modules** : à l'intérieur d'une famille, un bloc par sous-dossier significatif
   (ex. `src/components`, `src/state`, `server/routes`). Un module = le chemin le plus court qui
   regroupe au moins 3 fichiers de la même famille, sur 3 niveaux maximum.
3. **Fichiers** : liste du module, avec pour le fichier choisi « utilise » et « utilisé par ».

### Rangement automatique (règles, testées une à une)

Ordre de priorité : la première règle qui correspond gagne.

| Famille | Exemples de chemins / extensions |
|---|---|
| Tests | `test/`, `tests/`, `__tests__/`, `spec/`, `*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py` |
| Documentation | `docs/`, `*.md`, `*.mdx`, `*.rst`, `README*`, `CHANGELOG*`, `LICENSE*` |
| Traductions | `locales/`, `i18n/`, `lang/`, `*.po` |
| Données | `migrations/`, `db/`, `database/`, `models/`, `schema*`, `prisma/`, `*.sql` |
| Configuration | `package.json`, `tsconfig*`, `*.config.*`, `Dockerfile`, `compose*.y*ml`, `*.toml`, `.github/`, `*.env.example` |
| Scripts | `scripts/`, `bin/`, `*.sh`, `*.ps1`, `*.bat`, `Makefile` |
| Ressources | `public/`, `assets/`, `static/`, images, polices, vidéos |
| Interface | `components/`, `pages/`, `app/`, `views/`, `ui/`, `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.css`, `*.html` |
| Serveur | `server/`, `api/`, `routes/`, `controllers/`, `services/`, `backend/`, `*.go`, `*.rs`, `*.py`, `*.rb`, `*.php`, `*.java` |
| Autre | tout le reste |

L'utilisateur peut **déplacer un module dans une autre famille** et **renommer** une famille ;
ces corrections sont enregistrées dans `projects-map.json` (`overrides[projectId]`) et passent
avant les règles.

### Liens (graphe de dépendances)

- Lecture des imports par langage : JS/TS (`import … from`, `import()`, `require()`, `export … from`),
  Python (`import x`, `from x import`), Go (`import "…"`), Rust (`mod`, `use crate::`), CSS (`@import`).
- Résolution des chemins relatifs vers un fichier du projet (extensions et `index.*` testés) ;
  les paquets externes (`react`, `zod`…) sont comptés à part : « dépendances externes ».
- Agrégation fichier → module → famille, avec le **nombre d'imports** comme épaisseur de flèche.
- Plafonds : 3 000 fichiers lus, 256 Ko par fichier, seulement les extensions de code.

### Lecture du contenu selon la source

| Source | Méthode | Coût |
|---|---|---|
| Ce PC | lecture directe des fichiers | nul |
| SSH | **une seule** commande distante `grep -rEnI` des lignes d'import, mêmes exclusions que l'arbre | 1 connexion |
| GitHub | **une archive** du dépôt (`/tarball`), lue en mémoire (gunzip + lecteur tar minimal) | 1 requête, mise en cache par `pushed_at` |

## 3. Architecture

```
server/projects-architecture.ts   pur : classify(), modulesOf(), parseImports(), resolveImport(), buildArchitecture()
server/projects-sources.ts        lecture du contenu : local, SSH (grep), GitHub (tarball)
server/tar.ts                     lecteur tar minimal (pur, testé)
server/routes/projects.ts         + GET /api/projects/architecture?id=…   + PUT des overrides via /state
src/lib/projects-map.ts           pur : géométrie (bords, rangement, zones), extrait de ProjectsPage
src/components/projects/…         ProjectsPage découpé : Canvas, ProjectBlock, SourcesDialog, ArchitectureView
```

Le calcul se fait côté serveur (une fois, mis en cache par projet et par empreinte de l'arbre),
l'interface ne reçoit qu'un résumé : familles, modules, fichiers, arêtes pondérées.

## 4. Plan TDD (chaque tâche : test rouge → code minimal vert → nettoyage → commit)

**Phase 0 — remettre à plat**
1. Lancer `pnpm typecheck`, `pnpm lint`, `vitest run server/projects.test.ts` ; corriger.
2. Tests de route `server/routes/projects.test.ts` : GET vide, PUT invalide → 400, PUT valide puis GET.
3. Tests `projects-github.ts` avec `fetch` simulé : dépôt, compte, compte vide → message clair, 401 → anonyme, dépôt vide.
4. Extraire `edge()`, rangement et zones dans `src/lib/projects-map.ts` + tests ; `ProjectsPage` les importe (aucun changement visible).

**Phase 1 — rangement en familles** (`projects-architecture.test.ts`)
5. `classify()` : un test par ligne du tableau des familles, plus les cas d'ordre (`src/components/Button.test.tsx` → Tests).
6. `modulesOf()` : regroupement à 3 fichiers min., 3 niveaux max., le reste dans « (racine) ».
7. Overrides : un module déplacé change de famille ; renommer une famille.

**Phase 2 — imports**
8. `parseImports()` : un test par syntaxe et par langage, commentaires et chaînes ignorés.
9. `resolveImport()` : relatif avec et sans extension, `index.*`, alias `@/` lu dans `tsconfig.json`, externe.
10. `buildArchitecture()` : arêtes fichier → module → famille, poids, boucles ignorées, plafonds respectés.

**Phase 3 — lecture du contenu**
11. Local : dossier temporaire de fixtures → architecture attendue.
12. SSH : la commande `grep` produite (échappement, exclusions) + analyse de sa sortie (`fichier:ligne:texte`).
13. Tar : lecteur testé sur une archive générée dans le test ; GitHub tarball avec `fetch` simulé, cache par `pushed_at`.
14. Route `GET /api/projects/architecture` : projet inconnu → 404, succès, erreur de source lisible.

**Phase 4 — interface**
15. `ArchitectureView` : bouton « Carte » sur chaque bloc ; niveaux familles → modules → fichiers ; fil d'Ariane ; panneau « utilise / utilisé par ».
16. Tests de rendu (happy-dom, comme le reste du dépôt) : familles affichées, clic → modules, overrides enregistrés.
17. Textes `en.json` + `fr.json`, `i18n:check`.

**Phase 5 — vérification avant de dire « fini »**
18. `pnpm typecheck && pnpm lint && pnpm i18n:check && vitest run` sur les fichiers touchés.
19. Instance isolée (`docs/verification/README.md`) avec 3 projets fixtures (TS, Python, Go) ; captures.
20. Revue de code par un agent séparé qui n'a pas écrit le code ; corrections ; push.

## 5. Risques et limites

- **Grands dépôts** : plafonds (3 000 fichiers lus) + cache ; au-delà, carte partielle signalée.
- **Alias d'import exotiques** (webpack, monorepos) : non résolus au départ, comptés « externes ».
- **SSH sans `grep -E`** (rare) : erreur claire, la carte affiche les familles sans liens.
- **Vérification complète impossible depuis Claude** sans `pnpm install` : la phase 0 et la phase 5
  se font sur le PC de l'utilisateur ou dans un environnement qui a accès au registre npm.
