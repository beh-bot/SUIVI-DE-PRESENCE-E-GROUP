// Test de bout en bout du code serveur (.gs) SANS Google : les services Apps Script
// (SpreadsheetApp, PropertiesService, LockService…) sont remplacés par des imitations en mémoire.
// Lancer depuis la racine du dépôt :   node tests/simulation.cjs
// Ce test ne remplace pas un essai dans le vrai déploiement, il attrape les régressions de logique.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { creerEnvironnement, racine } = require('./faux-google.cjs');

const { S, noms, feuilles, classeurs, declencheurs, proprietes, cache, verrou, alertes, contexte, compteurs } = creerEnvironnement();

let nbTests = 0;
function test(nom, fn) {
  try { fn(); nbTests++; console.log('  ok  ' + nom); }
  catch (e) { console.error('ÉCHEC ' + nom + '\n' + (e.stack || e)); process.exit(1); }
}
const echoue = (fn, motif) => assert.throws(fn, (e) => motif.test(e.message), 'erreur attendue : ' + motif);

// ── Scénario ────────────────────────────────────────────────────────────
console.log('Simulation du serveur Apps Script');

test('seules les fonctions prévues sont appelables depuis le navigateur', () => {
  const publiques = noms.filter((n) => !n.endsWith('_')).sort();
  const html = fs.readFileSync(path.join(racine, 'Index.html'), 'utf8');
  // Appels directs api('nom', …) / appel('nom', …), et indirects exporterPdf(el, 'nom').
  const appelees = new Set([...html.matchAll(/(?:api|appel|exporterPdf)\((?:el, )?'(\w+)'/g)].map((m) => m[1]));
  const horsEcran = [
    'doGet', 'onOpen', // réservées par Google
    'initialiserFeuilles', 'creerAdministrateurDepuisMenu', 'reparerDonnees', // menu Google Sheets
    'sauvegarderMaintenant', 'activerSauvegardeAutomatique', 'desactiverSauvegardeAutomatique', // menu Google Sheets
    'sauvegardeAutomatique', // déclencheur nocturne (protégée par ses propres garde-fous, testés plus bas)
  ];
  const inattendues = publiques.filter((n) => !appelees.has(n) && !horsEcran.includes(n));
  assert.deepStrictEqual(inattendues, [], 'fonctions publiques non utilisées par l\'écran (ajoutez « _ » à leur nom)');
  [...appelees].forEach((n) => assert(publiques.includes(n), 'l\'écran appelle une fonction absente : ' + n));
});

test('les scripts de Index.html sont syntaxiquement valides', () => {
  const html = fs.readFileSync(path.join(racine, 'Index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert(scripts.length >= 1, 'aucun script trouvé dans Index.html');
  scripts.forEach((s) => new Function(s[1])); // lève une SyntaxError si le script est invalide
});

test('le déploiement par clasp envoie exactement les fichiers de l\'application', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(racine, 'appsscript.json'), 'utf8'));
  assert.strictEqual(manifeste.runtimeVersion, 'V8', 'le code utilise une syntaxe qui exige le moteur V8');
  const autorises = fs.readFileSync(path.join(racine, '.claspignore'), 'utf8').split(/\r?\n/)
    .filter((l) => l.startsWith('!')).map((l) => l.slice(1)).sort();
  const attendus = fs.readdirSync(racine).filter((f) => /\.(gs|html)$/.test(f)).concat('appsscript.json').sort();
  assert.deepStrictEqual(autorises, attendus, '.claspignore doit lister chaque fichier .gs et .html de la racine, et rien d\'autre');
});

test('initialisation des feuilles, refusée hors de Google Sheets', () => {
  contexte.dansSheets = false;
  echoue(() => S.initialiserFeuilles(), /getUi/);
  assert.strictEqual(Object.keys(feuilles).length, 0);
  contexte.dansSheets = true;
  S.initialiserFeuilles();
  assert.strictEqual(Object.keys(feuilles).length, 7);
  contexte.dansSheets = false;
});

proprietes.WHATSAPP_DRY_RUN = 'true';
let admin, prof, eleve, seance;

