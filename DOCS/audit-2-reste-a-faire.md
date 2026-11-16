# Audit 2 – Ce qu'il reste à améliorer

État du projet après les corrections des fiches 01 à 06 (branche `develop`). Cet audit a été fait par lecture du code et par les tests de simulation. Rien n'a été observé dans un vrai déploiement.

**En résumé :** les failles graves sont fermées. Ce qui reste relève de trois familles : valider les corrections dans un vrai déploiement, combler des manques fonctionnels que les utilisateurs rencontreront vite, et constituer le dossier de génie logiciel (conception, déploiement reproductible, intégration continue).

Chaque point porte une priorité : **P1** à faire avant toute mise en production, **P2** à faire ensuite, **P3** confort ou évolution.

## 1. Validation en conditions réelles

Tout ce qui a été corrigé n'a tourné que sous Node, avec de faux services Google.

| Priorité | Point | Pourquoi |
|---|---|---|
| P1 | Déployer `develop` dans une copie de test (classeur et projet séparés) | C'est la seule façon de valider les fiches 01 à 04 |
| P1 | Mesurer la durée d'une connexion | Les 2 000 itérations PBKDF2 n'ont jamais été chronométrées dans Apps Script |
| P1 | Lancer toutes les entrées du menu Google Sheets | Les trois premières ont été touchées par le renommage, les trois de sauvegarde sont nouvelles (fiche 08) |
| P1 | Faire un appel complet à deux téléphones en même temps | Le verrou global n'a jamais été éprouvé en vrai |
| P1 | Régénérer le jeton WhatsApp, relire la feuille `Utilisateurs` | La faille de la fiche 01 a été ouverte depuis la mise en ligne |

## 2. Sécurité restante

Aucun point critique, mais plusieurs faiblesses.

| Priorité | Point | Détail |
|---|---|---|
| P2 | Un identifiant inexistant répond plus vite | **Fait (fiche 10).** Le calcul lent est fait aussi pour un identifiant inconnu |
| P2 | Jetons de session stockés en clair | **Fait (fiche 10).** Seule l'empreinte SHA-256 du jeton est stockée. Chaque utilisateur se reconnecte une fois après la mise à jour |
| P2 | Sessions dans les propriétés du script | Ce stockage est limité en taille et n'est nettoyé qu'à la connexion. Chaque connexion relit toutes les propriétés |
| P2 | Lien d'invitation administrateur | Quiconque obtient le lien devient administrateur. Il est envoyé par WhatsApp et stocké en clair dans la feuille `Invitations` |
| P2 | Mots de passe choisis par l'administrateur | **Fait (fiche 11).** Le titulaire doit le remplacer à sa première connexion ; le serveur refuse tout autre appel d'ici là |
| P2 | Aucun journal des actions | **Fait (fiche 10).** Feuille Journal et page Journal des actions. Il n'est pas infalsifiable et grandit sans limite |
| P3 | Règle de mot de passe minimale | 8 caractères, sans vérification contre les mots de passe courants |
| P3 | Page `?test=1` publique | Elle révèle si l'installation est terminée |
| P3 | Blocage volontaire d'un compte | Cinq erreurs volontaires bloquent un identifiant 15 minutes (voir fiche 02) |

Hors du code, un point pèse plus que tous les autres : **toute personne ayant accès au classeur voit et peut modifier toutes les données**, y compris les hashs, les invitations et les numéros des parents. Le partage du classeur doit rester limité à l'administrateur.

## 3. Données et modèle

| Priorité | Point | Détail |
|---|---|---|
| P1 | Aucune sauvegarde | **Fait (fiche 08).** Sauvegarde manuelle et sauvegarde automatique chaque nuit sur sept jours. Il reste à l'activer depuis le menu et à faire un essai de restauration |
| P2 | Le lien élève–séance passe par le texte de la classe | Un élève qui change de classe disparaît des feuilles de présence de ses anciennes séances, et le nombre d'élèves attendus change rétroactivement. Il manque une table d'inscription, ou une copie de la liste au moment de la séance |
| P2 | La classe est un texte libre | **Atténué (fiche 11).** Une classe mal écrite rejoint la classe existante, et une classe peut être renommée ou réunie à une autre. Il n'y a toujours pas de table `Classes` |
| P2 | Supprimer un élève efface son historique | **Fait (fiche 08).** Élèves et séances passent par une corbeille ; l'effacement réel demande un second geste |
| P3 | La corbeille ne se vide jamais | Aucune durée de conservation n'est appliquée aux élèves et séances retirés |
| P2 | Données personnelles de mineurs | Noms d'élèves et numéros de parents sont stockés sans mention d'information, de durée de conservation, ni de consentement à recevoir des messages. À vérifier au regard de la loi ivoirienne sur les données personnelles |
| P3 | Notification bloquée « en cours » | Si l'exécution s'interrompt entre la création de la notification et l'envoi, elle reste « en cours » et le bouton « Renvoyer » n'est proposé que pour les échecs |

## 4. Fonctionnalités manquantes

Ce sont les manques que les utilisateurs rencontreront en premier.

