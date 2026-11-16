# 12 – Guide de test : vérifier soi-même tout le travail

Ce guide permet de tester, de bout en bout, tout ce que décrivent les fiches 01 à 11. Il est fait pour être suivi dans l'ordre, case par case.

**Pourquoi ce test est indispensable.** Aucune de ces modifications n'a encore tourné chez Google, et aucun écran n'a été regardé par la personne qui les a écrites. Les 32 tests automatiques vérifient la logique du serveur sur un ordinateur, avec de faux services Google. Ils ne prouvent ni que l'application fonctionne dans Apps Script, ni que les écrans sont corrects. Ce guide est là pour le vérifier.

**Règle absolue : ne jamais tester sur la production.** Tout se fait dans une copie de test, avec un classeur neuf. Le classeur et le déploiement réels ne sont pas touchés.

Comptez environ deux heures pour l'ensemble. Les parties A et B prennent quinze minutes et donnent déjà une première idée.

## Comment noter un problème

Pour chaque étape qui ne donne pas le résultat attendu, notez :

1. le numéro de l'étape (par exemple « D4 ») ;
2. ce que vous avez fait, et ce qui s'est affiché à la place ;
3. le message d'erreur exact, ou une capture d'écran ;
4. dans l'éditeur Apps Script, menu **Exécutions** : la ligne en erreur et son détail.

Ne corrigez rien au passage. Finissez la partie en cours, puis transmettez la liste.

## Partie A – Sur votre ordinateur, sans Google (5 minutes)

Il faut Node.js version 22 ou plus récente, et le dépôt à jour sur la branche `develop`.

```
git fetch origin
git checkout develop
git pull
npm test
```

- [ ] **A1.** La dernière ligne affichée est `34 tests réussis.` et le mot `ÉCHEC` n'apparaît nulle part.
- [ ] **A2.** Sur GitHub, onglet **Actions** du dépôt : la dernière exécution de `develop` a une coche verte.

Si A1 échoue, inutile d'aller plus loin : transmettez l'affichage complet.

## Partie B – Les écrans, dans l'aperçu local (10 minutes)

```
npm run apercu
```

Ouvrez http://localhost:8765 dans un navigateur. Les données sont fictives et disparaissent à l'arrêt (Ctrl+C dans le terminal). Aucun message WhatsApp ne part.

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Administrateur | `admin` | `demo-admin-1` |
| Encadreur | `kone.adama` | `demo-encadreur-1` |

- [ ] **B1.** Connecté en `admin`, parcourez les cinq pages du menu : Accueil, Séances, Élèves, Encadreurs, Messages. Aucune page blanche, aucun message d'erreur rouge.
- [ ] **B2.** Réduisez la fenêtre à la largeur d'un téléphone. Le menu passe en bas de l'écran et tout reste lisible.
- [ ] **B3.** Connecté en `kone.adama`, seule la page « Mes séances » est accessible.

L'aperçu sert à regarder les écrans rapidement. Il ne remplace pas la suite : les PDF y sont factices et rien n'y est lent, contrairement à Google.

## Partie C – Installer une copie de test dans Google (25 minutes)

Utilisez de préférence un compte Google différent de celui de la production.

### C-1. Créer le projet

1. Sur sheets.google.com, créez un classeur vide. Nommez-le « Suivi de présence – TEST ».
2. Menu **Extensions > Apps Script**. Nommez le projet « Suivi de présence – TEST ».
3. Dans **Paramètres du projet** (roue dentée), cochez « Afficher le fichier manifeste "appsscript.json" dans l'éditeur ».
4. Créez les fichiers suivants et collez-y le contenu des fichiers de la branche `develop`, en remplaçant tout ce qui s'y trouve :

| Fichier dans l'éditeur | Type | Fichier du dépôt |
|---|---|---|
| `Code` | Script | `Code.gs` |
| `Auth` | Script | `Auth.gs` |
| `Db` | Script | `Db.gs` |
| `Api` | Script | `Api.gs` |
| `WhatsApp` | Script | `WhatsApp.gs` |
| `Sauvegarde` | Script | `Sauvegarde.gs` |
| `Index` | HTML | `Index.html` |
| `appsscript.json` | (déjà présent) | `appsscript.json` |

5. Enregistrez (Ctrl+S). Aucune erreur de syntaxe ne doit être signalée.

Le dossier `tests/` et le dossier `DOCS/` ne se copient pas. La fiche 07 décrit l'outil `clasp`, qui remplace ce copier-coller par une commande.