test('création du premier administrateur et connexion', () => {
  S.creerCompteInterne_('Awa Admin', 'awa.admin', 'motdepasse1', 'admin');
  echoue(() => S.creerCompteInterne_('Autre', 'AWA.admin', 'motdepasse1', 'admin'), /déjà utilisé/);
  admin = S.connexion(' Awa.Admin ', 'motdepasse1');
  assert.strictEqual(admin.role, 'admin');
  assert.strictEqual(S.moi(admin.jeton).nom, 'Awa Admin');
  assert(feuilles.Utilisateurs.getRange(2, 4, 1, 1).getValues()[0][0].startsWith('pbkdf2$'));
});

test('blocage après 5 mots de passe faux', () => {
  for (let i = 0; i < 5; i++) echoue(() => S.connexion('awa.admin', 'faux' + i), /incorrect/);
  echoue(() => S.connexion('awa.admin', 'motdepasse1'), /Trop de tentatives/);
  Object.keys(cache).forEach((k) => delete cache[k]); // le blocage expire
  S.connexion('awa.admin', 'motdepasse1');
});

test('ancien hash SHA-256 accepté puis converti', () => {
  const sel = 'ancien-sel';
  const ancien = crypto.createHash('sha256').update('vieuxmotdepasse' + sel).digest('hex');
  S.inserer_(S.FEUILLES.UTILISATEURS, { nom: 'Vieux Compte', email: 'vieux', mdp_hash: ancien, mdp_sel: sel, role: 'enseignant', actif: true });
  const v = S.connexion('vieux', 'vieuxmotdepasse');
  const stocke = S.trouverParId_(S.FEUILLES.UTILISATEURS, v.id).mdp_hash;
  assert(stocke.startsWith('pbkdf2$'), 'hash non converti');
  S.connexion('vieux', 'vieuxmotdepasse');
});

test('invitation à usage unique', () => {
  const inv = S.creerInvitation(admin.jeton, { nom: 'Koné Adama', role: 'enseignant' });
  assert(inv.lien.endsWith('?invitation=' + inv.id));
  assert.strictEqual(S.infoInvitation(inv.id).role, 'enseignant');
  prof = S.accepterInvitation(inv.id, { nom: 'Koné Adama', email: 'kone.adama', mot_de_passe: 'motdepasse2' });
  assert.strictEqual(prof.role, 'enseignant');
  echoue(() => S.accepterInvitation(inv.id, { nom: 'X Y', email: 'autre', mot_de_passe: 'motdepasse3' }), /invalide/);
});

test('droits : un encadreur ne peut pas administrer, un jeton faux est refusé', () => {
  echoue(() => S.listerEleves(prof.jeton), /réservée/);
  echoue(() => S.creerSeance(prof.jeton, {}), /réservée/);
  echoue(() => S.listerEleves('jeton-invente'), /SESSION_EXPIREE/);
  echoue(() => S.listerEleves(undefined), /SESSION_EXPIREE/);
});

test('élèves et séance', () => {
  eleve = S.creerEleve(admin.jeton, { nom: 'Bamba', prenom: 'Issa', classe: '3e A', parent_nom: 'Mme Bamba', parent_whatsapp: '00225 07 00 00 00 01' });
  assert.strictEqual(eleve.parent_whatsapp, '+2250700000001');
  S.creerEleve(admin.jeton, { nom: 'Yao', prenom: 'Aya', classe: '3e A', parent_nom: 'M. Yao', parent_whatsapp: '+2250700000002' });
  S.creerEleve(admin.jeton, { nom: 'Diallo', prenom: 'Moussa', classe: '4e B', parent_nom: 'M. Diallo', parent_whatsapp: '+2250700000003' });
  echoue(() => S.creerEleve(admin.jeton, { nom: 'X', prenom: 'Y', classe: 'Z', parent_nom: 'P', parent_whatsapp: '0700' }), /invalide/);
  seance = S.creerSeance(admin.jeton, { matiere: 'Mathématiques', date_seance: '2026-11-16', heure_debut: '08:30', classe: '3e A', enseignant_id: prof.id });
  assert.strictEqual(seance.enseignant_nom, 'Koné Adama');
  assert.deepStrictEqual(S.listerClasses(prof.jeton), ['3e A', '4e B']);
  assert.strictEqual(S.listerSeances(prof.jeton, {})[0].attendus, 2);
});

