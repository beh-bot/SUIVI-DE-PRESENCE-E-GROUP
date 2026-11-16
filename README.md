# Suivi de présence – Excellence Group

Application web de pointage pour un centre de soutien scolaire. Un encadreur fait l'appel de sa séance sur son téléphone ; chaque absence envoie un message WhatsApp au parent.

Elle tourne entièrement sur **Google Apps Script**, avec un classeur **Google Sheets** comme base de données. Il n'y a ni serveur, ni étape de build.

## Fonctionnalités

- **Administrateur** : gère les élèves, les séances, les comptes, consulte le tableau de bord, exporte en CSV et PDF.
- **Encadreur** : voit uniquement ses séances et y pointe « Présent » ou « Absent ».
- **WhatsApp** : un message par absence (API WhatsApp Business Cloud de Meta), journal des envois, renvoi des échecs.
- **Comptes** : créés par l'administrateur, ou par lien d'invitation à usage unique valable 7 jours.
- **Corbeille** : un élève ou une séance supprimés gardent leur historique et peuvent être rétablis.
- **Sauvegarde** : copie des données dans un autre classeur, à la demande ou chaque nuit sur sept jours.
- **Import** : une liste d'élèves se colle depuis un tableur ou se charge en CSV.
- **Journal** : connexions et modifications sont tracées (qui, quoi, quand) et consultables par l'administrateur.

## Fichiers

| Fichier | Rôle |
|---|---|
| `Code.gs` | Point d'entrée `doGet()` ; `?test=1` affiche un diagnostic du déploiement |
| `Index.html` | Tout l'écran : application monopage en JavaScript natif, CSS intégré |
| `Api.gs` | Fonctions appelées par l'écran : validation, élèves, séances, pointage, exports |
| `Auth.gs` | Mots de passe (PBKDF2), sessions (jeton valable 12 h, stocké sous forme d'empreinte), limite de tentatives |
| `Db.gs` | Lecture et écriture des feuilles, verrou, menu d'installation dans Sheets |
| `WhatsApp.gs` | Envoi du message d'absence et journal des notifications |
| `Sauvegarde.gs` | Copie des données dans un autre classeur, menu de sauvegarde |
| `appsscript.json` | Manifeste Apps Script : moteur V8, accès à l'application web |
| `tests/simulation.cjs` | Test du code serveur avec de faux services Google |
| `tests/apercu-local.cjs` | Aperçu de l'application dans le navigateur, sans Google |
| `DOCS/` | Explication de chaque modification, et audit de ce qu'il reste à faire |

Les feuilles du classeur servent de tables : `Utilisateurs`, `Eleves`, `Seances`, `Presences`, `Invitations`, `Notifications`, `Journal`. Un élève est rattaché à une séance par le texte de sa **classe**, qui doit être écrit exactement pareil des deux côtés.

## Installation

1. Créer un classeur Google Sheets, puis ouvrir **Extensions > Apps Script**.
2. Y créer les fichiers `Code`, `Auth`, `Db`, `Api`, `WhatsApp`, `Sauvegarde` (scripts) et `Index` (HTML), et y coller le contenu des fichiers du dépôt. Le dossier `tests/` ne se copie pas. Avec l'outil `clasp`, un `clasp push` remplace ce copier-coller : voir `DOCS/07-integration-continue-et-clasp.md`.
3. Recharger le classeur. Dans le menu **Suivi de présence**, lancer « 1) Initialiser les feuilles », puis « 2) Créer un administrateur ».
4. **Déployer > Nouveau déploiement > Application Web**, exécutée en tant que propriétaire. Le lien obtenu se termine par `/exec`.
5. Ouvrir ce lien et se connecter. Ajouter `?test=1` au lien permet de vérifier que le déploiement répond.
6. Dans le menu **Suivi de présence**, lancer « Activer la sauvegarde automatique ». La marche à suivre pour restaurer est dans `DOCS/08-corbeille-et-sauvegarde.md`.

Après une mise à jour du code, il faut créer une nouvelle version du déploiement, puis lancer « 3) Réparer les données » si l'écran affiche une erreur de données.

## Configuration WhatsApp

Les réglages se font dans **Paramètres du projet > Propriétés du script**, jamais dans le code.

| Propriété | Rôle | Valeur par défaut |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Identifiant du numéro d'envoi (obligatoire) | aucune |
| `WHATSAPP_ACCESS_TOKEN` | Jeton d'accès Meta (obligatoire) | aucune |
| `WHATSAPP_TEMPLATE_NAME` | Nom du modèle de message approuvé | `absence_eleve` |
| `WHATSAPP_TEMPLATE_LANG` | Langue du modèle | `fr` |
| `WHATSAPP_API_VERSION` | Version de l'API Graph | `v21.0` |
| `WHATSAPP_DRY_RUN` | `true` : simule l'envoi sans rien envoyer | désactivé |
| `WHATSAPP_ENABLED` | `false` : coupe les notifications | activé |

Le modèle reçoit quatre variables, dans cet ordre : nom de l'élève, matière, date, heure.

## Règles à respecter dans le code

- **Toute fonction interne doit se terminer par `_`.** Apps Script rend appelable depuis le navigateur, sans connexion, toute fonction dont le nom ne finit pas par `_`. Seules les fonctions appelées par l'écran (elles vérifient le jeton) et celles du menu Sheets restent sans `_`. Le test échoue si une fonction publique n'est pas utilisée par l'écran.
- **Chaque fonction publique vérifie les droits** avec `exigerConnexion_` ou `exigerAdmin_`. Masquer un bouton à l'écran ne protège rien.
- **Les écritures passent par `inserer_`, `mettreAJour_`, `supprimerLigne_`**, qui prennent le verrou. Une opération en plusieurs étapes s'entoure de `avecVerrou_`. Aucun appel réseau ne doit se faire sous verrou.
- **Toute donnée affichée passe par `esc()`** dans `Index.html`.
- **Le CSS est un Tailwind déjà compilé**, collé dans `Index.html` ; ses sources ne sont pas dans le dépôt. Une classe Tailwind qui n'y figure pas déjà n'aura aucun effet.

## Tests

```
npm test
```

Le test rejoue un scénario complet (comptes, invitation, pointage, exports, suppressions) contre des imitations en mémoire des services Google. Il attrape les erreurs de logique, mais ne remplace pas un essai dans le vrai déploiement. GitHub le lance automatiquement à chaque envoi de code et sur chaque pull request.

## Aperçu local

```
node tests/apercu-local.cjs
```

Ouvre l'application sur http://localhost:8765 avec des données de démonstration, sans déploiement. Les comptes et les différences avec la vraie application sont décrits dans `DOCS/06-apercu-local.md`.

## Limites connues

- Chaque requête relit les feuilles concernées en entier : l'application convient à un centre, pas à des dizaines de milliers de pointages.
- Les listes de séances et de messages sont limitées aux 200 plus récentes.
- Les sauvegardes sont sur le même compte Google que le classeur : elles protègent d'une erreur, pas de la perte du compte.
- Un « Absent » envoie le message tout de suite ; un pointage fait par erreur ne peut pas être rattrapé auprès du parent.
- « Envoyé » signifie accepté par Meta, pas remis au parent.
- Toute personne ayant accès au classeur voit toutes les données : ne le partager qu'avec l'administrateur.
- Le manifeste `appsscript.json` du dépôt a été déduit du code : il faut le comparer à celui de la production avant le premier `clasp push` vers elle.