### C-2. Initialiser

Rechargez l'onglet du classeur. Un menu **Suivi de présence** apparaît après quelques secondes.

- [ ] **C1.** Le menu contient six entrées : les trois numérotées, puis « Sauvegarder maintenant », « Activer la sauvegarde automatique (chaque nuit) », « Désactiver la sauvegarde automatique ».
- [ ] **C2.** « 1) Initialiser les feuilles » : Google demande une autorisation, à accepter. Relancez l'entrée si besoin. Un message « Feuilles prêtes » s'affiche.
- [ ] **C3.** Le classeur contient sept feuilles : `Utilisateurs`, `Eleves`, `Seances`, `Presences`, `Invitations`, `Journal`, `Notifications`. La feuille vide du départ a disparu.
- [ ] **C4.** « 2) Créer un administrateur » : créez un compte (par exemple `test.admin`). Un message confirme la création.
- [ ] **C5.** Dans la feuille `Utilisateurs`, la colonne `mdp_hash` de ce compte commence par `pbkdf2$2000$`.

### C-3. Couper WhatsApp et déployer

1. **Paramètres du projet > Propriétés du script** : ajoutez `WHATSAPP_DRY_RUN` avec la valeur `true`. Aucun message réel ne partira.
2. **Déployer > Nouveau déploiement**, type **Application Web**, exécutée en tant que **Moi**, accès **Tout le monde**. Copiez le lien, qui se termine par `/exec`.

- [ ] **C6.** Le lien suivi de `?test=1` affiche une page de diagnostic, sans erreur.
- [ ] **C7.** Le lien seul affiche l'écran de connexion.

À chaque modification du code par la suite, il faut faire **Déployer > Gérer les déploiements > Modifier > Nouvelle version**, sinon le lien `/exec` continue de servir l'ancien code.

## Partie D – Sécurité et connexion (20 minutes)

### Fonctions internes (fiche 01)

Ouvrez l'application, puis les outils de développement du navigateur (F12), onglet **Console**. En haut de la console, une liste déroulante indique « top » : choisissez-y le cadre nommé `userHtmlFrame`. Sans cela, `google` n'est pas défini.

- [ ] **D1.** Sans être connecté, tapez `google.script.run.configWhatsApp_()`. Le navigateur répond que ce n'est pas une fonction.
- [ ] **D2.** Même résultat pour `google.script.run.configWhatsApp()`, `google.script.run.creerCompteInterne_('X','x','motdepasse','admin')` et `google.script.run.versObjets_({nom:'Utilisateurs'})`.
- [ ] **D3.** `google.script.run.withFailureHandler(console.log).initialiserFeuilles()` affiche une erreur, et le classeur n'est pas modifié.
- [ ] **D4.** `google.script.run.withFailureHandler(console.log).listerEleves('faux')` affiche une erreur `SESSION_EXPIREE`.

C'est le test le plus important de tout le guide : il confirme que la faille principale est fermée dans le vrai Apps Script.

### Connexion (fiches 02 et 10)

- [ ] **D5.** Connectez-vous en administrateur en chronométrant. Notez la durée entre le clic et l'affichage : ______ secondes.
- [ ] **D6.** Déconnectez-vous. Chronométrez une connexion avec un identifiant qui n'existe pas : ______ secondes. La durée doit être proche de celle d'un mot de passe faux sur un vrai identifiant : ______ secondes.
- [ ] **D7.** Faites cinq essais avec un mot de passe faux sur votre identifiant. Le sixième essai, même avec le bon mot de passe, répond « Trop de tentatives ». Attendez 15 minutes, ou poursuivez avec un second administrateur créé par le menu.

Si la connexion de D5 dépasse 3 secondes, notez-le : il faudra baisser `ITERATIONS_MDP` dans `Auth.gs`.

- [ ] **D8.** Une fois connecté, ouvrez **Paramètres du projet > Propriétés du script**. Une propriété `session_…` existe, suivie de 64 caractères. Ce n'est pas le jeton : dans le navigateur, F12 > **Application > Stockage local**, la valeur de `sp_jeton` est différente.

## Partie E – Comptes (15 minutes)

