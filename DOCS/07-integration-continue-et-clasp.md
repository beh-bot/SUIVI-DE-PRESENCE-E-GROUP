# 07 – Tests automatiques et déploiement par `clasp`

Deux manques d'outillage sont traités ici : les tests ne se lançaient qu'à la main, et le code arrivait en production par copier-coller.

## Partie 1 : les tests lancés automatiquement par GitHub

### Le problème

Les tests de la fiche 05 existaient, mais rien n'obligeait à les lancer. Une modification qui casse l'application pouvait être fusionnée dans `main` sans que personne ne s'en aperçoive.

### La solution

Le fichier `.github/workflows/tests.yml` décrit une tâche que GitHub exécute tout seul, sur ses propres machines :

- à chaque envoi de code sur `main` ou `develop` ;
- sur chaque pull request.

La tâche récupère le dépôt, installe Node 22 et lance `npm test`. Le résultat s'affiche sur GitHub : une coche verte ou une croix rouge à côté du commit, et dans la pull request avant la fusion. C'est ce qu'on appelle l'intégration continue.

Le fichier `package.json` a été ajouté pour donner des noms courts aux commandes :

| Commande | Effet |
|---|---|
| `npm test` | Lance `node tests/simulation.cjs` |
| `npm run apercu` | Lance l'aperçu local (fiche 06) |

Le projet n'a aucune dépendance : `package.json` ne contient que ces raccourcis, et il n'y a rien à installer.

### Deux tests ajoutés

- **Syntaxe de l'écran.** Les scripts de `Index.html` sont analysés. Une accolade oubliée fait échouer le test, au lieu d'être découverte par un écran blanc en production.
- **Liste des fichiers déployés.** Le test vérifie que `.claspignore` cite chaque fichier `.gs` et `.html` de la racine, et que le manifeste demande le moteur V8. Si un fichier est ajouté au projet sans être ajouté à cette liste, le test échoue.

## Partie 2 : le déploiement par `clasp`

### Le problème

Pour mettre le code en ligne, il fallait ouvrir l'éditeur Apps Script et y coller chaque fichier. Ce procédé a trois défauts :

- rien ne garantit que la production contient le même code que le dépôt ;
- un fichier oublié ou collé à moitié donne une application cassée ;
- le manifeste `appsscript.json`, qui fixe le moteur d'exécution et l'accès à l'application, n'était versionné nulle part.

### La solution

`clasp` est l'outil en ligne de commande de Google pour Apps Script. Il envoie les fichiers d'un dossier vers un projet Apps Script, comme `git push` les envoie vers GitHub.

Quatre fichiers ont été ajoutés :

| Fichier | Rôle |
|---|---|
| `appsscript.json` | Le manifeste du projet, désormais versionné |
| `.claspignore` | La liste des seuls fichiers à envoyer : le manifeste, les cinq `.gs` et `Index.html` |
| `.clasp.json.example` | Un modèle du fichier qui désigne le projet Apps Script visé |
| `.gitignore` | Écarte `.clasp.json` et `.clasprc.json` du dépôt |

`.clasp.json` contient l'identifiant du projet Apps Script. Il n'est pas versionné parce qu'il diffère selon la personne : chacun vise sa copie de test, et seul le responsable vise la production. `.clasprc.json` contient les identifiants de connexion Google et ne doit jamais être partagé.

### Le manifeste

