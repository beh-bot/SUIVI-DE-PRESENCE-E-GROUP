# 05 – Tests du serveur sans Google

Le projet n'avait aucun test. Le code serveur ne peut pas s'exécuter hors de Google, ce qui semblait rendre les tests impossibles. Cette tâche montre comment les rendre possibles.

## Le problème

Les fichiers `.gs` appellent des objets qui n'existent que dans Apps Script : `SpreadsheetApp`, `PropertiesService`, `LockService`, `Utilities`… Les lancer sur un ordinateur échoue à la première ligne qui s'en sert. La seule vérification possible était donc de déployer et de cliquer à la main.

## La solution : de faux services

Le code serveur n'utilise qu'une petite partie de ces objets. `tests/faux-google.cjs` en fournit des imitations en mémoire :

| Service Google | Imitation |
|---|---|
| `SpreadsheetApp` | Des feuilles qui sont de simples tableaux JavaScript |
| `PropertiesService` et `CacheService` | Des objets clé-valeur |
| `LockService` | Un verrou qui signale une erreur s'il est demandé deux fois |
| `Utilities` | Les fonctions de hachage de Node, qui donnent les mêmes résultats |
| `UrlFetchApp` | Une erreur : aucun appel réseau ne doit partir pendant un test |

La fonction `creerEnvironnement()` lit les cinq fichiers `.gs`, les assemble, et les exécute en leur passant ces imitations à la place des vrais services. Elle renvoie toutes les fonctions du serveur dans un objet `S`.

Le code serveur n'a pas été modifié pour être testable : c'est lui, tel quel, qui tourne.

## Ce que le test vérifie

`tests/simulation.cjs` rejoue l'histoire complète d'un centre, dans l'ordre :

1. Seules les fonctions prévues sont appelables depuis le navigateur (fiche 01).
2. L'initialisation des feuilles est refusée hors de Google Sheets.
3. Création de l'administrateur, connexion, refus d'un identifiant en double.
4. Blocage après 5 mots de passe faux (fiche 02).
5. Acceptation puis conversion d'un ancien hash SHA-256 (fiche 02).
6. Invitation : création du compte, puis refus d'une seconde utilisation.
7. Droits : un encadreur ne peut pas administrer, un jeton inventé est refusé.
8. Élèves et séance : validation du numéro WhatsApp, rattachement par la classe.
9. Pointage : une seule ligne par élève, une seule notification, horodatage conservé (fiches 03 et 04).
10. Une séance d'un autre encadreur est inaccessible.
11. Une feuille n'est lue qu'une fois par requête (fiche 03).
12. Tableau de bord, historique, export CSV et PDF.
13. Changement de mot de passe : les autres sessions sont coupées.
14. Suppression d'un compte avec transfert de ses séances.
15. Suppressions en cascade.

Deux vérifications sans scénario ont été ajoutées ensuite (fiche 07) : la syntaxe des scripts de `Index.html`, et la liste des fichiers envoyés par `clasp`.

## Lancer les tests

Il faut Node.js installé. Depuis la racine du dépôt :

```
node tests/simulation.cjs
```

Le résultat attendu se termine par `17 tests réussis.`. Au premier échec, le test s'arrête et affiche la vérification qui a échoué.

L'extension est `.cjs` et non `.js` pour que Node traite toujours ces fichiers de la même façon, quel que soit le dossier où le dépôt est rangé.

## Ce que ces tests ne prouvent pas

- **Les conversions automatiques de Google Sheets.** Le vrai tableur transforme `08:30` en heure et `+225…` en nombre. Les fausses feuilles gardent les valeurs telles quelles. Tout le code de `Db.gs` qui gère ces conversions n'est donc pas mis à l'épreuve.
- **La concurrence réelle.** Deux exécutions simultanées ne peuvent pas être reproduites ainsi.
- **Les quotas et la vitesse.** Ni les limites de Google, ni le temps réel des 2 000 itérations.
- **L'écran.** `Index.html` n'est pas testé, sauf sa syntaxe et la liste des fonctions qu'il appelle.
- **WhatsApp.** Le test tourne en mode simulation (`WHATSAPP_DRY_RUN`).

Un test qui passe ici signifie que la logique est cohérente, pas que le déploiement fonctionne. Un essai dans une copie réelle reste nécessaire avant toute mise en production.

## Ajouter un test

Un test est un bloc `test('description', () => { … })` qui appelle des fonctions de `S` et vérifie le résultat avec `assert`. Les tests se suivent et partagent les mêmes données : un nouveau test se place à l'endroit du scénario où les données dont il a besoin existent.

## Questions possibles du jury

- **Comment tester un code qui dépend d'une plateforme ?** En remplaçant ses dépendances par des doublures qui ont la même interface. C'est le principe du bouchon (mock).
- **Est-ce un test unitaire ?** Plutôt un test d'intégration : il fait travailler ensemble l'API, l'authentification et la couche de données, avec seulement la plateforme remplacée.
- **Quelle est la limite d'une doublure ?** Elle ne reproduit que ce qu'on a pensé à imiter. Un comportement réel non imité passe inaperçu.
- **Que faudrait-il ajouter ?** Tester l'écran dans un navigateur piloté, et reproduire les conversions de Google Sheets dans les fausses feuilles.