- [ ] **E1.** Page Encadreurs, « Créer un compte » : créez un encadreur avec un mot de passe. Une fenêtre affiche les identifiants à transmettre.
- [ ] **E2.** Dans une fenêtre de navigation privée, connectez-vous avec ce compte. Une fenêtre « Choisissez votre mot de passe » s'ouvre. Ni la touche Échap ni un clic à côté ne la ferment.
- [ ] **E3.** Rechargez la page : la fenêtre revient. Changez le mot de passe : l'application s'ouvre sur « Mes séances ».
- [ ] **E4.** Côté administrateur, « Inviter par lien » : créez une invitation, copiez le lien, ouvrez-le en navigation privée. Créez le compte : il entre directement, sans obligation de changer de mot de passe.
- [ ] **E5.** Rouvrez le même lien d'invitation : il est refusé.
- [ ] **E6.** Supprimez le compte créé en E1 pendant qu'il est connecté dans l'autre fenêtre. Sa prochaine action le renvoie à l'écran de connexion.

## Partie F – Élèves et classes (20 minutes)

- [ ] **F1.** « Ajouter un élève » : créez un élève en classe `3e A`, avec un numéro au format `+2250700000001`.
- [ ] **F2.** Un numéro sans indicatif (`0700000001`) est refusé avec un message clair.
- [ ] **F3.** Créez un second élève en saisissant la classe `3ea`. Il apparaît dans la classe `3e A`, et non dans une nouvelle classe.
- [ ] **F4.** « Importer une liste » : collez ces lignes, puis « Vérifier la liste ».

```
Konan;Akissi;6e B;Mme Konan;+2250700000101
Touré;Ali;6e B;M. Touré;+2250700000102
Bah;Awa;6e B;Mme Bah;0700
```

L'import est refusé, et le message désigne la ligne 3. Aucun élève n'est ajouté.

- [ ] **F5.** Corrigez le dernier numéro en `+2250700000103` et recommencez. Un bilan annonce 3 élèves en `6e B`. Confirmez : ils apparaissent dans la liste.
- [ ] **F6.** Réimportez exactement la même liste : le message indique que tous sont déjà enregistrés.
- [ ] **F7.** Copiez quelques lignes depuis un vrai fichier Excel ou Google Sheets (cinq colonnes) et collez-les. L'import fonctionne aussi.
- [ ] **F8.** Dans la feuille `Eleves` du classeur, les numéros commencent bien par `+` et n'ont pas été transformés en nombres.
- [ ] **F9.** « Renommer la classe » sur `6e B` : renommez-la en `6e Bleue`. Les trois élèves suivent.

## Partie G – Séances et appel (25 minutes)

- [ ] **G1.** « Créer une séance » pour la classe `6e Bleue`, attribuée à un encadreur, à la date du jour.
- [ ] **G2.** Ouvrez la séance, « Modifier la séance » : changez l'heure et la matière. La page affiche les nouvelles valeurs.
- [ ] **G3.** Marquez un élève « Absent ». La ligne indique « Le parent sera prévenu quand vous terminerez l'appel ». Notez la durée du clic : ______ secondes. Page Messages : aucun message n'est encore apparu.
- [ ] **G4.** Saisissez un motif pour cet absent. Rechargez la page : l'heure « Pointé à » n'a pas changé.
- [ ] **G5.** Cliquez « Marquer les 2 autres élèves présents » et confirmez. Les deux autres passent à « Présent », l'absent reste absent, et le bouton disparaît.
- [ ] **G5 bis.** Un encadré indique « 1 parent n'a pas encore été prévenu ». Revenez à la page Séances : la séance porte la mention « 1 parent à prévenir ». Sur l'Accueil, un bandeau signale une séance avec des absences non signalées.
- [ ] **G5 ter.** Dans la séance, cliquez « Terminer l'appel et prévenir 1 parent ». Une confirmation rappelle qu'un message envoyé ne peut pas être rappelé. Confirmez : la ligne de l'absent indique « Message envoyé », et la page affiche « Appel terminé le … ».
- [ ] **G5 quater.** Marquez un présent « Absent » après coup : rien ne part, et un bouton « Prévenir 1 parent » apparaît. Cliquez-le : un seul nouveau message part, le premier n'est pas renvoyé.
- [ ] **G6.** « Modifier la séance » et changez la classe : c'est refusé, avec un message expliquant que l'appel a commencé.
- [ ] **G7.** « Exporter en PDF » : un vrai fichier PDF se télécharge, lisible, avec les trois élèves, leurs statuts et les heures.
- [ ] **G8.** « Exporter en CSV » : le fichier s'ouvre dans un tableur, accents corrects.
- [ ] **G9.** Connecté en encadreur, une séance attribuée à quelqu'un d'autre n'apparaît pas. Si vous tapez son adresse à la main, l'accès est refusé.
- [ ] **G10.** Page Accueil : les taux de présence et l'élève le plus absent correspondent à ce que vous venez de saisir.
- [ ] **G11.** Page Messages : les deux messages de G5 figurent dans l'onglet « Envoyés », un par élève.
- [ ] **G12.** Dans la feuille `Seances`, la date et l'heure sont restées du texte (`2026-11-16`, `08:30`) et n'ont pas été transformées.

