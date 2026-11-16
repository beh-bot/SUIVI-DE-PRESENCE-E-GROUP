# 10 – Fin de la sécurité : identifiants, jetons de session, journal des actions

Les failles graves ont été fermées par les fiches 01 et 02. Il restait trois faiblesses, moins urgentes, mais qu'un examen de sécurité relève toujours. Elles sont traitées ici.

## 1. Le temps de réponse révélait les identifiants existants

### Le problème

À la connexion, le serveur cherchait le compte, puis vérifiait le mot de passe par le calcul lent de la fiche 02 (2 000 itérations). Mais si le compte n'existait pas, il n'y avait rien à vérifier : la réponse partait tout de suite.

Le message d'erreur était le même dans les deux cas, ce qui est correct. Le temps de réponse, lui, ne l'était pas. En chronométrant ses essais, un attaquant pouvait distinguer « identifiant inconnu » (réponse rapide) de « mot de passe faux » (réponse lente), et dresser la liste des identifiants valides. C'est ce qu'on appelle une attaque par canal auxiliaire : l'information ne fuit pas par le contenu de la réponse, mais par un effet de bord.

Le passage à PBKDF2 avait d'ailleurs accentué cet écart. Une amélioration de sécurité en avait dégradé une autre.

### La solution

Dans `connexion` (`Auth.gs`), quand l'identifiant est inconnu, le serveur fait quand même le calcul lent, sur un sel factice, et jette le résultat :

```js
if (!u) pbkdf2Hex_(motDePasse || 'x', 'sel-factice', ITERATIONS_MDP);
```

Les deux cas coûtent maintenant le même nombre de calculs. Le test le vérifie en comptant les opérations HMAC demandées : le total est identique pour un identifiant existant et pour un identifiant inventé.

### Ce que cela ne couvre pas

Un compte dont le mot de passe est encore à l'ancien format (SHA-256 simple, jamais reconnecté depuis la fiche 02) répond plus vite que les autres. L'écart disparaît à sa première connexion réussie.

## 2. Les jetons de session étaient stockés en clair

### Le problème

À la connexion, le serveur crée un jeton aléatoire, le donne au navigateur, et le range dans les propriétés du script sous la clé `session_<jeton>`. À chaque appel, le navigateur renvoie son jeton et le serveur le retrouve.

