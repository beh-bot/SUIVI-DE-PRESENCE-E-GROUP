# 11 – Classes, listes longues et premier mot de passe

Trois points de l'audit restaient ouverts dans le code. Ils sont de moindre gravité que les précédents, mais chacun finit par gêner un centre qui utilise l'application pendant plusieurs mois.

## 1. Le mot de passe choisi par l'administrateur

### Le problème

Quand l'administrateur crée un compte, c'est lui qui choisit le mot de passe, puis il le transmet à l'encadreur, souvent par messagerie. Deux personnes connaissent donc ce mot de passe, il traîne dans une conversation, et rien n'obligeait l'encadreur à le remplacer.

Conséquence : l'administrateur pouvait se connecter à la place d'un encadreur, et un pointage signé par un encadreur ne prouvait pas que c'était bien lui.

### La solution

La feuille `Utilisateurs` a une nouvelle colonne, `mdp_a_changer`. Elle vaut `oui` dans deux cas :

- l'administrateur crée un compte avec un mot de passe ;
- l'administrateur remplace le mot de passe d'un autre compte.

Elle est vidée quand le titulaire change lui-même son mot de passe. Elle reste vide pour un compte créé par lien d'invitation, puisque la personne y choisit son mot de passe, et pour un administrateur qui change le sien.

### La règle est appliquée par le serveur

Tant que la colonne vaut `oui`, `exigerConnexion_` (`Auth.gs`) refuse tous les appels avec l'erreur `MOT_DE_PASSE_A_CHANGER`. Seules trois fonctions restent permises : `moi`, `changerMonMotDePasse` et `deconnexion`.

L'écran, de son côté, ouvre une fenêtre « Choisissez votre mot de passe » qui ne se ferme ni par Échap ni par un clic à côté. Mais ce n'est qu'un affichage : quelqu'un qui contournerait l'écran se heurterait au refus du serveur. C'est la même règle que dans la fiche 01, appliquée une fois de plus : l'écran annonce, le serveur décide.

Comme toutes les fonctions passent déjà par `exigerConnexion_` ou `exigerAdmin_`, il a suffi de modifier ce seul point de passage. Aucune des quarante fonctions publiques n'a dû être touchée, et une fonction ajoutée plus tard sera protégée sans y penser.

### La mise à jour des classeurs existants

La colonne est ajoutée en dernier et vide signifie « rien à changer » : les comptes existants ne sont pas concernés et l'en-tête s'écrit tout seul, comme pour la fiche 08.

## 2. La classe en texte libre

### Le problème

Un élève est rattaché à une séance par le texte de sa classe. « 3e A », « 3eA » et « 3E a » étaient donc trois classes différentes. Un élève saisi avec une espace en moins n'apparaissait dans aucun appel, sans aucun message d'erreur. C'est le genre de défaut qu'on met longtemps à comprendre.

### La solution retenue : une écriture unique par classe

À chaque création ou modification d'un élève ou d'une séance, et à chaque import, la classe saisie est comparée aux classes existantes par une clé simplifiée (`cleClasse_`, `Api.gs`) : sans majuscules, sans accents, sans espaces ni ponctuation.

| Saisi | Clé | Classe déjà existante | Enregistré |
|---|---|---|---|
| `3eA` | `3ea` | `3e A` | `3e A` |
| `3E  a` | `3ea` | `3e A` | `3e A` |
| `Tle D` | `tled` | aucune | `Tle D` |

Si une classe existante a la même clé, c'est son écriture qui est enregistrée (`classeCanonique_`). Sinon, la classe est nouvelle et garde l'écriture saisie. Deux écritures de la même classe ne peuvent donc plus coexister.

Pour l'import, l'index des classes est construit une seule fois pour toute la liste, et une classe nouvelle écrite de deux façons dans le même fichier n'en donne qu'une.

### Renommer ou réunir des classes

Il fallait aussi pouvoir réparer les doublons déjà présents, et renommer une classe en début d'année. `renommerClasse` applique un nouveau nom à tous les élèves et à toutes les séances d'une classe, corbeille comprise. Si le nouveau nom est celui d'une autre classe, les deux sont réunies.

Un bouton « Renommer la classe » se trouve à côté de chaque classe dans la page Élèves.

L'écriture se fait en deux fois seulement, quel que soit le nombre de lignes, grâce à `remplacerDansColonne_` (`Db.gs`) : elle lit la colonne `classe`, remplace les valeurs en mémoire et réécrit la colonne d'un bloc. C'est le même raisonnement que pour l'import de la fiche 09.

