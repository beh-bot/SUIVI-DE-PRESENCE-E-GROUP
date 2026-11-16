# 08 – Corbeille et sauvegarde

Jusqu'ici, une suppression était définitive et emportait tout l'historique, et il n'existait aucune sauvegarde. Cette tâche protège les données contre l'erreur de manipulation, qui est le risque le plus probable pour ce projet.

## Partie 1 : la corbeille

### Le problème

Supprimer un élève effaçait sa ligne, tous ses pointages et tous ses messages. Supprimer une séance effaçait ses pointages. Un clic de trop, et une année de présences disparaissait sans retour possible.

Cela posait aussi un problème de cohérence : après la suppression d'un élève, les taux de présence des mois passés changeaient, puisque ses pointages n'existaient plus.

### La solution : la suppression logique

Les feuilles `Eleves` et `Seances` ont une nouvelle colonne, `supprime_le` :

- vide : la ligne est active ;
- une date : la ligne est dans la corbeille depuis ce moment.

« Supprimer » n'efface donc plus rien : la fonction écrit la date dans cette colonne. « Rétablir » la vide. C'est ce qu'on appelle une suppression logique, par opposition à la suppression physique de la ligne.

Deux fonctions de `Db.gs` centralisent la règle :

- `actifs_(def)` renvoie les lignes hors corbeille ;
- `trouverActifParId_(def, id)` renvoie une ligne seulement si elle est active.

Tout le reste du code les utilise au lieu de `versObjets_` et `trouverParId_` quand il ne faut voir que l'actif.

### Les règles de gestion retenues

| Situation | Comportement |
|---|---|
| Élève dans la corbeille | Absent des listes, de l'appel, du tableau de bord et des messages. Impossible à pointer ou à modifier |
| Ses anciennes feuilles de présence | Inchangées : il y figure toujours s'il y avait été pointé |
| Son historique | Toujours consultable par l'administrateur |
| Séance dans la corbeille | Absente des listes, inaccessible, ses pointages ne comptent plus dans les statistiques |
| Rétablissement | L'élève ou la séance revient avec tous ses pointages |
| Suppression d'un compte | Les séances de la corbeille n'obligent pas à choisir un repreneur |

La règle sur les anciennes feuilles de présence est portée par `attenduALaSeance_` dans `Api.gs` : un élève figure sur la feuille d'une séance s'il est actif, ou s'il a été pointé à cette séance.

### La suppression définitive reste possible

Effacer réellement des données doit rester possible, ne serait-ce que pour répondre à un parent qui demande le retrait des informations de son enfant. `supprimerEleveDefinitivement` et `supprimerSeanceDefinitivement` font l'ancienne suppression en cascade, mais refusent d'agir sur une ligne qui n'est pas déjà dans la corbeille. Il faut donc deux gestes volontaires pour détruire des données.

### L'écran

Une page **Corbeille** (lien en bas des pages Élèves et Séances, pour l'administrateur) liste les élèves et séances retirés, avec la date et le nombre de pointages conservés. Chaque ligne propose « Rétablir » et « Supprimer définitivement ». Les messages de confirmation des boutons « Supprimer » ont été réécrits pour dire la vérité : la suppression n'est plus définitive.

### La mise à jour des classeurs existants

Un classeur installé avant cette version n'a pas la colonne `supprime_le`. Deux choix ont évité toute manipulation :

- **La nouvelle colonne est ajoutée en dernier**, donc les colonnes existantes ne bougent pas.
- **Vide signifie actif**, donc toutes les lignes existantes sont actives sans qu'on y touche.

Il ne manque alors que l'en-tête. `lireFeuille_` (`Db.gs`) l'écrit automatiquement à la première lecture, si la case est vide. Aucune action n'est demandée à l'administrateur.

## Partie 2 : la sauvegarde

### Le problème

La corbeille protège des suppressions faites dans l'application. Elle ne protège pas d'une erreur faite directement dans le classeur (une colonne effacée, un tri raté), ni d'une suppression définitive regrettée.

### La solution

Le fichier `Sauvegarde.gs` copie les six feuilles de données dans un autre classeur Google Sheets, rangé dans le Google Drive du propriétaire. Le menu **Suivi de présence** du classeur a trois nouvelles entrées.

| Entrée du menu | Effet |
|---|---|
| Sauvegarder maintenant | Crée un nouveau classeur daté. À faire avant toute opération risquée |
| Activer la sauvegarde automatique | Programme une sauvegarde chaque nuit vers 2 h |
| Désactiver la sauvegarde automatique | Arrête la programmation, sans effacer les sauvegardes |

### Sept classeurs qui tournent

Une sauvegarde par nuit dans un nouveau fichier en créerait 365 par an. La sauvegarde automatique utilise donc sept classeurs, un par jour de la semaine. Celui du lundi est réécrit chaque lundi, et ainsi de suite. On dispose toujours des sept derniers jours, et le nombre de fichiers ne grandit jamais.

L'identifiant de chaque classeur est mémorisé dans les propriétés du script (`SAUVEGARDE_JOUR_0` à `SAUVEGARDE_JOUR_6`). Si l'un d'eux a été supprimé, il est recréé.

### Une copie cohérente

`copierDonneesVers_` fait la copie sous le verrou de la fiche 03. Pendant ce temps, personne ne peut écrire : la sauvegarde ne peut donc pas contenir un pointage dont la séance aurait été créée une seconde trop tard pour être copiée.

Les nouvelles feuilles sont ajoutées avant que les anciennes soient retirées, car un classeur ne peut pas rester sans feuille.

### Une fonction publique, donc protégée autrement

Le déclencheur nocturne appelle `sauvegardeAutomatique` par son nom. Elle ne peut donc pas se terminer par `_`, ce qui la rend appelable depuis le navigateur par n'importe qui (fiche 01). Elle est rendue inoffensive par deux garde-fous :

- elle ne fait rien si la sauvegarde automatique n'a pas été activée depuis le menu ;
- elle ne fait rien si une sauvegarde automatique a eu lieu dans les 20 dernières heures.

Elle ne prend aucun paramètre et ne renvoie rien. Un appel extérieur peut au pire avancer de quelques heures la sauvegarde du jour.

Les trois fonctions du menu, elles, commencent par `SpreadsheetApp.getUi()` et échouent donc hors de Google Sheets, comme celles de la fiche 01.

### Restaurer une sauvegarde

Il n'y a pas de bouton de restauration : c'est une opération rare, qui mérite d'être faite à la main et avec attention.

1. Lancer « Sauvegarder maintenant », pour garder aussi l'état actuel.
2. Ouvrir le classeur de sauvegarde voulu dans Google Drive.
3. Sur l'onglet de la feuille à récupérer : **Copier vers > Feuille de calcul existante**, et choisir le classeur de l'application.
4. Dans le classeur de l'application, supprimer la feuille abîmée, puis renommer la copie avec exactement le même nom (`Eleves`, `Presences`…).
5. Lancer « 3) Réparer les données », puis ouvrir l'application pour vérifier.