## Partie H – Deux personnes en même temps (15 minutes)

Ce test ne peut pas être fait par les tests automatiques. Il faut deux appareils, ou deux navigateurs, connectés à deux comptes.

- [ ] **H1.** Créez une séance pour une classe d'au moins dix élèves. Ouvrez-la sur les deux appareils (un administrateur et l'encadreur de la séance).
- [ ] **H2.** Pointez en même temps, aussi vite que possible, des élèves différents sur chaque appareil. Aucune erreur ne s'affiche.
- [ ] **H3.** Rechargez la page : chaque élève a un seul statut, et aucun pointage n'a disparu.
- [ ] **H4.** Dans la feuille `Presences`, il y a exactement une ligne par élève pointé pour cette séance.
- [ ] **H5.** Pendant qu'un appareil importe une liste d'élèves, l'autre pointe. Les deux opérations aboutissent.

Si un message « L'application est très sollicitée » apparaît, notez dans quelle situation.

## Partie I – Corbeille et sauvegarde (20 minutes)

- [ ] **I1.** Supprimez un élève qui a été pointé. Il disparaît de la page Élèves. Le message de confirmation parle de corbeille, pas de suppression définitive.
- [ ] **I2.** Rouvrez la séance de la partie G : l'élève y figure toujours, avec son statut.
- [ ] **I3.** Créez une nouvelle séance pour la même classe : l'élève n'y est pas attendu.
- [ ] **I4.** En bas de la page Élèves, lien « Corbeille » : l'élève y est, avec le nombre de pointages conservés. « Rétablir » le fait revenir partout.
- [ ] **I5.** Supprimez une séance : elle part dans la corbeille, et les chiffres de l'Accueil baissent. Rétablissez-la : ils reviennent.
- [ ] **I6.** Menu du classeur, « Sauvegarder maintenant » : après une nouvelle autorisation Google, un message donne le nom et l'adresse d'un nouveau classeur.
- [ ] **I7.** Ouvrez ce classeur : il contient les sept feuilles, avec les mêmes lignes que l'original.
- [ ] **I8.** « Activer la sauvegarde automatique ». Dans l'éditeur Apps Script, menu **Déclencheurs** : un déclencheur quotidien sur `sauvegardeAutomatique` est présent. Un seul, même après deux activations.
- [ ] **I9.** Dans l'éditeur, ouvrez `Sauvegarde`, choisissez la fonction `sauvegardeAutomatique` et cliquez **Exécuter**. Un classeur « Sauvegarde … – (jour de la semaine) » apparaît dans Google Drive.
- [ ] **I10.** Le lendemain : menu **Exécutions**, une exécution de `sauvegardeAutomatique` a eu lieu dans la nuit, sans erreur.
- [ ] **I11.** Essai de restauration, en suivant la fiche 08 : supprimez à la main quelques lignes de la feuille `Eleves`, puis restaurez la feuille depuis la sauvegarde. Les élèves reviennent dans l'application.
- [ ] **I12.** Depuis la corbeille, « Supprimer définitivement » un élève : il disparaît de la corbeille, et ses lignes des feuilles `Eleves` et `Presences` aussi.

## Partie J – Journal et listes (10 minutes)

- [ ] **J1.** Page Encadreurs, lien « Journal des actions » : les opérations des parties E à I y figurent, de la plus récente à la plus ancienne, avec leur auteur.
- [ ] **J2.** La feuille `Journal` contient les mêmes lignes. Aucun mot de passe ni numéro de téléphone n'y apparaît.
- [ ] **J3.** Une tentative de connexion ratée n'ajoute pas de ligne au journal.
- [ ] **J4.** Facultatif : collez plus de 200 lignes dans la feuille `Seances` (en recopiant une ligne existante avec des identifiants différents). La page Séances en affiche 200, puis le bouton « Afficher les plus anciennes » en ajoute.

