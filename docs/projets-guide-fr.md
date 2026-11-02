# MausBot et l'onglet Projets : le guide

Ce guide explique, pas à pas, comment installer MausBot sur un ordinateur Windows, y mettre tes projets, lire leur carte et demander de l'aide au Cartographe.

## 1. Installer MausBot

1. Télécharge le fichier **OpenMausBot.bat** : ouvre la page
   https://github.com/Monkey4lt/OpenMausBot/blob/main/scripts/windows/OpenMausBot.bat
   puis clique sur le bouton de téléchargement (la flèche vers le bas, en haut à droite du texte).
2. Range ce fichier sur ton Bureau, pour le retrouver facilement.
3. Double-clique dessus.
   - Si Windows affiche « Windows a protégé votre ordinateur », clique sur **Informations complémentaires**, puis sur **Exécuter quand même**.
   - Si Windows demande l'autorisation d'installer quelque chose, clique sur **Oui**.
4. Une fenêtre noire s'ouvre et fait tout toute seule. La première fois, cela peut prendre une dizaine de minutes. Ne la ferme pas.
5. À la fin, deux petites fenêtres « MausBot - Serveur » et « MausBot - Interface » s'ouvrent : laisse-les ouvertes, ce sont les moteurs de MausBot. Puis la fenêtre MausBot s'ouvre.

Bon à savoir :

- Si une ancienne MausBot est déjà ouverte, le fichier te le dit et te propose de la fermer : tape **O** pour oui. Tes conversations ne sont pas perdues.
- Si quelque chose ne marche pas, la fenêtre noire écrit ce qu'il faut faire, en français. Si le problème revient, fais une capture de la fenêtre et envoie-la à Claude.
- MausBot s'installe dans le dossier **Documents\OpenMausBot**. Ne modifie rien dedans.
- Pour arrêter MausBot, ferme sa fenêtre. Si son icône reste près de l'horloge, fais un clic droit dessus, puis **Quit OpenMaus Bot**.

## 2. Ajouter tes projets

Dans MausBot, clique sur **Projets**, en bas de la colonne de gauche. Si tu ne le vois pas, clique sur ton nom ou ta photo, en bas à gauche : **Projets** est dans ce menu. La première fois, l'écran affiche « Aucun projet pour l'instant » : clique sur **Ajouter un dossier**. Plus tard, le même réglage s'ouvre avec le bouton **Dossiers**, en haut.

La fenêtre « Où sont tes projets ? » a trois onglets. Chaque dossier à l'intérieur de ce que tu ajoutes devient un bloc sur la carte.

- **Cet ordinateur** : écris le chemin du dossier qui contient tes projets, par exemple `C:\Users\toi\Documents\projets`. Clique sur **Ajouter un dossier**, puis sur **Enregistrer**.
- **Serveur SSH** : écris `utilisateur@serveur` (ou le petit nom du serveur), puis le chemin du dossier, par exemple `~/projets`. Clique sur **Ajouter un dossier**, puis sur **Enregistrer**. Cela marche seulement si ton ordinateur se connecte déjà à ce serveur sans demander de mot de passe.
- **GitHub** :
  - Pour voir aussi tes dépôts privés, clique sur **Se connecter à GitHub**. Une fenêtre GitHub s'ouvre : connecte-toi dedans, puis reviens dans MausBot. Quand il est écrit « Connecté à GitHub en tant que … », clique sur **Afficher tous mes dépôts**.
  - Sans te connecter, seuls les dépôts publics sont visibles : écris un nom de compte ou un dépôt (par exemple `monpseudo` ou `monpseudo/mon-depot`), clique sur **Ajouter un dossier**, puis sur **Enregistrer**.
  - Pour changer de compte GitHub, clique sur **Changer de compte**.

Si un dossier a changé, clique sur **Relire les dossiers** (la flèche ronde, en haut).

## 3. Lire la carte

**La carte de tous tes projets**

