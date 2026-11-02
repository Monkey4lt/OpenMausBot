---
title: "design: Atelier — une toile pour les projets et les workflows"
doc_type: spec
created: 2026-11-02
status: validé en conversation, en attente de relecture du document
inspiration: OpenBot Workflows (idées seulement — licence PolyForm Noncommercial : aucun code, CSS, texte ou schéma repris)
---

# Atelier

## Intention (ce que l'utilisateur a dit)

- Une **seule page**, renommée **« Atelier »** (aujourd'hui « Projets »), avec **une seule toile** dans le style des workflows d'OpenBot, pour **la carte des projets** et **les workflows**.
- Les workflows enchaînent des blocs (déclencheur, IA, bot, condition…) reliés par des fils, modifiables à la souris, et **tournent tout seuls**.
- Pendant une exécution sans personne devant l'écran, un bloc Bot **agit directement** (choix explicite de l'utilisateur), avec une **limite par exécution : 20 étapes et 1 $** par défaut, modifiables par workflow.
- Le **Cartographe** voit projets et workflows et peut **proposer un workflow** sous forme de schéma ; il n'est créé qu'après « Autoriser ».
- Règle n°1 (comme le Cartographe) : compréhensible par quelqu'un qui n'est pas dans la tech.

## Hypothèses par défaut

- Les notes et dessins de la toile sont **lisibles par le Cartographe** (indications laissées par l'utilisateur).
- La **Condition** coûte un petit appel d'IA par passage (réponse stricte Oui/Non ; toute autre réponse = échec de l'étape).
- Les workflows apparaissent **aussi** dans la page Automatisations (liste/calendrier) parce qu'ils s'appuient sur ses déclencheurs.
- Le bouton de navigation garde son emplacement ; seul son nom et le titre de la page changent.

## Réponses de l'utilisateur (2026-11-02, après la première version de ce document)

- **Envoyer** : vers une **notification** (ordinateur et téléphone) et vers **la discussion d'un bot**. Discord et e-mail ne sont pas dans la version 1.
- **Automatisations existantes** : chacune apparaît dans l'Atelier comme un **mini-workflow** (Déclencheur → Bot), ouvrable ; lui ajouter des blocs la transforme en vrai workflow (la routine d'origine devient la cible `workflow`, sans perte de réglages, avec retour arrière possible tant qu'aucun bloc n'a été ajouté).
- **Échec la nuit** : une **notification** « Le workflow {nom} a échoué à l'étape {bloc} », avec un clic qui ouvre l'exécution.

## Expérience

### Toile commune

- Déplacement à la main (outil main, ou glisser le fond), molette = déplacer, Ctrl/⌘ + molette = zoom autour du curseur, touches flèches / + / − / 0 (ajuster).
- Bas à gauche : −, pourcentage, +, ajuster, mini-carte.
- Bas au centre : sélection, main, crayon, note, formes (rectangle, ellipse, losange), texte, recherche (« trouver un bloc »), « + Ajouter un bloc » (dans un workflow).
- Fils courbes en pointillés entre points d'accroche ; étiquette au milieu ; clic sur un fil → le supprimer.
- Sur un bloc sélectionné : dupliquer, verrouiller, supprimer.

### Page Atelier

