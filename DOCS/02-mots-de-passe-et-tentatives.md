# 02 – Mots de passe et tentatives de connexion

Deux faiblesses de l'authentification ont été corrigées dans `Auth.gs` : un hachage trop rapide et l'absence de limite sur les essais de mot de passe.

## Problème 1 : un hachage trop rapide

Le mot de passe était stocké sous la forme `SHA-256(mot de passe + sel)`. Le sel est une bonne chose : deux comptes ayant le même mot de passe n'ont pas le même hash, et les tables précalculées ne servent à rien.

Mais SHA-256 est conçu pour être rapide. Si la feuille `Utilisateurs` fuit (un partage du classeur par erreur suffit), un attaquant peut essayer des centaines de millions de mots de passe par seconde sur son ordinateur. Un mot de passe de 8 caractères ordinaire ne tient pas longtemps.

### La solution : PBKDF2

PBKDF2 répète un calcul (HMAC-SHA256) un grand nombre de fois, ici 2 000. Vérifier un mot de passe coûte 2 000 fois plus cher, pour l'utilisateur légitime (qui ne le fait qu'une fois) comme pour l'attaquant (qui doit le faire pour chaque essai).

Apps Script ne fournit ni bcrypt ni PBKDF2. La fonction `pbkdf2Hex_` l'implémente donc avec `Utilities.computeHmacSha256Signature`. Son résultat a été comparé à celui de la fonction PBKDF2 de Node (`crypto.pbkdf2Sync`) sur plusieurs entrées : ils sont identiques.

Le hash est stocké dans la colonne `mdp_hash` sous la forme :

```
pbkdf2$2000$3fa1…e9
       │     └ résultat en hexadécimal
       └ nombre d'itérations utilisé pour ce compte
```

### La migration des comptes existants

Il est impossible de convertir un ancien hash, puisqu'on ne connaît pas le mot de passe. La conversion se fait donc à la connexion :

1. `motDePasseValide_` regarde si le hash commence par `pbkdf2$`. Sinon, il le vérifie à l'ancienne manière.
2. Si la connexion réussit et que le hash est à l'ancien format, `connexion` le recalcule en PBKDF2 et le remplace.

Personne n'a rien à faire, et le nombre d'itérations écrit dans chaque hash permet de changer `ITERATIONS_MDP` plus tard sans casser les comptes existants.

### Comparaison en temps constant

`egaliteConstante_` compare deux chaînes sans s'arrêter à la première différence. Une comparaison ordinaire (`===`) répond plus vite quand les premiers caractères diffèrent, ce qui peut en théorie renseigner un attaquant. C'est une précaution classique, de faible portée ici.

## Problème 2 : aucune limite d'essais

On pouvait appeler `connexion` autant de fois qu'on voulait. Un script pouvait donc essayer une liste de mots de passe courants sur un identifiant connu.

### La solution

`connexion` compte les échecs par identifiant dans `CacheService`, une mémoire temporaire d'Apps Script :

- à chaque échec, le compteur de cet identifiant augmente et reste en mémoire 15 minutes ;
- à 5 échecs, la connexion est refusée avec « Trop de tentatives », même avec le bon mot de passe ;
- une connexion réussie remet le compteur à zéro.

La clé du compteur est le SHA-256 de l'identifiant, pour ne pas écrire d'identifiants en clair dans le cache.

## Limites à connaître

- **Vitesse non mesurée dans Apps Script.** Les 2 000 itérations prennent 50 ms sous Node, mais Apps Script est plus lent et le temps réel n'a pas été mesuré. Si la connexion dure plus de 2 ou 3 secondes, il faut baisser `ITERATIONS_MDP`.
- **2 000 itérations restent peu.** Les recommandations actuelles pour PBKDF2-SHA256 sont de plusieurs centaines de milliers. C'est un compromis imposé par la lenteur d'Apps Script, à assumer comme tel.
- **Blocage volontaire.** Quelqu'un qui connaît un identifiant peut le bloquer 15 minutes en se trompant cinq fois exprès. Apps Script ne donne pas l'adresse IP du visiteur, donc on ne peut pas limiter par visiteur.
- **Identifiant inexistant.** Pour un identifiant inconnu, le serveur répond sans calculer de hash, donc plus vite. Un attaquant patient peut en déduire quels identifiants existent. Ce point figure dans l'audit 2.

## Comment vérifier

`node tests/simulation.cjs` couvre : la connexion, le format `pbkdf2$` du hash stocké, le blocage après 5 échecs, et la conversion d'un ancien hash SHA-256.

## Questions possibles du jury

- **Pourquoi ne pas chiffrer les mots de passe ?** Un chiffrement se déchiffre avec une clé, qu'il faudrait stocker quelque part. Un hachage ne s'inverse pas : même l'administrateur ne peut pas retrouver un mot de passe.
- **À quoi sert le sel ?** À ce que deux mots de passe identiques donnent des hashs différents, et à rendre inutiles les tables de hashs précalculées.
- **Pourquoi un hachage lent ?** Parce que le coût est négligeable pour une connexion et multiplié par le nombre d'essais pour un attaquant.
- **Pourquoi pas bcrypt ou Argon2 ?** Ils n'existent pas dans Apps Script, et les écrire en JavaScript serait trop lent. PBKDF2 se construit avec le HMAC que la plateforme fournit.
- **Comment avez-vous migré sans réinitialiser les mots de passe ?** En acceptant les deux formats et en convertissant à la première connexion réussie.