test('pointage : une seule ligne par élève, notification unique', () => {
  const l1 = S.pointerEleve(prof.jeton, seance.id, eleve.id, 'present', '');
  assert.strictEqual(l1.statut, 'present');
  assert.strictEqual(l1.notif_statut, null);
  const l2 = S.pointerEleve(prof.jeton, seance.id, eleve.id, 'absent', 'Malade');
  assert.strictEqual(l2.statut, 'absent');
  assert.strictEqual(l2.motif, 'Malade');
  assert.strictEqual(l2.notif_statut, 'envoye');
  // Corriger le motif ne doit pas changer l'heure du pointage d'origine.
  S.mettreAJour_(S.FEUILLES.PRESENCES, S.versObjets_(S.FEUILLES.PRESENCES)[0].id, { horodatage: '2026-11-16T08:31:00.000Z' });
  const l3 = S.pointerEleve(prof.jeton, seance.id, eleve.id, 'absent', 'Malade (certificat)');
  assert.strictEqual(l3.motif, 'Malade (certificat)');
  assert.strictEqual(l3.horodatage, '2026-11-16T08:31:00.000Z');
  assert.strictEqual(S.versObjets_(S.FEUILLES.PRESENCES).length, 1);
  assert.strictEqual(S.versObjets_(S.FEUILLES.NOTIFICATIONS).length, 1);
  assert.strictEqual(S.versObjets_(S.FEUILLES.NOTIFICATIONS)[0].tentatives, 1);
  const autre = S.versObjets_(S.FEUILLES.ELEVES).find((e) => e.classe === '4e B');
  echoue(() => S.pointerEleve(prof.jeton, seance.id, autre.id, 'present', ''), /n'appartient pas/);
  assert(!verrou.tenu, 'verrou non rendu');
});

test('une séance d\'un autre encadreur est inaccessible', () => {
  const s2 = S.creerSeance(admin.jeton, { matiere: 'Français', date_seance: '2026-11-16', heure_debut: '10:00', classe: '3e A' });
  echoue(() => S.ouvrirPointage(prof.jeton, s2.id), /pas attribuée/);
  echoue(() => S.pointerEleve(prof.jeton, s2.id, eleve.id, 'present', ''), /pas attribuée/);
  echoue(() => S.exporterPdfSeance(prof.jeton, s2.id), /pas attribuée/);
  S.supprimerSeance(admin.jeton, s2.id);
});

test('une feuille n\'est lue qu\'une fois par requête hors verrou', () => {
  const avant = feuilles.Eleves.lectures;
  S.versObjets_(S.FEUILLES.ELEVES); S.versObjets_(S.FEUILLES.ELEVES); S.trouverParId_(S.FEUILLES.ELEVES, eleve.id);
  assert(feuilles.Eleves.lectures - avant <= 1);
  const lu = S.versObjets_(S.FEUILLES.ELEVES);
  lu[0].nom = 'MODIFIÉ PAR ERREUR';
  assert.notStrictEqual(S.versObjets_(S.FEUILLES.ELEVES)[0].nom, 'MODIFIÉ PAR ERREUR', 'le cache ne doit pas être modifiable par l\'appelant');
});

test('tableau de bord, historique et exports', () => {
  const t = S.tableauDeBord(admin.jeton, null);
  assert.deepStrictEqual(t.global, { presents: 0, total: 1, taux: 0 });
  assert.strictEqual(t.plusAbsents[0].absences, 1);
  const h = S.historiqueEleve(admin.jeton, eleve.id);
  assert.strictEqual(h.absences, 1);
  const csv = S.exporterCsvSeance(admin.jeton, seance.id);
  assert(csv.includes('"Bamba";"Issa"') && csv.includes('"Non pointé"'));
  assert(S.exporterPdfSeance(prof.jeton, seance.id).nom.endsWith('.pdf'));
  assert(S.exporterPdfEleve(admin.jeton, eleve.id).base64.length > 0);
  assert.strictEqual(S.listerNotifications(admin.jeton, 'envoye').length, 1);
});

test('changement de mot de passe : les autres sessions sont coupées', () => {
  const autreAppareil = S.connexion('kone.adama', 'motdepasse2');
  S.changerMonMotDePasse(prof.jeton, 'motdepasse2', 'nouveaupasse9');
  echoue(() => S.moi(autreAppareil.jeton), /SESSION_EXPIREE/);
  S.moi(prof.jeton);
  echoue(() => S.connexion('kone.adama', 'motdepasse2'), /incorrect/);
});

test('suppression d\'un compte avec transfert des séances', () => {
  assert.strictEqual(S.supprimerUtilisateur(admin.jeton, prof.id, null).code, 'SEANCES_ATTRIBUEES');
  echoue(() => S.supprimerUtilisateur(admin.jeton, admin.id, null), /propre compte/);
  const rep = S.supprimerUtilisateur(admin.jeton, prof.id, admin.id);
  assert.strictEqual(rep.seances_reattribuees, 1);
  echoue(() => S.moi(prof.jeton), /SESSION_EXPIREE/);
  echoue(() => S.connexion('kone.adama', 'nouveaupasse9'), /incorrect/);
});

test('un classeur installé avant la mise à jour reçoit la nouvelle colonne', () => {
  // On retire l'en-tête et les valeurs de la colonne supprime_le, comme dans un classeur d'avant la corbeille.
  const f = feuilles.Eleves;
  const colonne = S.FEUILLES.ELEVES.entetes.indexOf('supprime_le') + 1;
  f.getRange(1, colonne, f.getLastRow(), 1).setValues(Array.from({ length: f.getLastRow() }, () => ['']));
  S.inserer_(S.FEUILLES.PRESENCES, { seance_id: 'x', eleve_id: 'x', statut: 'present' }); // une écriture ailleurs vide le cache
  S.supprimerToutesLignesOu_(S.FEUILLES.PRESENCES, (p) => p.seance_id === 'x');
  assert.strictEqual(S.listerEleves(admin.jeton).length, 3, 'sans la colonne, tous les élèves restent actifs');
  assert.strictEqual(f.getRange(1, colonne, 1, 1).getValues()[0][0], 'supprime_le', 'en-tête non ajouté');
});

test('corbeille : un élève supprimé garde son historique et peut être rétabli', () => {
  S.supprimerEleve(admin.jeton, eleve.id);
  assert.strictEqual(S.listerEleves(admin.jeton).length, 2);
  assert.strictEqual(S.versObjets_(S.FEUILLES.PRESENCES).length, 1, 'le pointage doit être conservé');
  echoue(() => S.supprimerEleve(admin.jeton, eleve.id), /introuvable/);
  echoue(() => S.pointerEleve(admin.jeton, seance.id, eleve.id, 'present', ''), /introuvable/);
  echoue(() => S.modifierEleve(admin.jeton, eleve.id, { nom: 'A', prenom: 'B', classe: 'C', parent_nom: 'D', parent_whatsapp: '+2250700000009' }), /introuvable/);
  // L'ancienne feuille de présence ne change pas : l'élève pointé y figure toujours ; l'autre élève de la classe aussi.
  const lignes = S.ouvrirPointage(admin.jeton, seance.id).eleves;
  assert.strictEqual(lignes.length, 2);
  assert.strictEqual(lignes.find((l) => l.id === eleve.id).statut, 'absent');
  assert.strictEqual(S.listerSeances(admin.jeton, {})[0].attendus, 2);
  // Une nouvelle séance ne l'attend plus.
  const nouvelle = S.creerSeance(admin.jeton, { matiere: 'Anglais', date_seance: '2026-11-17', heure_debut: '09:00', classe: '3e A' });
  assert.strictEqual(S.ouvrirPointage(admin.jeton, nouvelle.id).eleves.length, 1);
  assert.strictEqual(S.tableauDeBord(admin.jeton, null).plusAbsents.length, 0, 'un élève de la corbeille ne figure plus au tableau de bord');
  assert.strictEqual(S.listerNotifications(admin.jeton, null).length, 0);
  assert.strictEqual(S.historiqueEleve(admin.jeton, eleve.id).absences, 1, 'son historique reste consultable');
  const c = S.listerCorbeille(admin.jeton);
  assert.deepStrictEqual([c.eleves.length, c.eleves[0].nb_pointages, c.seances.length], [1, 1, 1]); // la séance « Français » supprimée plus haut y est aussi
  echoue(() => S.listerCorbeille(prof.jeton), /SESSION_EXPIREE/); // compte supprimé plus haut
  S.restaurerEleve(admin.jeton, eleve.id);
  echoue(() => S.restaurerEleve(admin.jeton, eleve.id), /introuvable/);
  assert.strictEqual(S.listerEleves(admin.jeton).length, 3);
  assert.strictEqual(S.tableauDeBord(admin.jeton, null).plusAbsents.length, 1);
});

test('corbeille : une séance supprimée ne compte plus, puis revient intacte', () => {
  S.supprimerSeance(admin.jeton, seance.id);
  assert.strictEqual(S.listerSeances(admin.jeton, {}).some((s) => s.id === seance.id), false);
  echoue(() => S.ouvrirPointage(admin.jeton, seance.id), /introuvable/);
  echoue(() => S.exporterPdfSeance(admin.jeton, seance.id), /introuvable/);
  assert.strictEqual(S.tableauDeBord(admin.jeton, null).global.total, 0);
  assert.strictEqual(S.historiqueEleve(admin.jeton, eleve.id).total, 0);
  assert.strictEqual(S.listerCorbeille(admin.jeton).seances[0].nb_pointages, 1);
  S.restaurerSeance(admin.jeton, seance.id);
  assert.strictEqual(S.tableauDeBord(admin.jeton, null).global.total, 1);
  assert.strictEqual(S.ouvrirPointage(admin.jeton, seance.id).eleves.length, 2);
});

test('sauvegarde manuelle : une copie fidèle dans un autre classeur', () => {
  contexte.dansSheets = false;
  echoue(() => S.sauvegarderMaintenant(), /getUi/);
  assert.strictEqual(Object.keys(classeurs).length, 1);
  contexte.dansSheets = true;
  S.sauvegarderMaintenant();
  contexte.dansSheets = false;
  const copie = Object.values(classeurs).find((c) => c.getId() !== 'classeur-test');
  assert(copie && copie.getName().includes('manuelle'), alertes[alertes.length - 1]);
  assert.deepStrictEqual(Object.keys(copie.feuilles).sort(), Object.keys(feuilles).sort());
  Object.keys(feuilles).forEach((n) => {
    assert.deepStrictEqual(copie.feuilles[n].getDataRange().getValues(), feuilles[n].getDataRange().getValues(), 'feuille ' + n + ' différente');
  });
  // La copie est indépendante : modifier l'original ne la touche pas.
  const avant = JSON.stringify(copie.feuilles.Eleves.getDataRange().getValues());
  S.creerEleve(admin.jeton, { nom: 'Après', prenom: 'Sauvegarde', classe: '3e A', parent_nom: 'P', parent_whatsapp: '+2250700000010' });
  assert.strictEqual(JSON.stringify(copie.feuilles.Eleves.getDataRange().getValues()), avant);
  assert(!verrou.tenu);
});

test('sauvegarde automatique : inactive par défaut, une fois par jour, classeur réutilisé', () => {
  const nb = () => Object.keys(classeurs).length;
  const depart = nb();
  S.sauvegardeAutomatique(); // appel depuis le navigateur alors que rien n'est activé : sans effet
  assert.strictEqual(nb(), depart);
  contexte.dansSheets = true;
  S.activerSauvegardeAutomatique();
  S.activerSauvegardeAutomatique(); // deux activations ne créent pas deux déclencheurs
  contexte.dansSheets = false;
  assert.strictEqual(declencheurs.length, 1);
  S.sauvegardeAutomatique();
  assert.strictEqual(nb(), depart + 1);
  S.sauvegardeAutomatique(); // moins de 20 h après : sans effet
  assert.strictEqual(nb(), depart + 1);
  proprietes.SAUVEGARDE_DERNIERE_MS = String(Date.now() - 7 * 864e5); // une semaine plus tard, même jour de la semaine
  S.creerEleve(admin.jeton, { nom: 'Nouveau', prenom: 'Venu', classe: '3e A', parent_nom: 'P', parent_whatsapp: '+2250700000011' });
  S.sauvegardeAutomatique();
  assert.strictEqual(nb(), depart + 1, 'le classeur du même jour doit être réécrit, pas recréé');
  const idJour = Object.keys(proprietes).filter((k) => k.startsWith('SAUVEGARDE_JOUR_')).map((k) => proprietes[k]);
  assert.strictEqual(idJour.length, 1);
  assert.deepStrictEqual(classeurs[idJour[0]].feuilles.Eleves.getDataRange().getValues(), feuilles.Eleves.getDataRange().getValues());
  contexte.dansSheets = true;
  S.desactiverSauvegardeAutomatique();
  contexte.dansSheets = false;
  assert.strictEqual(declencheurs.length, 0);
  proprietes.SAUVEGARDE_DERNIERE_MS = '0';
  S.sauvegardeAutomatique();
  assert.strictEqual(nb(), depart + 1);
});

test('suppression définitive : seulement depuis la corbeille, avec les pointages', () => {
  echoue(() => S.supprimerEleveDefinitivement(admin.jeton, eleve.id), /corbeille/);
  echoue(() => S.supprimerSeanceDefinitivement(admin.jeton, seance.id), /corbeille/);
  S.supprimerEleve(admin.jeton, eleve.id);
  S.supprimerEleveDefinitivement(admin.jeton, eleve.id);
  assert.strictEqual(S.versObjets_(S.FEUILLES.PRESENCES).length, 0);
  assert.strictEqual(S.versObjets_(S.FEUILLES.NOTIFICATIONS).length, 0);
  assert.strictEqual(S.trouverParId_(S.FEUILLES.ELEVES, eleve.id), null);
  S.supprimerSeance(admin.jeton, seance.id);
  S.supprimerSeanceDefinitivement(admin.jeton, seance.id);
  assert.strictEqual(S.trouverParId_(S.FEUILLES.SEANCES, seance.id), null);
  assert(!verrou.tenu && verrou.prises > 0);
});

test('import d\'élèves : séparateurs, guillemets, titres, doublons, tout ou rien', () => {
  assert.deepStrictEqual(S.analyserCsv_('a;"b;c";"d ""e"""\r\n\r\nf;g;h'), [['a', 'b;c', 'd "e"'], ['f', 'g', 'h']]);
  assert.deepStrictEqual(S.analyserCsv_('a\tb, c\nd\te'), [['a', 'b, c'], ['d', 'e']]);
  const avant = S.listerEleves(admin.jeton).length;
  const liste = [
    'Nom;Prénom;Classe;Parent;WhatsApp',
    'Konan;Akissi;6e Z;Mme Konan;+225 07 00 00 01 01',
    '"Touré";"Ali";6e Z;"M. Touré; père";002250700000102',
    'Yao;Aya;3e A;M. Yao;+2250700000002', // déjà enregistrée
    'Konan;akissi;6e Z;Mme Konan;+2250700000101', // doublon dans la liste
  ].join('\n');
  // Une ligne fausse : rien n'est écrit, et la ligne est désignée par son numéro dans le texte.
  const rate = S.importerEleves(admin.jeton, liste + '\nSeul;Nom\nBah;Awa;6e Z;Mme Bah;0700', false);
  assert.strictEqual(rate.ok, false);
  assert.deepStrictEqual(rate.erreurs.map((e) => e.ligne), [6, 7]);
  assert.strictEqual(S.listerEleves(admin.jeton).length, avant);
  // Simulation : le bilan sans écrire.
  const bilan = S.importerEleves(admin.jeton, liste, true);
  assert.deepStrictEqual([bilan.ok, bilan.ajoutes, bilan.ignores, bilan.classes], [true, 2, 2, [{ classe: '6e Z', nb: 2 }]]);
  assert.strictEqual(S.listerEleves(admin.jeton).length, avant);
  // Import réel, en une seule écriture.
  const prises = verrou.prises;
  assert.strictEqual(S.importerEleves(admin.jeton, liste, false).ajoutes, 2);
  assert.strictEqual(verrou.prises, prises + 2); // une prise pour l'import, une pour la ligne de journal
  const importes = S.listerEleves(admin.jeton).filter((e) => e.classe === '6e Z');
  assert.deepStrictEqual(importes.map((e) => [e.nom, e.parent_nom, e.parent_whatsapp]),
    [['Konan', 'Mme Konan', '+2250700000101'], ['Touré', 'M. Touré; père', '+2250700000102']]);
  assert(importes.every((e) => e.id && e.cree_le && !e.supprime_le));
  assert.strictEqual(S.importerEleves(admin.jeton, liste, false).ajoutes, 0, 'un second import ne duplique rien');
  echoue(() => S.importerEleves(admin.jeton, '  ', false), /vide/);
  echoue(() => S.importerEleves(admin.jeton, 'Nom;Prénom', false), /aucun élève/);
  echoue(() => S.importerEleves('faux-jeton', liste, false), /SESSION_EXPIREE/);
});

test('« les autres sont présents » : ne touche pas les élèves déjà pointés', () => {
  const s = S.creerSeance(admin.jeton, { matiere: 'Histoire', date_seance: '2026-11-18', heure_debut: '14:00', classe: '6e Z' });
  const [konan, toure] = S.ouvrirPointage(admin.jeton, s.id).eleves;
  S.creerEleve(admin.jeton, { nom: 'Zadi', prenom: 'Luc', classe: '6e Z', parent_nom: 'M. Zadi', parent_whatsapp: '+2250700000103' });
  S.pointerEleve(admin.jeton, s.id, konan.id, 'absent', 'Malade');
  const notifs = S.versObjets_(S.FEUILLES.NOTIFICATIONS).length;
  const rep = S.pointerRestantsPresents(admin.jeton, s.id);
  assert.strictEqual(rep.nb_pointes, 2);
  assert.deepStrictEqual(rep.eleves.map((e) => e.statut), ['absent', 'present', 'present']);
  assert.strictEqual(rep.eleves.find((e) => e.id === konan.id).motif, 'Malade');
  assert.strictEqual(S.versObjets_(S.FEUILLES.NOTIFICATIONS).length, notifs, 'aucun message ne doit partir');
  assert.strictEqual(S.pointerRestantsPresents(admin.jeton, s.id).nb_pointes, 0);
  assert.strictEqual(S.versObjets_(S.FEUILLES.PRESENCES).filter((p) => p.seance_id === s.id).length, 3);
  assert(toure.id && !verrou.tenu);
  seance = s;
});

test('modification d\'une séance : les pointages sont conservés, la classe est figée', () => {
  const maj = S.modifierSeance(admin.jeton, seance.id, { matiere: 'Histoire-Géographie', date_seance: '2026-11-19', heure_debut: '15:30', classe: '6e Z', enseignant_id: admin.id });
  assert.deepStrictEqual([maj.matiere, maj.date_seance, maj.heure_debut, maj.enseignant_nom], ['Histoire-Géographie', '2026-11-19', '15:30', 'Awa Admin']);
  assert.strictEqual(S.ouvrirPointage(admin.jeton, seance.id).eleves.filter((e) => e.statut).length, 3);
  echoue(() => S.modifierSeance(admin.jeton, seance.id, { matiere: 'X', date_seance: '2026-11-19', heure_debut: '15:30', classe: '3e A' }), /classe ne peut plus/);
  echoue(() => S.modifierSeance(admin.jeton, seance.id, { matiere: 'X', date_seance: '19/11/2026', heure_debut: '15:30', classe: '6e Z' }), /invalide/);
  echoue(() => S.modifierSeance(admin.jeton, seance.id, { matiere: 'X', date_seance: '2026-11-19', heure_debut: '15:30', classe: '6e Z', enseignant_id: prof.id }), /Encadreur introuvable/);
  echoue(() => S.modifierSeance(admin.jeton, 'inconnue', {}), /introuvable/);
  // Sans pointage, la classe peut encore être corrigée.
  const vide = S.creerSeance(admin.jeton, { matiere: 'EPS', date_seance: '2026-11-20', heure_debut: '08:00', classe: '6e Y' });
  assert.strictEqual(S.modifierSeance(admin.jeton, vide.id, { matiere: 'EPS', date_seance: '2026-11-20', heure_debut: '08:00', classe: '6e Z' }).classe, '6e Z');
  assert.strictEqual(S.trouverParId_(S.FEUILLES.SEANCES, vide.id).enseignant_id, admin.id, 'sans encadreur fourni, celui de la séance est gardé');
});

test('connexion : un identifiant inconnu coûte autant de calcul qu\'un mot de passe faux', () => {
  const cout = (identifiant) => {
    Object.keys(cache).forEach((k) => delete cache[k]);
    const avant = compteurs.hmac;
    echoue(() => S.connexion(identifiant, 'mauvais-mot-de-passe'), /Identifiant ou mot de passe incorrect/);
    return compteurs.hmac - avant;
  };
  const existant = cout('awa.admin');
  assert(existant >= 2000, 'le mot de passe doit être vérifié par le calcul lent');
  assert.strictEqual(cout('personne.ici'), existant);
  Object.keys(cache).forEach((k) => delete cache[k]);
});

test('sessions : le jeton n\'est pas stocké, seulement son empreinte', () => {
  const s = S.connexion('awa.admin', 'motdepasse1');
  const cles = Object.keys(proprietes).filter((k) => k.startsWith('session_'));
  assert(cles.length >= 1);
  assert(!JSON.stringify(proprietes).includes(s.jeton), 'le jeton apparaît en clair dans les propriétés');
  assert(cles.includes('session_' + crypto.createHash('sha256').update(s.jeton).digest('hex')));
  assert.strictEqual(S.moi(s.jeton).nom, 'Awa Admin');
  // Une session enregistrée à l'ancienne manière (clé = jeton en clair) n'est plus acceptée.
  proprietes['session_ancien-jeton'] = JSON.stringify({ id: admin.id, expire: Date.now() + 60000 });
  echoue(() => S.moi('ancien-jeton'), /SESSION_EXPIREE/);
  echoue(() => S.moi({ toString: () => s.jeton }), /SESSION_EXPIREE/);
  // Changer de mot de passe garde la session courante et coupe l'autre.
  S.changerMonMotDePasse(s.jeton, 'motdepasse1', 'motdepasse1-bis');
  S.moi(s.jeton);
  echoue(() => S.moi(admin.jeton), /SESSION_EXPIREE/);
  S.deconnexion(s.jeton);
  echoue(() => S.moi(s.jeton), /SESSION_EXPIREE/);
  admin = S.connexion('awa.admin', 'motdepasse1-bis');
});

test('journal : les actions sont tracées, sans secret, et lisibles par l\'administrateur seul', () => {
  const journal = S.versObjets_(S.FEUILLES.JOURNAL);
  const actions = journal.map((l) => l.action);
  ['connexion', 'invitation.creer', 'invitation.accepter', 'compte.supprimer', 'compte.mot_de_passe', 'eleve.creer', 'eleve.importer',
    'eleve.corbeille', 'eleve.retablir', 'eleve.effacer', 'seance.creer', 'seance.modifier', 'seance.corbeille', 'seance.retablir', 'seance.effacer',
  ].forEach((a) => assert(actions.includes(a), 'action absente du journal : ' + a));
  const import_ = journal.find((l) => l.action === 'eleve.importer');
  assert.deepStrictEqual([import_.utilisateur_nom, import_.cible, import_.detail], ['Awa Admin', '2 élève(s)', '6e Z : 2']);
  assert(journal.every((l) => l.id && l.horodatage));
  // Ni mot de passe, ni jeton, ni numéro de téléphone dans le journal.
  const brut = JSON.stringify(journal);
  ['motdepasse', 'nouveaupasse9', admin.jeton, '+225'].forEach((secret) => assert(!brut.includes(secret), 'secret dans le journal : ' + secret));
  // Une action refusée ou simulée ne laisse pas de trace.
  const nb = journal.length;
  echoue(() => S.supprimerEleve(admin.jeton, 'inconnu'), /introuvable/);
  S.importerEleves(admin.jeton, 'Sow;Binta;6e Z;Mme Sow;+2250700000199', true);
  assert.strictEqual(S.versObjets_(S.FEUILLES.JOURNAL).length, nb);
  // Lecture : les plus récentes d'abord, pour l'administrateur seulement.
  const enc = S.creerUtilisateur(admin.jeton, { nom: 'Bamba Seydou', email: 'bamba.seydou', mot_de_passe: 'motdepasse5', role: 'enseignant' });
  const lu = S.listerJournal(admin.jeton);
  assert.deepStrictEqual([lu[0].action, lu[0].cible, lu[0].detail], ['compte.creer', 'bamba.seydou', 'enseignant']);
  assert(!('utilisateur_id' in lu[0]));
  echoue(() => S.listerJournal(S.connexion('bamba.seydou', 'motdepasse5').jeton), /réservée/);
  assert(enc.id);
});

test('journal : un classeur sans feuille Journal la reçoit, et une panne du journal ne bloque pas l\'action', () => {
  delete feuilles.Journal;
  const e = S.creerEleve(admin.jeton, { nom: 'Sans', prenom: 'Journal', classe: '6e Z', parent_nom: 'P', parent_whatsapp: '+2250700000198' });
  assert(feuilles.Journal, 'feuille Journal non recréée');
  assert.strictEqual(S.versObjets_(S.FEUILLES.JOURNAL).length, 1);
  // Panne : la feuille Journal refuse toute écriture. L'élève doit quand même être modifié.
  const vraie = feuilles.Journal.getRange;
  feuilles.Journal.getRange = () => { throw new Error('écriture refusée'); };
  const maj = S.modifierEleve(admin.jeton, e.id, { nom: 'Sans', prenom: 'Journal', classe: '6e Y', parent_nom: 'P', parent_whatsapp: '+2250700000198' });
  feuilles.Journal.getRange = vraie;
  assert.strictEqual(maj.classe, '6e Y');
  assert.strictEqual(S.trouverParId_(S.FEUILLES.ELEVES, e.id).classe, '6e Y');
  assert(!verrou.tenu, 'verrou non rendu après la panne');
});

console.log(`${nbTests} tests réussis.`);