## Partie K – Mise à jour d'un classeur existant (20 minutes)

Cette partie vérifie que la production pourra être mise à jour sans perte. Elle se fait sur une copie, jamais sur l'original.

1. Dans Google Drive, faites une copie du classeur de production (**Fichier > Créer une copie**). Le projet Apps Script est copié avec lui, avec l'ancien code.
2. Dans le projet de cette copie, remplacez tous les fichiers par ceux de `develop`, comme en C-1, en ajoutant `Sauvegarde`.
3. Ajoutez la propriété `WHATSAPP_DRY_RUN` = `true`. **C'est indispensable : cette copie contient les vrais numéros des parents.**
4. Rechargez le classeur copié, puis lancez « 1) Initialiser les feuilles » et « 3) Réparer les données ». **Faites-le avant tout déploiement :** c'est cette étape qui rattache le projet à la copie. Si la propriété `CLASSEUR_ID` a été recopiée avec le projet, elle désigne encore le classeur de production tant que l'initialisation n'a pas été relancée.
5. Dans **Propriétés du script**, vérifiez que `CLASSEUR_ID` est bien l'identifiant de la copie (il figure dans son adresse), et pas celui de la production.
6. Déployez comme en C-3.

- [ ] **K1.** Un compte existant se connecte avec son mot de passe habituel.
- [ ] **K2.** Après cette connexion, sa colonne `mdp_hash` commence par `pbkdf2$`.
- [ ] **K3.** Les élèves, les séances et les anciens pointages s'affichent comme avant.
- [ ] **K4.** Les feuilles `Eleves` et `Seances` ont reçu une colonne `supprime_le`, `Seances` une colonne `cloture_le`, et `Utilisateurs` une colonne `mdp_a_changer`, toutes vides.
- [ ] **K4 bis.** Aucune ancienne séance ne porte la mention « parents à prévenir » : les absences déjà signalées avant la mise à jour ne sont pas renvoyées.
- [ ] **K5.** Une feuille `Journal` existe et se remplit.
- [ ] **K6.** Aucun compte existant n'est forcé de changer son mot de passe.

Supprimez cette copie une fois le test terminé : elle contient des données personnelles.

## Ce que ce guide ne vérifie pas

- **L'envoi réel d'un message WhatsApp.** Tout est en simulation. Un essai réel demande le jeton Meta et un modèle de message approuvé. Faites-le en dernier, vers votre propre numéro, en créant un élève dont vous êtes le parent.
- **La charge.** Dix encadreurs en même temps en début d'heure ne sont pas reproduits par deux appareils.
- **La durée.** Le comportement après plusieurs mois de données n'est pas testé.

## Avant de mettre en production

Ne passez à la production que si toutes les cases des parties A à K sont cochées, ou si chaque case non cochée a été comprise et corrigée. Ensuite, dans cet ordre :

1. Faites **Fichier > Créer une copie** du classeur de production et gardez-la. L'ancienne version n'a pas encore le menu de sauvegarde.
2. Remplacez le code, lancez « 1) Initialiser les feuilles » puis « 3) Réparer les données ».
3. Créez une nouvelle version du déploiement existant, pour garder le même lien.
4. Prévenez les utilisateurs qu'ils devront se reconnecter une fois.
5. Régénérez le jeton WhatsApp chez Meta, relisez la feuille `Utilisateurs` et faites changer tous les mots de passe (fiche 01).
6. Activez la sauvegarde automatique.

## Questions possibles du jury

- **Comment avez-vous validé votre application ?** Par des tests automatiques de la logique, puis par une recette manuelle suivant un cahier de tests écrit, dans un environnement séparé de la production.
- **Qu'est-ce qu'une recette ?** La vérification, par quelqu'un qui n'a pas écrit le code, que le logiciel fait ce qui est attendu, à partir de scénarios et de résultats attendus décrits à l'avance.
- **Pourquoi un environnement de test séparé ?** Pour pouvoir échouer sans conséquence : ni perte de données réelles, ni message envoyé par erreur à un parent.
- **Que ne couvrent pas vos tests automatiques ?** Les comportements propres à Google Sheets, la concurrence réelle, les performances et les écrans. C'est précisément ce que ce guide fait vérifier à la main.
- **Comment testez-vous une migration ?** Sur une copie des données réelles, en vérifiant que rien n'est perdu et que les anciens comptes fonctionnent toujours.