```json
{
  "timeZone": "Africa/Abidjan",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

- `runtimeVersion: V8` est obligatoire : le code utilise des fonctions fléchées, `const` et des gabarits de texte, que l'ancien moteur ne comprend pas.
- `executeAs: USER_DEPLOYING` fait tourner l'application avec le compte de celui qui la déploie. C'est ce qui lui donne accès au classeur, quel que soit le visiteur.
- `access: ANYONE_ANONYMOUS` ouvre l'application sans compte Google. L'application a son propre écran de connexion.
- `timeZone` est le fuseau du script. Depuis la fiche 04, c'est le fuseau du classeur qui sert aux calculs.

**Ces valeurs ont été déduites du code, pas lues dans la production.** Avant le premier envoi vers la production, il faut les comparer au manifeste réel (voir plus bas).

### Mise en place, une seule fois

Il faut Node 22 ou plus récent.

1. Installer l'outil : `npm install -g @google/clasp`
2. Activer l'API Apps Script sur https://script.google.com/home/usersettings
3. Se connecter : `clasp login` (une page Google s'ouvre dans le navigateur)
4. Désigner le projet visé, de l'une de ces deux façons :
   - **Copie de test neuve :** créer un classeur vide, relever son identifiant dans son adresse, puis lancer `clasp create-script --title "Suivi de présence (test)" --parentId IDENTIFIANT_DU_CLASSEUR`. La commande crée `.clasp.json`.
   - **Projet existant :** copier `.clasp.json.example` en `.clasp.json` et y coller l'identifiant du script, visible dans l'éditeur Apps Script sous **Paramètres du projet > ID du script**.

`clasp create-script` peut remplacer le fichier `appsscript.json` local par un manifeste par défaut. Si `git status` le montre modifié après cette commande, `git checkout appsscript.json` rétablit celui du dépôt.

### Utilisation courante

| Commande | Effet |
|---|---|
| `clasp push` | Envoie les fichiers vers le projet Apps Script |
| `clasp open-script` | Ouvre l'éditeur Apps Script dans le navigateur |
| `clasp list-deployments` | Liste les déploiements et leurs identifiants |
| `clasp create-deployment -d "description"` | Crée un nouveau déploiement, avec un nouveau lien |
| `clasp update-deployment IDENTIFIANT -d "description"` | Met à jour un déploiement existant en gardant son lien |

Trois points à retenir :

- **`clasp push` remplace tout le contenu du projet en ligne** par celui du dossier. Un fichier qui n'existe que dans l'éditeur est supprimé.
- **`clasp push` ne met pas à jour l'application ouverte au public.** Le lien `/exec` sert une version figée. Il faut ensuite `clasp update-deployment` pour que les utilisateurs voient le nouveau code.
- **Pour garder le même lien**, il faut `update-deployment` avec l'identifiant du déploiement existant. `create-deployment` donne un nouveau lien, et les anciens liens d'invitation ne correspondraient plus.

### Avant le premier envoi vers la production

1. Dans un dossier vide à part, lancer `clasp clone-script IDENTIFIANT_DU_SCRIPT` pour récupérer le code et le manifeste réellement en ligne.
2. Comparer ce `appsscript.json` avec celui du dépôt, surtout la section `webapp`. En cas de différence, c'est celui de la production qui fait foi : le recopier dans le dépôt.
3. Garder ce dossier comme sauvegarde du code en ligne.
4. Essayer d'abord le nouveau code sur une copie de test, jamais directement en production.

## Limites à connaître

- **`clasp` n'a pas été essayé sur ce projet.** Les commandes viennent de la documentation de la version 3 de `clasp`. La mise en place demande une connexion à un compte Google, qui ne peut être faite que par son propriétaire.
- **Le déploiement n'est pas automatique.** GitHub lance les tests, mais n'envoie rien vers Apps Script. L'automatiser demanderait de confier des identifiants Google à GitHub, ce qui n'est pas souhaitable sans y avoir réfléchi.
- **Les tests restent ceux de la fiche 05**, avec leurs limites : une coche verte ne prouve pas que le déploiement fonctionne.

## Comment vérifier

- En local : `npm test` doit se terminer par `17 tests réussis.`
- Sur GitHub : onglet **Actions** du dépôt, ou la coche à côté du dernier commit de `develop`.

## Questions possibles du jury

- **Qu'est-ce que l'intégration continue ?** Vérifier automatiquement chaque modification dès qu'elle est partagée, pour détecter une erreur au moment où elle est introduite.
- **Quelle différence avec le déploiement continu ?** Le déploiement continu met aussi en production automatiquement. Ici, seule la vérification est automatique ; la mise en production reste une décision humaine.
- **Pourquoi versionner le manifeste ?** Parce qu'il fait partie du programme : sans lui, deux installations du même code peuvent se comporter différemment.
- **Pourquoi ne pas versionner `.clasp.json` ?** Il désigne un environnement, pas le programme. Le versionner ferait envoyer par erreur le code d'un contributeur dans la production.
- **Comment séparez-vous test et production ?** Par deux projets Apps Script et deux classeurs distincts, avec le même code. Seul l'identifiant dans `.clasp.json` change.