Toute personne pouvant lire les propriétés du script (un autre éditeur du projet Apps Script, ou quelqu'un qui en obtient une copie) y trouvait donc des jetons directement utilisables. Il lui suffisait d'en copier un pour agir à la place d'un administrateur connecté, sans connaître aucun mot de passe.

### La solution

Le serveur ne stocke plus le jeton, seulement son empreinte SHA-256. La clé devient `session_<empreinte>` (fonction `cleSession_`).

- À la création, le navigateur reçoit le jeton ; le serveur ne garde que l'empreinte.
- À chaque appel, le serveur calcule l'empreinte du jeton reçu et cherche cette clé.
- Lire les propriétés ne donne plus que des empreintes, dont on ne peut pas remonter au jeton.

C'est le même principe que pour les mots de passe : ne jamais conserver ce qui permet de s'authentifier, seulement de quoi le vérifier.

### Pourquoi SHA-256 suffit ici, et pas pour les mots de passe

La fiche 02 expliquait qu'un hachage rapide est dangereux pour un mot de passe, parce qu'un attaquant peut essayer des millions de mots de passe probables. Un jeton est un UUID tiré au hasard, avec environ 2 puissance 122 valeurs possibles : il n'y a pas de « jetons probables » à essayer. Le hachage rapide est donc suffisant, et il le faut, puisqu'il est calculé à chaque appel.

### Conséquence au déploiement

Les sessions ouvertes avant la mise à jour sont enregistrées sous l'ancienne forme. Elles ne sont plus reconnues : **chaque utilisateur devra se reconnecter une fois**. Les anciennes entrées s'effacent d'elles-mêmes à leur expiration, sous 12 heures.

Le jeton reçu est aussi contrôlé avant usage : il doit être un texte de 100 caractères au plus.

## 3. Aucune trace des actions

### Le problème

Rien n'indiquait qui avait supprimé un élève, modifié un compte ou créé une invitation. Après un incident, il était impossible de reconstituer ce qui s'était passé. C'était aussi la raison pour laquelle on ne pouvait pas savoir si la faille de la fiche 01 avait été exploitée.

### La solution

Une septième feuille, `Journal`, reçoit une ligne par action. Chaque ligne indique la date, l'auteur, un code d'action, ce qui est concerné, et un détail.

| Famille | Actions tracées |
|---|---|
| Connexion | Connexion réussie |
| Comptes | Création, modification, suppression, changement de mot de passe |
| Invitations | Création, annulation, acceptation |
| Élèves | Ajout, modification, import, mise à la corbeille, rétablissement, suppression définitive |
| Séances | Création, modification, mise à la corbeille, rétablissement, suppression définitive |

Tout passe par une seule fonction, `journaliser_` (`Db.gs`), appelée après la réussite de l'action. Une page **Journal des actions**, accessible depuis la page Encadreurs, affiche les 200 dernières lignes à l'administrateur. Le journal complet reste consultable dans la feuille.

### Quatre choix de conception

**Le journal ne fait jamais échouer l'action.** Quand `journaliser_` est appelée, l'élève est déjà supprimé ou le compte déjà créé. Si l'écriture du journal échouait et renvoyait une erreur, l'utilisateur croirait que son action a échoué alors qu'elle a réussi. `journaliser_` attrape donc ses propres erreurs et les note dans les journaux d'exécution de Google. Un test simule cette panne.

**Aucun secret dans le journal.** On y écrit des identifiants de connexion, des noms d'élèves et de classes. Jamais de mot de passe, de jeton, ni de numéro de téléphone. Un test le vérifie.

**Les pointages n'y figurent pas.** Chaque pointage porte déjà son heure et son auteur dans la feuille `Presences`. Les recopier doublerait le nombre d'écritures pendant l'appel, qui est le moment où l'application est la plus sollicitée.

**Les connexions échouées n'y figurent pas.** La fonction de connexion est appelable par n'importe qui. Tracer chaque échec permettrait à un inconnu de remplir la feuille à volonté. Le blocage après cinq échecs (fiche 02) reste la protection contre les essais répétés.

### La mise à jour des classeurs existants

Comme pour la feuille des invitations, `feuille_` crée la feuille `Journal` à la première écriture si elle manque. Aucune manipulation n'est demandée.

## Limites à connaître

- **Le journal n'est pas infalsifiable.** C'est une feuille du classeur : quiconque peut modifier le classeur peut en effacer des lignes. Il sert à comprendre un incident et à repérer une erreur, pas à prouver quelque chose contre le propriétaire du classeur. Un vrai journal d'audit serait écrit dans un système que l'administrateur ne peut pas modifier.
- **Il grandit sans limite.** Rien n'archive ni ne purge les anciennes lignes. Il est lu en entier pour afficher la page.
- **Chaque action tracée coûte une écriture de plus**, donc un peu de temps, connexion comprise. Ce coût n'a pas été mesuré dans Google.
- **Les exports ne sont pas tracés.** Télécharger une feuille de présence en PDF ou CSV ne laisse pas de ligne.
- **Rien n'a tourné dans Google**, et la page Journal n'a pas été vue dans un navigateur.
- **Non traité dans cette étape :** le lien d'invitation administrateur reste aussi puissant qu'un mot de passe, et rien n'oblige un encadreur à changer le mot de passe choisi pour lui par l'administrateur.

## Comment vérifier

`npm test` couvre : le coût identique d'une connexion pour un identifiant connu et inconnu, l'absence du jeton en clair dans les propriétés, le rejet d'une session à l'ancien format, la présence de chaque type d'action dans le journal, l'absence de secret, la lecture réservée à l'administrateur, la création automatique de la feuille et la panne du journal.

## Questions possibles du jury

- **Qu'est-ce qu'un canal auxiliaire ?** Une fuite d'information par un effet de bord du traitement (durée, consommation, taille de la réponse) plutôt que par son résultat.
- **Pourquoi le même message d'erreur ne suffisait-il pas ?** Parce que le temps de réponse différait. Deux cas indiscernables doivent l'être par tous les moyens observables.
- **Pourquoi hacher un jeton de session ?** Pour qu'une fuite du stockage ne donne pas de sessions utilisables. Le serveur n'a besoin que de vérifier un jeton, pas de le connaître.
- **Pourquoi un hachage rapide pour les jetons et lent pour les mots de passe ?** Un mot de passe est choisi par un humain, donc devinable ; un jeton est aléatoire, donc impossible à énumérer.
- **Que doit contenir un journal d'audit ?** Qui, quoi, quand, sur quoi. Jamais de secret, et le moins possible de données personnelles.
- **Votre journal fait-il foi ?** Non : il est stocké au même endroit que les données et modifiable par le propriétaire. Il aide au diagnostic. Pour faire foi, il devrait être écrit dans un système séparé, en ajout seul.
- **Pourquoi ne pas faire échouer l'action si le journal échoue ?** C'est un compromis. Ici, la disponibilité du service prime. Dans un système où la traçabilité est une obligation légale, on ferait le choix inverse, en écrivant le journal dans la même transaction que l'action.