- Barre de gauche : **Pôles** (projets, comme aujourd'hui) puis **Workflows** (liste, « + Nouveau workflow »).
- Vue d'ensemble : les projets (blocs actuels), les pôles, les liens, les notes ; un workflow **rattaché à un projet** apparaît en petit bloc accroché au projet avec une pastille d'état de sa dernière exécution.
- Clic sur un workflow : la toile montre ses blocs ; fil d'Ariane « Atelier › {workflow} ».
- Carte détaillée d'un projet (icône réseau) sur la même toile, en lecture seule (positions calculées).
- Panneau Cartographe à droite (déjà prévu dans le chantier Cartographe).

### Blocs de workflow (version 1)

| Bloc | Réglages | Sorties |
|---|---|---|
| Déclencheur | à la main ; planifié (une fois, chaque jour à HH:MM, jours de la semaine, intervalle) ; quand la limite d'une IA se réinitialise. Affiche « Prochaine exécution » et « Lancer maintenant ». | texte du déclenchement |
| IA | consigne, consigne système facultative, modèle (sélecteur des modèles de l'appli) | texte |
| Bot | instruction, bot (sélecteur), modèle (facultatif) | texte (réponse finale du bot) |
| Condition | une question en français | Oui / Non |
| Approbation | message affiché | Oui / Non (pause jusqu'à la réponse ou 24 h) |
| Envoyer | notification (ordinateur et téléphone), ou message dans la discussion d'un bot | — |
| Note | texte libre | — (jamais exécutée) |

Les déclencheurs par **adresse web** et par **événement d'appli** viennent dans une phase suivante (même mécanisme).

### Exécution

- « Lancer » (tout) et « Lancer cette étape » (un bloc, avec l'entrée de la dernière exécution).
- Les blocs se colorent : en attente, en cours, réussi, échoué, ignoré ; clic → ce que le bloc a reçu et produit (4 Ko gardés).
- Une étape échouée coupe ses fils sortants ; les blocs en aval sont « ignorés ». « Réessayer cette étape » relance l'aval.
- Historique des exécutions (500 au plus par fichier), arrêt possible à tout moment.
- Limites : `maxSteps` (20) et `maxCostUsd` (1 $) par exécution ; un coût inconnu compte comme inconnu, jamais comme zéro, et l'exécution s'arrête si le total connu dépasse la limite ; contrôle du budget global de l'appli avant chaque étape.
- Validation en clair avant d'enregistrer : bloc sans réglage obligatoire, bot introuvable, fil vers une note, boucle (refusée en version 1), deux déclencheurs.

## Architecture

### Toile (fichiers nouveaux, propres à ce fork)

- `src/lib/canvas/geometry.ts` (pur) : `View`, `Rect`, `Port`, `screenToWorld`, `zoomAt`, `fitRects`, `boundsOf`, `portPoint`, `bezierPath`, `edgeLabelPoint`, simplification d'un trait à main levée.
- `src/lib/canvas/model.ts` (pur) : `CanvasNode {id, kind, x, y, w?, h?, data}`, `CanvasEdge {id, from:{node,port}, to:{node,port}, label?}`, `Annotation = sticky | text | shape | ink`, validation.
- `src/components/canvas/` : `Canvas.tsx` (vue, transformation, gestes, outil actif, fond), `NodeFrame.tsx`, `EdgeLayer.tsx`, `Toolbar.tsx`, `ZoomControls.tsx`, `Minimap.tsx`, `AnnotationLayer.tsx`, `CanvasSearch.tsx`, hooks `useCanvasView.ts` et `useDragNode.ts`.
- Inspiré du modèle déjà éprouvé de `TeamCanvas.tsx` (vue `{x,y,scale}` + transformation CSS, seuil de 5 px avant de capturer le pointeur) ; **ne modifie pas** les fichiers amont `TeamCanvas.tsx` / `team-canvas.ts`. Aucune nouvelle dépendance (pas de `@xyflow/react` pour l'instant ; format de données indépendant d'une bibliothèque).

### Carte des projets sur la toile

- `ProjectsPage.tsx` remplace sa boîte défilante + `zoom` CSS par `<Canvas>` ; `pos` garde le même sens (coordonnées du monde), `zoom` devient l'échelle initiale.
- `projectMapStateSchema` gagne `annotations: Annotation[]` (500 au plus, défaut `[]`) ; les anciens fichiers restent valides.
- Les résumés envoyés au Cartographe incluent le texte des notes (nettoyé, plafonné).
- Textes : « Projets » → « Atelier » dans la navigation et le titre (fr/en).

### Workflows

- `shared/workflows.ts` : types `Workflow {id, name, projectId?, nodes, edges, annotations, limits:{maxSteps, maxCostUsd}, rev}`, `WorkflowRun`, `StepRun`.
- `server/workflows/store.ts` : `workflows.json` dans le dossier de données (zod, version 1, `rev` + 409 comme la carte), 500 exécutions au plus.
- `server/workflows/graph.ts` (pur) : validation, pas de cycle, ports compatibles, ordre topologique, problèmes en clair.
- `server/workflows/steps.ts` : IA (appel `generateText` du moteur choisi, coût compté comme les tâches annexes), Bot (`store.createTask` + `startTurn(..., { automationSource, onSettled })`, réponse finale), Condition (appel IA, parse strict OUI/NON), Approbation (carte Oui/Non via le même service de demandes que les autres cartes, 24 h), Envoyer (notification existante / message).
- `server/workflows/runner.ts` : exécution une étape à la fois dans l'ordre topologique ; entrées = texte des fils entrants, présenté comme **données, pas consignes** ; branches non prises = « ignoré » ; annulation (signal + interruption du tour) ; une exécution coupée par un redémarrage = « échoué (redémarrage) ».
- `server/workflows/routes.ts` : liste/lecture/enregistrement, `POST /run`, `POST /run-step`, `POST /runs/:id/cancel`, réservés au propriétaire (hors `CLIENT_ALLOW`).
- Déclencheurs : nouvelle cible de routine `"workflow"` (+ `workflowId`) dans le moteur de routines existant, sur le modèle de la cible `room-goal` (`startGoal` / `finishGoalRun`) : planification, rattrapage, exécutions manquées et liste des exécutions sont réutilisés. Une version plus ancienne de l'appli qui lit une cible inconnue doit l'ignorer sans casser (test).
- Interface : `src/components/workflows/WorkflowEditor.tsx` sur la toile, chargé à la demande ; ouvert depuis la barre de gauche de l'Atelier ; les exécutions s'affichent aussi dans Automatisations.
- Cartographe : outil `workflows_propose` (même carte Autoriser/Refuser que la carte ; graphe validé par `graph.ts` avant la carte et avant l'enregistrement ; texte de la carte construit côté serveur).

### Sécurité et coûts

- Choix de l'utilisateur : les blocs Bot agissent au niveau d'accès de leur bot, sans demander. L'interface le dit en clair sur le workflow (« Les bots de ce workflow agissent sans te demander »), et propose le bloc Approbation.
- Le texte qui circule sur les fils peut contenir n'importe quoi (pages, e-mails) : il entre toujours dans le bloc suivant comme **données** (limite déjà posée par `automationSource`).
- Limites par exécution (étapes, coût) et budget global vérifiés avant chaque étape.

## Phases

1. **A1** Toile commune + carte des projets dessus + renommage « Atelier ».
2. **A2** Notes, textes, formes, crayon, recherche ; enregistrés dans la carte ; lus par le Cartographe.
3. **A3** Carte détaillée d'un projet sur la toile (lecture seule).
4. **B1** Éditeur de workflows (sans exécution) : blocs, réglages, validation, `workflows.json`, section Workflows.
5. **B2** Moteur : Lancer, Lancer cette étape, couleurs, historique, arrêt, limites.
6. **B3** Déclencheurs automatiques via les routines (planifié, limite d'IA) ; puis adresse web et événement d'appli.
7. **B4** Le Cartographe propose des workflows.

Chaque phase : tests d'abord, relecture par un agent séparé, puis fusion.

## Tests clés

- Géométrie : zoom autour d'un point, ajuster, courbes, ports, simplification de trait.
- Toile : gestes (seuil, main, molette, Ctrl+molette), outils, mini-carte, recherche.
- Carte : anciennes données valides ; notes enregistrées et plafonnées ; Cartographe voit les notes nettoyées.
- Graphe : cycles refusés, ports incompatibles, deux déclencheurs, note reliée, ordre topologique.
- Moteur : chaque bloc ; branche non prise ignorée ; échec → aval ignoré ; réessai ; arrêt ; limite d'étapes ; limite de coût (coût inconnu) ; redémarrage ; texte des fils traité comme données.
- Déclencheurs : cible `workflow` planifiée et rattrapée comme une routine ; cible inconnue ignorée sans casse.
- Cartographe : proposition invalide refusée sans carte ; Autoriser → créé ; Refuser → rien.

## Hors périmètre (version 1)

Boucles, blocs HTTP / code / délai, images et fichiers sur les fils, modèles prêts à l'emploi, versions restaurables, édition à plusieurs.
