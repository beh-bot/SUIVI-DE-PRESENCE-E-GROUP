// ═══════════════════════════════════════════════════════════════════════
// Base de données : chaque feuille du classeur est une table.
// Une ligne = un enregistrement, la première ligne = les en-têtes (noms de colonnes).
// ═══════════════════════════════════════════════════════════════════════

const FEUILLES = {
  UTILISATEURS: { nom: 'Utilisateurs', entetes: ['id', 'nom', 'email', 'mdp_hash', 'mdp_sel', 'role', 'actif', 'cree_le'] },
  ELEVES: { nom: 'Eleves', entetes: ['id', 'nom', 'prenom', 'classe', 'parent_nom', 'parent_whatsapp', 'cree_le'] },
  SEANCES: { nom: 'Seances', entetes: ['id', 'matiere', 'date_seance', 'heure_debut', 'classe', 'enseignant_id', 'cree_le'] },
  PRESENCES: { nom: 'Presences', entetes: ['id', 'seance_id', 'eleve_id', 'statut', 'motif', 'horodatage', 'pointe_par'] },
  INVITATIONS: { nom: 'Invitations', entetes: ['id', 'role', 'nom_suggere', 'expire_le', 'utilise_le', 'cree_par', 'cree_le'] },
  NOTIFICATIONS: { nom: 'Notifications', entetes: ['id', 'seance_id', 'eleve_id', 'telephone', 'statut', 'erreur', 'message_id', 'tentatives', 'cree_le', 'maj_le'] },
};

let classeurEnCache = null;

/**
 * Le classeur de données. Dans une application web, « le classeur actif » n'est pas toujours défini :
 * on mémorise donc son identifiant lors de « Initialiser les feuilles » et on l'utilise ensuite.
 */
function classeur_() {
  if (classeurEnCache) return classeurEnCache;
  const id = PropertiesService.getScriptProperties().getProperty('CLASSEUR_ID');
  const c = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!c) {
    throw new Error("Classeur introuvable. Dans Google Sheets, menu « Suivi de présence » > « 1) Initialiser les feuilles ».");
  }
  classeurEnCache = c;
  return c;
}

/** Feuille correspondant à une définition de FEUILLES. Message clair si « Initialiser » n'a pas été lancé. */
function feuille_(def) {
  let s = classeur_().getSheetByName(def.nom);
  // La feuille des invitations a été ajoutée après la première version : on la crée automatiquement si elle manque.
  if (!s && def === FEUILLES.INVITATIONS) {
    s = classeur_().insertSheet(def.nom);
    s.getRange(1, 1, 1, def.entetes.length).setValues([def.entetes]);
    s.setFrozenRows(1);
    appliquerFormatsTexte_(def);
  }
  if (!s) {
    throw new Error(
      `Feuille « ${def.nom} » introuvable. Dans Google Sheets, menu « Suivi de présence » > « 1) Initialiser les feuilles ».`
    );
  }
  return s;
}

// ── Menu (visible dans Google Sheets, pas dans l'application) ───────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Suivi de présence')
    .addItem('1) Initialiser les feuilles', 'initialiserFeuilles')
    .addItem('2) Créer un administrateur', 'creerAdministrateurDepuisMenu')
    .addItem('3) Réparer les données (à lancer après une mise à jour)', 'reparerDonnees')
    .addToUi();
}

/** À lancer une seule fois (ou sans risque plusieurs fois) : crée les feuilles et leurs en-têtes. */
function initialiserFeuilles() {
  const ui = SpreadsheetApp.getUi(); // échoue hors de Google Sheets : cette fonction ne peut pas être lancée depuis l'application web
  // Mémorise le classeur pour que l'application web (qui n'a pas de « classeur actif ») le retrouve.
  PropertiesService.getScriptProperties().setProperty('CLASSEUR_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  Object.keys(FEUILLES).forEach((cle) => {
    const def = FEUILLES[cle];
    let s = classeur_().getSheetByName(def.nom);
    if (!s) s = classeur_().insertSheet(def.nom);
    const premiereLigne = s.getRange(1, 1, 1, def.entetes.length).getValues()[0];
    const dejaOk = def.entetes.every((e, i) => premiereLigne[i] === e);
    if (!dejaOk) {
      s.getRange(1, 1, 1, def.entetes.length).setValues([def.entetes]);
      s.setFrozenRows(1);
    }
    appliquerFormatsTexte_(def);
  });
  // La feuille vide créée par défaut avec un nouveau classeur ne sert à rien : on la retire si elle est seule et vide.
  ['Feuille 1', 'Sheet1'].forEach((nomDefaut) => {
    const d = classeur_().getSheetByName(nomDefaut);
    if (d && classeur_().getSheets().length > 1 && d.getLastRow() === 0) classeur_().deleteSheet(d);
  });
  ui.alert('Feuilles prêtes. Passez maintenant à « 2) Créer un administrateur ».');
}