### Ce qui n'a pas été fait : une table des classes

La solution propre, dans une base de données, serait une table `Classes` et, dans les élèves et les séances, l'identifiant de la classe au lieu de son nom. Renommer une classe reviendrait alors à modifier une seule cellule.

Elle n'a pas été retenue ici parce qu'elle demande de transformer toutes les données existantes et tous les écrans, pour un bénéfice que la clé de comparaison apporte déjà en grande partie. C'est un bon exemple de dette technique assumée : la limite est connue, documentée, et son remboursement est décrit.

## 3. Les listes coupées à 200 lignes

### Le problème

Les pages Séances et Messages n'affichaient que les 200 lignes les plus récentes. Au-delà, les lignes existaient toujours mais n'étaient plus accessibles depuis l'application. Un centre qui tient quatre séances par jour atteint cette limite en moins de deux mois.

### La solution

`listerSeances` et `listerNotifications` acceptent maintenant une limite, entre 200 et 2 000 (`limiteListe_`). L'écran demande d'abord 200 lignes. S'il en reçoit 200, il affiche un bouton « Afficher les plus anciennes », qui redemande la liste avec 200 lignes de plus.

La borne haute de 2 000 est imposée par le serveur : une valeur plus grande envoyée à la main est ramenée à 2 000.

### Une pagination simple, pas une pagination efficace

Chaque clic redemande toute la liste depuis le début, et non les 200 lignes suivantes. Ce choix est volontaire : avec un tableur, le serveur relit de toute façon la feuille entière à chaque appel, donc demander « les lignes 200 à 400 » ne lui épargnerait rien. Seul le volume envoyé au navigateur augmente.

## Limites à connaître

- **Rien n'a tourné dans Google**, et les nouveaux écrans n'ont pas été vus dans un navigateur.
- **Classes vraiment différentes mais proches.** « 3e A » et « 3e A bis » restent distinctes, ce qui est voulu. En revanche « 3ème A » et « 3e A » aussi, puisque leurs lettres diffèrent : il faut alors les réunir à la main avec le bouton de renommage.
- **Réunir deux classes modifie les anciennes feuilles de présence.** Les séances passées de chaque classe attendent désormais les élèves des deux. Ceux qui n'y avaient pas été pointés y apparaissent comme « non pointés ».
- **Au-delà de 2 000 séances**, les plus anciennes ne sont plus consultables dans l'application. Elles restent dans le classeur. Un filtre par période serait la suite logique.
- **L'administrateur créé depuis le menu Google Sheets** choisit son propre mot de passe dans une fenêtre où il reste visible : il n'est pas forcé de le changer, mais il devrait le faire.
- **Le mot de passe provisoire n'expire pas.** Tant que l'encadreur ne s'est pas connecté, celui qui l'a intercepté peut le faire à sa place. Le lien d'invitation, à usage unique et valable 7 jours, reste le moyen le plus sûr de créer un compte.

## Comment vérifier

`npm test` couvre : le refus de tout appel tant que le mot de passe n'est pas changé, les cas où l'obligation s'applique ou non, le rattachement d'une classe mal écrite à la classe existante, le renommage, la fusion, et les bornes de la limite des listes.

## Questions possibles du jury

- **Pourquoi forcer le changement côté serveur si l'écran le fait déjà ?** L'écran s'exécute chez l'utilisateur, qui peut l'ignorer. Une règle de sécurité n'existe que là où elle ne peut pas être contournée.
- **Pourquoi un seul point de contrôle ?** Une règle écrite à un seul endroit ne peut pas être oubliée dans une fonction. C'est l'intérêt d'avoir fait passer tous les appels par `exigerConnexion_`.
- **Qu'est-ce que la normalisation d'une donnée saisie ?** La ramener à une forme de référence avant de la comparer ou de l'enregistrer, pour que deux saisies équivalentes soient reconnues comme identiques.
- **Pourquoi ne pas avoir créé une table des classes ?** C'est la bonne modélisation, et la fiche le dit. Le coût de migration a été jugé supérieur au gain immédiat. Reconnaître une dette et la documenter fait partie du métier.
- **Quel est le défaut d'une relation portée par un texte ?** Rien ne garantit que la valeur existe de l'autre côté. Une clé étrangère l'interdirait.
- **Votre pagination est-elle efficace ?** Non : elle limite l'affichage, pas le travail du serveur. Une vraie pagination demande un stockage capable de lire une tranche sans tout parcourir, ce que fait un index de base de données.