- Chaque **bloc** est un projet. Clique sur ses dossiers pour voir ce qu'il y a dedans.
- Les **pôles** rangent les projets du même domaine (par exemple « Clients », « Perso »). Crée un pôle avec le **+** à côté de « Pôles », à gauche, puis clique sur **Choisir un pôle** dans un bloc.
- Pour **relier** deux projets, clique sur l'icône lien d'un bloc, puis sur celle d'un autre. Tu peux donner un nom au lien, par exemple « utilise ».
- Déplace les blocs en les attrapant par le haut. **Ranger** les remet en ordre, **Tout afficher** montre toute la carte. Tout s'enregistre tout seul.
- Le bouton **Aide** (le point d'interrogation) rappelle tout cela.

**La carte d'un projet**

Clique sur l'icône réseau d'un bloc (« Ouvrir la carte de … ») pour voir l'intérieur du projet. **Retour aux projets** te ramène à la grande carte.

- **En bref** : une courte fiche qui dit à quoi sert le projet. Si elle est vide, clique sur **Demander au Cartographe une fiche En bref**.
- **Les familles** : les fichiers sont groupés par sorte, chacune avec sa couleur : Interface, Serveur, Données, Tests, Documentation, Traductions, Configuration, Scripts, Ressources, Autre.
- **Les pièces du projet** : les grands morceaux du projet. Clique sur une pièce pour voir d'où elle vient. **Liens entre pièces** montre qui travaille avec qui.
- Clique sur un fichier pour voir ce qu'il **utilise** et qui l'**utilise**.

## 4. Parler au Cartographe

Le Cartographe est un assistant qui range tes cartes pour toi. Il ne touche jamais aux fichiers de tes projets.

1. Clique sur **Demander au Cartographe**, en haut à droite. Sa discussion s'ouvre dans un panneau à droite, avec une phrase déjà prête, par exemple « Range mes projets et propose-moi les changements. » Envoie-la, ou écris ta propre demande.
2. Il te répond, puis te montre une demande, par exemple « Appliquer ces 3 changements à la carte ? », avec la liste complète des changements.
3. Clique sur **Autoriser une fois** pour appliquer toute la liste, ou sur **Refuser** pour ne rien changer. Tant que tu n'as pas cliqué, rien ne change.
4. **Ouvrir dans la discussion** ouvre la conversation en grand. **Fermer** cache le panneau.

À savoir : pour travailler, les noms de tes projets et de tes fichiers, et parfois le contenu de certains fichiers, sont envoyés à l'IA utilisée par MausBot. Il ne lit jamais les clés ni les mots de passe.

## 5. Mettre à jour MausBot

Double-clique à nouveau sur **OpenMausBot.bat**. Il ferme MausBot si elle est ouverte, télécharge la nouvelle version, puis la rouvre. Tes projets, tes cartes et tes conversations restent.

Sans Internet, il ouvre simplement la version déjà installée.

---

## Pour la personne qui maintient

Le fork part de `lonelyRaph/OpenMausBot` (`main`, commit `2535665`), lui-même copie de `milind-soni/OpenMausBot`. Les ajouts vivent surtout dans des fichiers neufs (`server/projects*.ts`, `server/cartographe-*.ts`, `server/routes/{projects,cartographe}.ts`, `server/drivers/agents-cartographe-tools.ts`, `src/components/ProjectsPage.tsx`, `src/components/projects/`, `src/lib/projects-*.ts`). Les fichiers amont modifiés le sont par de courts branchements ; le dossier `enterprise/` est supprimé (voir `NOTICE`). Pour les lister :

```sh
git diff --stat --diff-filter=M upstream/main...HEAD
```

Mettre à jour depuis l'amont :

```sh
git remote add upstream https://github.com/milind-soni/OpenMausBot.git   # une seule fois (ou lonelyRaph/OpenMausBot)
git fetch upstream
git switch main && git pull
git switch -c maj-amont
git merge upstream/main
```

Conflits attendus :

- `server/drivers/agents-bridge-wire.test.ts` (tailles de `BUDGET_BASELINE`) : garder les nombres de l'amont et la ligne `"default+cartographe"`. Puis lancer `agents-catalog-wire.test.ts` et `agents-bridge-wire.test.ts` avec `UPDATE_AGENTS_CATALOG_GOLDENS=1`, relire le diff des goldens, et ajuster le nombre de `"default+cartographe"` à la main.
- Un fichier de `enterprise/` modifié par l'amont : `git rm -r enterprise`.

Puis vérifier et publier :

```sh
pnpm install
node scripts/generate-locale.mjs --check
pnpm typecheck && pnpm lint && pnpm test
git switch main && git merge --ff-only maj-amont && git push origin main
```

Les utilisateurs n'ont plus qu'à relancer `OpenMausBot.bat`. Garder `scripts/windows/OpenMausBot.bat` en fins de ligne CRLF (voir `scripts/windows/.gitattributes`).
