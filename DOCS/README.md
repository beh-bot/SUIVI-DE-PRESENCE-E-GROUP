# Explications des modifications

Ce dossier explique, tâche par tâche, ce qui a été modifié dans le projet depuis la revue du code, pourquoi, et comment le vérifier. Chaque fiche se termine par des questions qu'un jury pourrait poser sur le sujet.

L'ordre de lecture conseillé suit l'ordre des commits de la branche `develop`.

| Fiche | Sujet | Commit |
|---|---|---|
| [01](01-fonctions-internes-privees.md) | Fonctions serveur appelables sans connexion | `a216109` |
| [02](02-mots-de-passe-et-tentatives.md) | Hachage des mots de passe et blocage des tentatives | `7a2681b` |
| [03](03-verrou-et-cache.md) | Écritures simultanées, verrou et cache de lecture | `2ba1d5f` |
| [04](04-correctifs-divers.md) | Horodatage, fuseau horaire, échappement des identifiants | `714bb8a` |
| [05](05-tests-de-simulation.md) | Tests du serveur sans Google | `2ba1d5f` |
| [06](06-apercu-local.md) | Aperçu de l'application dans le navigateur, sans Google | `ebeedb6` |
| [07](07-integration-continue-et-clasp.md) | Tests automatiques sur GitHub et déploiement par clasp | voir l'historique |
| [08](08-corbeille-et-sauvegarde.md) | Corbeille pour les élèves et les séances, sauvegarde du classeur | voir l'historique |
| [Audit 2](audit-2-reste-a-faire.md) | Ce qu'il reste à améliorer | |

Aucune de ces modifications n'a encore été essayée dans un vrai déploiement Apps Script. Elles sont vérifiées par les tests de la fiche 05, qui tournent sur un ordinateur avec de faux services Google.