Les feuilles sont liées entre elles par des identifiants. Restaurer une seule feuille ancienne à côté de feuilles récentes peut laisser des pointages sans élève ou sans séance : ils sont simplement ignorés par l'application. Pour un retour en arrière complet, il faut restaurer les six feuilles de la même sauvegarde.

## Après la mise à jour du code

Créer un classeur et programmer un déclencheur demandent de nouvelles autorisations Google. Au premier clic sur une entrée de sauvegarde du menu, Google affichera une demande d'autorisation, à accepter avec le compte propriétaire.

## Limites à connaître

- **Rien n'a été essayé dans Google.** La copie de feuilles, la création de classeurs et le déclencheur n'ont tourné que dans la simulation.
- **Les sauvegardes contiennent tout**, y compris les hashs des mots de passe et les numéros des parents. Elles sont dans le Drive du propriétaire et ne doivent pas être partagées.
- **Elles sont sur le même compte Google que l'original.** Elles protègent d'une erreur, pas de la perte ou du piratage du compte. Une copie téléchargée de temps en temps hors de Google resterait utile.
- **Une sauvegarde mise à la corbeille de Drive** peut continuer d'être réécrite sans qu'on le voie. Pour s'en débarrasser, il faut la supprimer définitivement.
- **La corbeille de l'application ne se vide pas toute seule.** Aucune durée de conservation n'est appliquée.
- **Les comptes et les invitations** n'ont pas été touchés : les comptes étaient déjà désactivés plutôt qu'effacés.
- **L'écran de la corbeille n'a pas été vu dans un navigateur.** Son code est vérifié syntaxiquement et ses fonctions serveur sont testées.

## Comment vérifier

`npm test` couvre : la migration d'un ancien classeur, la corbeille des élèves et des séances, le rétablissement, la suppression définitive, la fidélité d'une sauvegarde manuelle, et les garde-fous de la sauvegarde automatique.

Dans l'aperçu local (`npm run apercu`), la corbeille se manipule réellement. Les sauvegardes, elles, ne se lancent que depuis le menu de Google Sheets.

## Questions possibles du jury

- **Suppression logique ou physique ?** La suppression logique marque la ligne au lieu de l'effacer. Elle permet l'annulation et garde l'historique, au prix d'un filtre à appliquer partout où on lit les données.
- **Quel est le risque d'une suppression logique ?** Oublier le filtre quelque part et faire réapparaître une donnée retirée. C'est pourquoi le filtre est dans deux fonctions uniques, `actifs_` et `trouverActifParId_`.
- **Pourquoi garder une suppression définitive ?** Parce qu'une personne peut demander l'effacement de ses données. Conserver indéfiniment n'est pas une protection, c'est une obligation de moins respectée.
- **Comment avez-vous fait évoluer le schéma sans interruption ?** En ajoutant la colonne à la fin, en choisissant une valeur vide comme valeur par défaut, et en écrivant l'en-tête manquant à la première lecture.
- **Une sauvegarde sur le même compte est-elle une vraie sauvegarde ?** Partiellement. Elle couvre l'erreur humaine, pas la perte du compte. La règle habituelle demande aussi une copie sur un autre support.
- **Pourquoi sept fichiers plutôt qu'un par nuit ?** Pour borner l'espace utilisé sans avoir à supprimer de fichiers, ce qui aurait demandé une autorisation d'accès à tout le Drive.