function creerAdministrateurDepuisMenu() {
  const ui = SpreadsheetApp.getUi();
  const nom = ui.prompt('Créer un administrateur', 'Nom complet :', ui.ButtonSet.OK_CANCEL);
  if (nom.getSelectedButton() !== ui.Button.OK || !nom.getResponseText().trim()) return;
  const email = ui.prompt('Créer un administrateur', 'Identifiant de connexion (sans espace, par exemple : beh.coulibaly) :', ui.ButtonSet.OK_CANCEL);
  if (email.getSelectedButton() !== ui.Button.OK || !email.getResponseText().trim()) return;
  const mdp = ui.prompt(
    'Créer un administrateur',
    "Mot de passe temporaire, 8 caractères minimum.\nATTENTION : il reste visible à l'écran pendant que vous tapez. Changez-le juste après votre première connexion (menu Encadreurs).",
    ui.ButtonSet.OK_CANCEL
  );
  if (mdp.getSelectedButton() !== ui.Button.OK) return;

  try {
    const u = creerCompteInterne_(nom.getResponseText(), email.getResponseText(), mdp.getResponseText(), 'admin');
    ui.alert(`Administrateur créé. Identifiant : ${u.email}\n\nOuvrez maintenant l'application (Déployer > Gérer les déploiements > icône lien) et connectez-vous avec cet identifiant et ce mot de passe.`);
  } catch (e) {
    ui.alert('Erreur : ' + e.message);
  }
}

// ── Lecture / écriture génériques ───────────────────────────────────────

// ── Formats : tout est du TEXTE, sauf ces colonnes ─────────────────────
// Google Sheets transforme tout seul « 2026-10-13 » en date, « 08:30 » en heure, « 6 » en nombre
// et « +225… » en nombre sans le « + ». Or une date ne peut pas être renvoyée au navigateur
// (google.script.run échoue et l'écran reçoit « null »). On force donc le format texte.
const COLONNES_NON_TEXTE = ['actif', 'tentatives'];
const COLONNES_TELEPHONE = ['parent_whatsapp', 'telephone'];

function estColonneTexte_(h) {
  return COLONNES_NON_TEXTE.indexOf(h) === -1;
}

function formatsLigne_(def) {
  return [def.entetes.map((h) => (estColonneTexte_(h) ? '@' : 'General'))];
}

function fuseauClasseur_() {
  return classeur_().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

/** Rend une valeur lue dans la feuille « propre » : jamais de Date ni de nombre là où on attend du texte. */
function normaliserValeur_(h, v) {
  if (!estColonneTexte_(h)) return v;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    const tz = fuseauClasseur_();
    if (h === 'date_seance') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    if (h === 'heure_debut') {
      // Arrondi à la minute : une heure seule est stockée comme une date en 1899, avec parfois quelques secondes d'écart.
      const p = Utilities.formatDate(v, tz, 'HH:mm:ss').split(':').map(Number);
      const total = (p[0] * 60 + p[1] + (p[2] >= 30 ? 1 : 0)) % 1440;
      return ('0' + Math.floor(total / 60)).slice(-2) + ':' + ('0' + (total % 60)).slice(-2);
    }
    return v.toISOString();
  }
  if (typeof v === 'number') {
    const t = String(v);
    return COLONNES_TELEPHONE.indexOf(h) !== -1 && t.charAt(0) !== '+' ? '+' + t : t;
  }
  return v;
}

