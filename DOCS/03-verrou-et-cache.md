# 03 – Écritures simultanées, verrou et cache de lecture

Quand deux personnes utilisaient l'application au même moment, des données pouvaient être perdues ou écrites au mauvais endroit. Ce commit corrige cela dans `Db.gs`, et réduit au passage le nombre de lectures du classeur.

## Le problème

Google lance une exécution séparée pour chaque appel de chaque utilisateur. Deux exécutions peuvent donc tourner en même temps sur le même classeur. Or une feuille n'est pas une base de données : elle n'a pas de transactions.

### Cas 1 : deux ajouts qui s'écrasent

`inserer` écrivait à la ligne `getLastRow() + 1`.

| Moment | Exécution A (ajoute Issa) | Exécution B (ajoute Aya) |
|---|---|---|
| 1 | lit la dernière ligne : 10 | |
| 2 | | lit la dernière ligne : 10 |
| 3 | écrit Issa en ligne 11 | |
| 4 | | écrit Aya en ligne 11 |

Issa a disparu, sans aucun message d'erreur.

### Cas 2 : une écriture sur la mauvaise ligne

`mettreAJour` et `supprimerLigne` cherchaient d'abord le numéro de ligne d'un enregistrement, puis écrivaient à ce numéro. Si une autre exécution supprimait une ligne située plus haut entre les deux, tous les numéros se décalaient : la modification tombait sur l'enregistrement voisin.

Le code d'origine avait déjà un verrou (`avecVerrou`), mais seulement autour de la création de compte et du pointage.

## La solution : tout écrire sous verrou

`LockService.getScriptLock()` fournit un verrou commun à toutes les exécutions du script : une seule peut le tenir à la fois, les autres attendent.

Les quatre fonctions d'écriture (`inserer_`, `mettreAJour_`, `supprimerLigne_`, `supprimerToutesLignesOu_`) font maintenant leur lecture et leur écriture à l'intérieur de `avecVerrou_`. Entre « je lis le numéro de ligne » et « j'écris », plus personne ne peut modifier la feuille.

Les opérations en plusieurs étapes sont elles aussi entourées d'un seul verrou, pour être faites en entier ou pas du tout par rapport aux autres :

- modifier un compte (vérifier que l'identifiant est libre, puis écrire) ;
- supprimer un compte (transférer ses séances, puis le désactiver) ;
- supprimer un élève ou une séance avec ses pointages et ses messages ;
- renvoyer un message WhatsApp (vérifier qu'il est en échec, puis le passer « en cours ») : un double clic n'envoie plus deux messages.

### Un verrou réentrant

`supprimerEleve` prend le verrou, puis appelle `supprimerLigne_`, qui le demande aussi. Sans précaution, la seconde demande attendrait un verrou que l'exécution tient déjà.

`avecVerrou_` utilise donc une variable `verrouTenu`. Si elle est vraie, la fonction est exécutée directement. Sinon, le verrou est pris, puis rendu à la fin dans un bloc `finally`, donc même en cas d'erreur.

### Le `flush` avant de rendre le verrou

Apps Script regroupe parfois les écritures pour les envoyer plus tard. `SpreadsheetApp.flush()` force leur envoi avant que le verrou soit rendu, pour que l'exécution suivante lise bien des données à jour.

### Pas d'appel réseau sous verrou

L'envoi WhatsApp peut durer plusieurs secondes. Il se fait toujours hors du verrou, sinon tous les autres utilisateurs attendraient pendant ce temps.

## Le cache de lecture

`versObjets_` relisait la feuille entière à chaque appel. Un seul clic « Absent » lisait ainsi la feuille des utilisateurs deux fois et celle des élèves deux fois.

Les lignes lues sont maintenant gardées dans `cacheFeuilles` pendant la durée d'un appel :

- une feuille n'est lue qu'une fois par appel ;
- le cache d'une feuille est vidé dès qu'on écrit dedans ;
- tout le cache est vidé quand on prend le verrou, car ce qui a été lu avant a pu changer ;
- `versObjets_` renvoie des copies, pour qu'une fonction ne puisse pas modifier par erreur les données en cache.

Ce cache ne vit que le temps d'une exécution : les variables globales d'Apps Script sont remises à zéro à chaque appel. Il ne peut donc pas servir des données d'une requête précédente.

## Limites à connaître

- **Le verrou est global.** Deux encadreurs qui pointent au même moment passent l'un après l'autre. Avec beaucoup d'encadreurs en début d'heure, l'attente peut dépasser 20 secondes, et l'application répond alors « très sollicitée ». C'est la limite structurelle d'un tableur utilisé comme base de données.
- **Les lectures hors verrou peuvent dater de quelques secondes.** C'est sans conséquence pour l'affichage, et toutes les décisions qui précèdent une écriture sont relues sous verrou.
- **Non mesuré dans Apps Script.** Le gain du cache et le coût du verrou sont à observer dans un vrai déploiement.

## Comment vérifier

`node tests/simulation.cjs` vérifie qu'une feuille n'est lue qu'une fois par requête, que le cache n'est pas modifiable par l'appelant, que le verrou est toujours rendu, et qu'il n'est jamais demandé deux fois par la même exécution. La concurrence réelle entre deux exécutions ne peut pas être reproduite sur un ordinateur.

## Questions possibles du jury

- **Qu'est-ce qu'une situation de concurrence ?** Un résultat qui dépend de l'ordre dans lequel deux traitements simultanés s'entrelacent. Le tableau du cas 1 en est un exemple.
- **Comment une vraie base de données règle-t-elle ce problème ?** Par des transactions, des clés primaires et des contraintes d'unicité. Le verrou est ici un substitut plus grossier.
- **Quel est le prix de votre solution ?** Les écritures sont faites une par une pour tout le monde, ce qui limite le nombre d'utilisateurs simultanés.
- **Pourquoi `finally` ?** Pour que le verrou soit rendu même si une erreur survient, sinon tout le monde resterait bloqué jusqu'à son expiration.
- **Pourquoi vider le cache en prenant le verrou ?** Parce qu'une autre exécution a pu écrire pendant qu'on attendait.
