# 01 – Fonctions serveur appelables sans connexion

C'était la faille la plus grave du projet : n'importe qui ayant le lien de l'application pouvait devenir administrateur et lire le jeton WhatsApp.

## Le problème

Dans Apps Script, l'écran appelle le serveur avec `google.script.run.nomDeLaFonction(...)`. La règle de Google est la suivante : **toute fonction déclarée au premier niveau d'un fichier `.gs` est appelable ainsi, sauf si son nom se termine par `_`.**

Le code vérifiait bien les droits dans les fonctions prévues pour l'écran (`listerEleves`, `creerSeance`…), avec `exigerConnexion` ou `exigerAdmin`. Mais les fonctions internes, celles qui font le vrai travail, n'avaient aucune vérification, puisqu'elles n'étaient pas censées être appelées de l'extérieur. Or elles l'étaient.

Exemples de ce qu'un visiteur non connecté pouvait taper dans la console de son navigateur :

```js
// Créer un compte administrateur
google.script.run.creerCompteInterne('Pirate', 'pirate', 'motdepasse', 'admin');

// Lire le jeton d'accès WhatsApp Business
google.script.run.withSuccessHandler(console.log).configWhatsApp();

// Lire toute la feuille des utilisateurs (hashs des mots de passe compris)
google.script.run.withSuccessHandler(console.log).versObjets({ nom: 'Utilisateurs' });

// Fabriquer une session valide pour n'importe quel compte
google.script.run.withSuccessHandler(console.log).creerSession({ id: 'identifiant-d-un-admin' });
```

Cette faille a été trouvée en lisant le code et la documentation de Google. Elle n'a pas été essayée contre le déploiement en production.

## La cause

Ce n'est pas une erreur de logique, c'est une particularité d'Apps Script qu'il faut connaître. Sur un serveur classique, une fonction n'est accessible de l'extérieur que si on lui crée une route. Ici c'est l'inverse : tout est accessible par défaut, et il faut marquer ce qui est privé.

## La solution

Toutes les fonctions internes ont reçu le suffixe `_` : `versObjets` est devenue `versObjets_`, `creerSession` est devenue `creerSession_`, et ainsi de suite pour 55 fonctions. Leur comportement n'a pas changé, seul leur nom a changé, partout où elles sont appelées.

Il reste 36 fonctions sans `_`, de trois sortes :

- **Les fonctions de l'écran** (`connexion`, `listerEleves`, `pointerEleve`…). Chacune commence par vérifier le jeton, sauf celles qui servent avant la connexion (`connexion`, `infoInvitation`, `accepterInvitation`, `urlApplication`).
- **Les fonctions du menu Google Sheets** (`initialiserFeuilles`, `creerAdministrateurDepuisMenu`, `reparerDonnees`). Elles commencent par `SpreadsheetApp.getUi()`, qui échoue quand on n'est pas dans Google Sheets : depuis l'application web, elles s'arrêtent donc tout de suite.
- **Les fonctions réservées par Google** : `doGet` et `onOpen`.

Deux changements annexes dans le même commit :

- `initialiserFeuilles` appelle `getUi()` en premier (avant, elle modifiait le classeur avant d'échouer).
- `setXFrameOptionsMode(ALLOWALL)` est retiré de `doGet`. Cette option autorisait n'importe quel site à afficher l'application dans un cadre invisible pour piéger les clics d'un utilisateur connecté (clickjacking). Rien ne la justifiait.

## La règle à retenir

**Toute nouvelle fonction interne doit se terminer par `_`.** Une fonction sans `_` doit être appelée par l'écran et vérifier les droits elle-même.

Un test protège cette règle : `tests/simulation.cjs` échoue si une fonction sans `_` n'est appelée nulle part dans `Index.html`.

## Ce qu'il reste à faire en production

La faille a été ouverte depuis la mise en ligne, et il n'y a aucun moyen de savoir si quelqu'un s'en est servi. Après le déploiement du code corrigé :

1. Régénérer le jeton WhatsApp chez Meta et remplacer `WHATSAPP_ACCESS_TOKEN`.
2. Relire la feuille `Utilisateurs` et supprimer tout compte inconnu.
3. Demander à tous les comptes de changer de mot de passe.

## Questions possibles du jury

- **Pourquoi vos vérifications de droits ne suffisaient-elles pas ?** Elles protégeaient les fonctions prévues pour l'écran, mais les fonctions internes qu'elles appellent étaient elles aussi exposées, sans vérification.
- **Comment garantissez-vous que cela ne revienne pas ?** Par une convention de nommage, rappelée en tête de `Api.gs`, et par un test automatique.
- **Masquer un bouton à l'écran protège-t-il une action ?** Non. L'écran tourne chez l'utilisateur, qui peut appeler le serveur directement. Seul le contrôle côté serveur compte.
- **Quelle autre architecture aurait évité ce risque ?** Une seule fonction publique qui reçoit le nom de l'action et ne l'exécute que si elle figure dans une liste autorisée.