/** Toutes les lignes d'une feuille sous forme d'objets {colonne: valeur}. __ligne = numéro de ligne réel dans la feuille. */
function versObjets_(def) {
  const s = feuille_(def);
  const donnees = s.getDataRange().getValues();
  const entetes = donnees[0];
  const lignes = [];
  for (let i = 1; i < donnees.length; i++) {
    if (!donnees[i][0]) continue; // ligne vide : on l'ignore
    const o = {};
    entetes.forEach((h, c) => (o[h] = normaliserValeur_(h, donnees[i][c])));
    o.__ligne = i + 1;
    lignes.push(o);
  }
  return lignes;
}

/** Écrit une ligne en imposant le format texte avant l'écriture (sinon Sheets convertit les valeurs). */
function ecrireLigne_(s, numLigne, def, ligne) {
  const zone = s.getRange(numLigne, 1, 1, def.entetes.length);
  zone.setNumberFormats(formatsLigne_(def));
  zone.setValues([ligne]);
}

/** Applique le format texte à toutes les colonnes concernées d'une feuille (lancé par « Initialiser » et « Réparer »). */
function appliquerFormatsTexte_(def) {
  const s = feuille_(def);
  def.entetes.forEach((h, i) => {
    if (estColonneTexte_(h)) s.getRange(1, i + 1, s.getMaxRows(), 1).setNumberFormat('@');
  });
}

/** Menu « 3) Réparer les données » : corrige les formats et réécrit proprement les lignes déjà enregistrées. */
function reparerDonnees() {
  const ui = SpreadsheetApp.getUi();
  try {
    Object.keys(FEUILLES).forEach((cle) => {
      const def = FEUILLES[cle];
      const s = feuille_(def);
      const dernier = s.getLastRow();
      appliquerFormatsTexte_(def);
      if (dernier < 2) return;
      const zone = s.getRange(2, 1, dernier - 1, def.entetes.length);
      const propres = zone.getValues().map((ligne) => ligne.map((v, c) => normaliserValeur_(def.entetes[c], v)));
      zone.setValues(propres);
    });
    ui.alert('Données réparées. Vous pouvez rouvrir l\'application.');
  } catch (e) {
    ui.alert('Erreur : ' + e.message);
  }
}

function trouverParId_(def, id) {
  return versObjets_(def).find((o) => String(o.id) === String(id)) || null;
}

function inserer_(def, objet) {
  const s = feuille_(def);
  const id = objet.id || Utilities.getUuid();
  const complet = Object.assign({ cree_le: nowIso_() }, objet, { id });
  const ligne = def.entetes.map((h) => (complet[h] === undefined ? '' : complet[h]));
  ecrireLigne_(s, s.getLastRow() + 1, def, ligne);
  return Object.assign({}, complet);
}

function mettreAJour_(def, id, patch) {
  const existant = trouverParId_(def, id);
  if (!existant) return null;
  const fusion = Object.assign({}, existant, patch, { id });
  delete fusion.__ligne;
  const ligne = def.entetes.map((h) => (fusion[h] === undefined ? '' : fusion[h]));
  ecrireLigne_(feuille_(def), existant.__ligne, def, ligne);
  return fusion;
}

function supprimerLigne_(def, id) {
  const existant = trouverParId_(def, id);
  if (!existant) return false;
  feuille_(def).deleteRow(existant.__ligne);
  return true;
}

/** Supprime toutes les lignes correspondant au filtre (utilisé pour les suppressions en cascade). */
function supprimerToutesLignesOu_(def, filtre) {
  const s = feuille_(def);
  const correspondantes = versObjets_(def).filter(filtre).sort((a, b) => b.__ligne - a.__ligne);
  correspondantes.forEach((o) => s.deleteRow(o.__ligne));
  return correspondantes.length;
}

function sansLigne_(o) {
  const c = Object.assign({}, o);
  delete c.__ligne;
  return c;
}

function nowIso_() {
  return new Date().toISOString();
}

/**
 * Section critique protégée par un verrou (évite qu'une double vérification email/doublon
 * ou un double pointage simultané ne créent deux lignes). À garder courte : ne jamais y
 * mettre un appel réseau (WhatsApp) qui bloquerait les autres utilisateurs pendant ce temps.
 */
function avecVerrou_(fn) {
  const verrou = LockService.getScriptLock();
  verrou.waitLock(15000);
  try {
    return fn();
  } finally {
    verrou.releaseLock();
  }
}
