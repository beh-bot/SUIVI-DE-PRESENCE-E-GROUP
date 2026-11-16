# 13 – Les messages WhatsApp partent à la fin de l'appel

Jusqu'ici, toucher « Absent » envoyait aussitôt un message au parent. Désormais, rien ne part pendant l'appel : l'encadreur relit sa liste, puis termine l'appel, et c'est ce geste qui prévient les parents.

C'est la seule modification de ce dossier qui change une règle de fonctionnement du centre, et non un défaut technique. Elle a donc été décidée avant d'être codée.

## Le problème

Un appel se fait vite, sur un téléphone, avec deux gros boutons côte à côte. Toucher « Absent » au lieu de « Présent » arrive forcément. Or ce clic envoyait immédiatement un message à un parent, et un message WhatsApp envoyé ne se rappelle pas.

L'encadreur pouvait corriger le pointage dans l'application, mais le parent avait déjà reçu « votre enfant est absent ». Une fausse alerte de ce genre inquiète une famille et entame la confiance dans tous les messages suivants.

## Les trois options examinées

| Option | Avantage | Inconvénient |
|---|---|---|
| Garder l'envoi immédiat | Le parent est prévenu à la seconde | Aucune correction possible |
| Délai d'annulation de quelques minutes | Correction possible, envoi automatique | Demande un déclencheur Google qui passe chaque minute. Apps Script ne sait pas « attendre » dans une exécution |
| Envoi à la fin de l'appel | Aucun message à tort, mécanisme simple | Un appel jamais terminé n'envoie rien |

La troisième a été retenue. Son inconvénient est réel, et il est traité par des rappels visibles (voir plus bas) plutôt que par un automatisme.

## La solution

### Pendant l'appel

`pointerEleve` (`Api.gs`) enregistre le pointage et ne fait rien d'autre. Sous un élève marqué absent, l'écran indique : « Le parent sera prévenu quand vous terminerez l'appel ». On peut passer d'absent à présent autant de fois qu'on veut, sans conséquence.

### À la fin de l'appel

Sous la liste, un encadré rappelle combien de parents restent à prévenir et propose le bouton « Terminer l'appel et prévenir N parents ». Une confirmation rappelle qu'un message envoyé ne peut pas être rappelé, et signale s'il reste des élèves non pointés.

`cloturerAppel` (`Api.gs`) fait alors trois choses :

1. elle cherche les absents de la séance qui n'ont encore aucun message ;
2. elle note la date de fin d'appel dans la nouvelle colonne `cloture_le` de la feuille `Seances` ;
3. elle envoie un message par absent, et renvoie le bilan : envoyés, en échec, non pointés.

### Après la fin de l'appel

L'appel reste modifiable. Si un élève est marqué absent après coup, rien ne part tout seul : l'encadré réapparaît avec un bouton « Prévenir 1 parent ». C'est la même fonction, relancée. Il n'y a donc qu'un seul chemin par lequel un message peut partir, ce qui rend le comportement prévisible.

## Personne ne reçoit deux fois le même message

C'est la propriété la plus importante de `cloturerAppel`, et elle repose sur l'ordre des opérations.

```
┌─ sous verrou ──────────────────────────────────────────────┐
│ 1. lire les absents sans message                            │
│ 2. créer pour chacun une ligne « en cours » dans            │
│    Notifications (une seule écriture)                       │
│ 3. noter la date de fin d'appel                             │
└─────────────────────────────────────────────────────────────┘
┌─ hors verrou ──────────────────────────────────────────────┐
│ 4. envoyer chaque message, puis marquer la ligne            │
│    « envoyé » ou « échoué »                                 │
└─────────────────────────────────────────────────────────────┘
```

Les lignes sont créées **avant** l'envoi, et sous verrou. Si l'encadreur clique deux fois, ou si l'administrateur termine le même appel au même moment, la seconde exécution attend le verrou, puis ne trouve plus aucun absent sans message : elle n'envoie rien. On appelle cela réserver avant d'agir.

Les envois eux-mêmes se font hors verrou, comme l'exige la fiche 03 : un appel réseau de plusieurs secondes ne doit pas bloquer les autres utilisateurs.

L'ancienne fonction `declencherNotificationAbsence_` a été supprimée. Elle créait bien la ligne sous verrou, mais deux exécutions simultanées pouvaient toutes les deux la trouver « en cours » et envoyer chacune le message.

## Ne pas oublier de terminer l'appel

Le risque de cette solution est l'appel laissé ouvert. Trois rappels le rendent visible, tous calculés par `absencesNonSignalees_` :

- dans la séance, l'encadré « N parents n'ont pas encore été prévenus » ;
- dans la liste des séances, la mention « N parents à prévenir » sur chaque séance concernée, pour l'encadreur comme pour l'administrateur ;
- sur l'Accueil de l'administrateur, un bandeau « N séances ont des absences non signalées aux parents ».

Ces rappels ne dépendent pas de la date de fin d'appel, mais de la réalité : existe-t-il un absent sans message ? Un appel terminé auquel on ajoute un absent redevient donc « à prévenir ».