| Priorité | Point | Détail |
|---|---|---|
| P1 | Message WhatsApp immédiat et sans retour possible | Un « Absent » touché par erreur prévient le parent tout de suite. Il n'y a ni délai d'annulation, ni message correctif **À décider** par le responsable du centre : les options sont décrites dans la fiche 09 |
| P2 | Impossible de modifier une séance | **Fait (fiche 09).** La classe se fige dès le premier pointage |
| P2 | Pas d'import d'élèves | **Fait (fiche 09).** Import par copier-coller ou fichier CSV, tout ou rien, sans doublons |
| P2 | Pas de « tous présents » | **Fait (fiche 09).** Un bouton marque présents les élèves non encore pointés |
| P2 | Listes limitées à 200 lignes | **Fait (fiche 11).** Bouton « Afficher les plus anciennes », jusqu'à 2 000 lignes. Pas de filtre par période |
| P2 | « Envoyé » ne veut pas dire « reçu » | Le statut indique que Meta a accepté le message. Savoir s'il a été remis ou lu demande de recevoir les notifications de Meta (webhook) |
| P3 | Pas de séances récurrentes | Un cours hebdomadaire se recrée à la main chaque semaine |
| P3 | Aucun fonctionnement hors connexion | Sur un réseau faible, un pointage qui échoue est perdu, sans file d'attente ni nouvel essai |

## 5. Performance et montée en charge

| Priorité | Point | Détail |
|---|---|---|
| P2 | Verrou global | Toutes les écritures de tous les utilisateurs passent une par une. En début d'heure, avec plusieurs encadreurs, l'attente peut dépasser 20 secondes et provoquer une erreur |
| P2 | Un pointage reste coûteux | Malgré le cache, un clic « Absent » fait une dizaine de lectures de feuilles, trois écritures et un appel réseau |
| P2 | Pastille des messages en échec | À chaque changement de page, l'écran d'un administrateur recharge trois feuilles entières pour afficher un simple point rouge |
| P3 | Lecture intégrale des feuilles | Chaque requête relit des feuilles entières. Le temps de réponse augmente avec l'ancienneté des données, et rien n'archive les années passées |
| P3 | Page lourde | Le logo et le CSS sont intégrés à la page, qui pèse environ 166 Ko à chaque ouverture |

Ces limites tiennent au choix d'un tableur comme base de données. Elles se repoussent, mais ne se suppriment qu'en changeant de stockage.

## 6. Qualité du code et outillage

| Priorité | Point | Détail |
|---|---|---|
| P1 | Déploiement par copier-coller | **Préparé (fiche 07).** Le manifeste et la configuration `clasp` sont dans le dépôt. Il reste à installer `clasp`, à se connecter, et à comparer le manifeste avec celui de la production |
| P2 | Pas d'intégration continue | **Fait (fiche 07).** GitHub lance les tests à chaque envoi et sur chaque pull request |
| P2 | Pas d'environnement de test | Il n'existe qu'une production. Toute modification s'essaie sur les vraies données |
| P2 | Écran en un seul fichier | `Index.html` fait plus de 1 000 lignes, mêle structure, style et logique, et n'a aucun test |
| P2 | CSS compilé sans ses sources | Le Tailwind intégré ne peut pas être régénéré. Toute nouvelle classe est sans effet |
| P3 | Fausses feuilles trop simples | Les tests ne reproduisent pas les conversions automatiques de Google Sheets, qui ont été la source de bogues réels d'après les commentaires de `Db.gs` |
| P3 | Ni analyse statique ni formatage automatique | Pas d'ESLint ni de Prettier |
| P3 | Petits restes dans l'écran | Une condition toujours vraie dans la gestion des formulaires, et deux branches identiques dans `renvoyer` |

## 7. Dossier de soutenance

Ces éléments ne changent rien au fonctionnement, mais ce sont eux qu'un jury de génie logiciel attend.

| Priorité | Document | Contenu |
|---|---|---|
| P1 | Cahier des charges | Acteurs, besoins, règles de gestion, ce qui est hors périmètre |
| P1 | Modèle de données | Les six feuilles vues comme des tables, leurs liens, et les contraintes qu'un tableur ne garantit pas |
| P1 | Cas d'utilisation et séquence du pointage | Du clic « Absent » jusqu'au message WhatsApp, avec le verrou |
| P1 | Justification des choix techniques | Pourquoi Apps Script et Sheets, leurs limites mesurées, le seuil de migration |
| P2 | Plan de migration | Comment passer à une API classique et une vraie base. L'aperçu local (fiche 06) montre que l'écran s'en accommoderait |

## Ordre de travail proposé

1. **Valider** : copie de test, mesures, contrôles de production (section 1). La marche à suivre, case par case, est dans la [fiche 12](12-guide-de-test.md).
2. **Fiabiliser le déploiement** : `clasp`, manifeste versionné, intégration continue (section 6).
3. **Protéger les données** : sauvegarde, désactivation au lieu de suppression (section 3).
4. **Corriger l'usage quotidien** : délai d'annulation WhatsApp, modification de séance, import d'élèves, « tous présents » (section 4).
5. **Finir la sécurité** : hash factice, jetons hachés, journal des actions (section 2).
6. **Rédiger le dossier** en parallèle, dès maintenant (section 7).

Les étapes 1 et 6 ne peuvent pas être déléguées : la première demande l'accès au compte Google du projet, la seconde est le travail personnel évalué.
