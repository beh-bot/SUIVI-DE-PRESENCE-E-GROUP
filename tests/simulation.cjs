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

const { S, noms, feuilles, proprietes, cache, verrou, contexte } = creerEnvironnement();

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
  const horsEcran = ['doGet', 'onOpen', 'initialiserFeuilles', 'creerAdministrateurDepuisMenu', 'reparerDonnees'];
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
  assert.strictEqual(Object.keys(feuilles).length, 6);
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

test('suppressions en cascade', () => {
  S.supprimerEleve(admin.jeton, eleve.id);
  assert.strictEqual(S.versObjets_(S.FEUILLES.PRESENCES).length, 0);
  assert.strictEqual(S.versObjets_(S.FEUILLES.NOTIFICATIONS).length, 0);
  assert.strictEqual(S.versObjets_(S.FEUILLES.ELEVES).length, 2);
  S.supprimerSeance(admin.jeton, seance.id);
  assert.strictEqual(S.versObjets_(S.FEUILLES.SEANCES).length, 0);
  assert(!verrou.tenu && verrou.prises > 0);
});

console.log(`${nbTests} tests réussis.`);
