# 06 – Aperçu de l'application sans Google

Pour voir l'application, il fallait la déployer dans Apps Script. `tests/apercu-local.cjs` permet de l'ouvrir dans un navigateur depuis un simple ordinateur, en quelques secondes, avec des données de démonstration.

## Lancer l'aperçu

Depuis la racine du dépôt :

```
node tests/apercu-local.cjs
```

Puis ouvrir http://localhost:8765 dans un navigateur.

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Administrateur | `admin` | `demo-admin-1` |
| Encadreur | `kone.adama` | `demo-encadreur-1` |

Ces comptes n'existent que dans l'aperçu. Pour l'arrêter, faire Ctrl+C dans le terminal.

## Comment ça marche

L'aperçu réunit trois pièces.

### 1. Le serveur exécute le vrai code `.gs`

Il réutilise `creerEnvironnement()` de la fiche 05 : les fichiers `.gs` tournent contre de faux services Google en mémoire. Au démarrage, la fonction `semer()` crée deux comptes, sept élèves et trois séances en appelant les mêmes fonctions que l'écran.

### 2. Un remplaçant de `google.script.run`

Dans Apps Script, l'écran parle au serveur par l'objet `google.script.run`, que Google injecte dans la page. Hors de Google, cet objet n'existe pas.

L'aperçu insère donc dans la page un petit script qui définit un faux `google.script.run`. Il a la même forme que le vrai (`withSuccessHandler`, `withFailureHandler`, puis le nom de la fonction), mais il envoie l'appel au serveur local par une requête HTTP :

```
écran  ──  POST /rpc  { nom: "listerEleves", args: ["jeton…"] }  ──▶  serveur local
écran  ◀──  { resultat: [...] }   ou   { erreur: "message" }      ──  serveur local
```

`Index.html` n'est pas modifié : c'est le même fichier que celui qui sera déployé.

### 3. La même règle de sécurité que Google

Le serveur local refuse d'exécuter une fonction dont le nom se termine par `_`, exactement comme Apps Script. On peut donc constater la correction de la fiche 01 : appeler `configWhatsApp_` renvoie « introuvable ou privée ».

## Différences avec la vraie application

| | Aperçu local | Déploiement Google |
|---|---|---|
| Données | En mémoire, perdues à l'arrêt | Dans le classeur |
| WhatsApp | Simulé, aucun message envoyé | Envoi réel |
| Export PDF | Fichier factice, illisible | Vrai PDF fabriqué par Google |
| Vitesse | Instantanée | Plusieurs secondes par action |
| Conversions de Google Sheets | Absentes | Présentes |
| Utilisateurs simultanés | Un seul processus | Une exécution par appel |

L'aperçu sert à montrer l'application et à vérifier une modification de l'écran. Il ne remplace pas un essai dans un vrai déploiement.

## Pendant le développement

- `Index.html` est relu à chaque chargement : après une modification, il suffit de rafraîchir la page.
- Pour une modification d'un fichier `.gs`, il faut arrêter puis relancer l'aperçu.
- Le port se change avec la variable d'environnement `PORT`.

## Questions possibles du jury

- **Pourquoi ne pas simplement déployer ?** Un déploiement prend plusieurs minutes et touche des données réelles. Un aperçu local donne un retour immédiat, sans risque.
- **Comment l'écran fonctionne-t-il sans être modifié ?** Il ne connaît que l'interface `google.script.run`. Il suffit de fournir un objet qui respecte cette interface : c'est le principe de l'adaptateur.
- **Que montre cet aperçu sur l'architecture ?** Que l'écran et le serveur sont réellement séparés par une interface, et qu'on pourrait remplacer Apps Script par un serveur classique en ne changeant que ce point de contact.