## Les cas particuliers

| Situation | Comportement |
|---|---|
| WhatsApp en panne ou mal configuré | L'appel est quand même terminé. Le message est marqué « échoué » avec la raison, et se renvoie depuis la séance ou la page Messages |
| Message en échec, appel relancé | Il ne repart pas tout seul : il faut le bouton « Renvoyer », pour qu'un échec soit toujours vu par quelqu'un |
| Élève placé dans la corbeille avant la fin de l'appel | Son parent n'est pas prévenu |
| Encadreur à qui la séance n'est pas attribuée | Il ne peut pas terminer l'appel |
| Absent repassé présent avant la fin | Aucun message, aucune trace |
| Absent repassé présent après l'envoi | Le message est déjà parti. Aucun message correctif n'est envoyé |
| Exécution interrompue en plein envoi | Les messages non partis restent « en cours ». Au bout de dix minutes, ils peuvent être renvoyés à la main |

Le dernier cas réglait un défaut signalé par l'audit : un message resté « en cours » n'avait aucun bouton pour repartir. La fonction `envoiBloque_` (`WhatsApp.gs`) reconnaît maintenant un message « en cours » depuis plus de dix minutes.

## Un effet secondaire utile

Un clic « Absent » faisait auparavant un appel réseau vers Meta et deux écritures de plus. Il n'en fait plus aucun : l'appel devient plus rapide, et il ne dépend plus de la disponibilité de WhatsApp. Le temps d'envoi est regroupé à la fin, à un moment où l'encadreur a fini de pointer.

## La mise à jour des classeurs existants

- La colonne `cloture_le` s'ajoute seule à la feuille `Seances`, comme les colonnes des fiches 08 et 11.
- Les anciennes séances n'ont pas de date de fin d'appel, mais leurs absents ont déjà un message. Elles ne sont donc pas signalées « à prévenir », et rien n'est renvoyé.
- **Il faut prévenir les encadreurs avant la mise en production.** Leur geste change : sans « Terminer l'appel », aucun parent n'est prévenu.

## Limites à connaître

- **Rien n'a tourné dans Google, et l'écran n'a pas été vu dans un navigateur.** La fiche 12 contient les étapes pour le vérifier (G3 à G5 quater).
- **Un appel oublié n'envoie rien.** Les rappels le signalent, mais aucun envoi automatique ne rattrape l'oubli, et aucune alerte n'est envoyée à l'administrateur.
- **Le parent est prévenu plus tard qu'avant**, de la durée de l'appel.
- **Beaucoup d'absents d'un coup.** Les messages partent l'un après l'autre dans la même exécution, limitée à six minutes par Google. À raison d'une à deux secondes par message, une classe ordinaire ne pose pas de problème ; une centaine d'absents en poserait un.
- **« Envoyé » veut toujours dire accepté par Meta**, pas reçu par le parent.
- **Pas de message correctif.** Une absence signalée à tort après l'envoi doit être rectifiée par un autre moyen.
- **La date de fin d'appel ne verrouille rien.** Un appel terminé reste modifiable sans limite de temps.

## Comment vérifier

`npm test` couvre : l'absence d'envoi au clic, l'envoi à la fin de l'appel, la relance sans doublon, l'absent ajouté après coup, la panne de WhatsApp, l'élève retiré, les droits, les rappels dans la liste et sur l'Accueil, et le renvoi d'un message resté « en cours ».

## Questions possibles du jury

- **Pourquoi avoir changé le moment de l'envoi ?** Parce qu'une action irréversible ne doit pas être déclenchée par un geste aussi facile à rater qu'un clic sur une liste. On l'a déplacée vers un geste volontaire, précédé d'une relecture et d'une confirmation.
- **Pourquoi ne pas avoir mis un délai d'annulation ?** La plateforme ne permet pas à une exécution d'attendre. Il aurait fallu un traitement périodique, plus fragile et plus difficile à tester, pour un bénéfice proche.
- **Comment garantissez-vous qu'un message ne part pas deux fois ?** En réservant d'abord, sous verrou, une ligne par message, puis en envoyant. Une seconde exécution ne trouve plus rien à réserver.
- **Pourquoi envoyer hors du verrou ?** Un envoi est un appel réseau lent. Le garder sous verrou bloquerait tous les autres utilisateurs pendant ce temps.
- **Que se passe-t-il si le programme s'arrête entre la réservation et l'envoi ?** Le message reste « en cours ». Il n'est pas perdu : il est visible, et renvoyable au bout de dix minutes. On a préféré risquer un message en retard plutôt qu'un message en double.
- **Quel est le défaut de votre solution ?** Elle dépend d'un geste humain : terminer l'appel. On l'a compensé par des rappels, pas supprimé. C'est un compromis assumé entre fiabilité de l'envoi et absence de fausses alertes.
- **Qu'est-ce qu'une opération idempotente ?** Une opération qu'on peut relancer sans en changer le résultat. `cloturerAppel` l'est : la relancer n'envoie que ce qui n'a pas encore été envoyé.
