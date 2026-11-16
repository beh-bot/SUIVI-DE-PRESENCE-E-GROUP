// ═══════════════════════════════════════════════════════════════════════
// Base de données : chaque feuille du classeur est une table.
// Une ligne = un enregistrement, la première ligne = les en-têtes (noms de colonnes).
// ═══════════════════════════════════════════════════════════════════════

const FEUILLES = {
  UTILISATEURS: { nom: 'Utilisateurs', entetes: ['id', 'nom', 'email', 'mdp_hash', 'mdp_sel', 'role', 'actif', 'cree_le', 'mdp_a_changer'] }, // mdp_a_changer : 'oui' tant que le mot de passe choisi par l'administrateur n'a pas été remplacé par son titulaire
  // supprime_le : vide = actif ; une date = placé dans la corbeille à ce moment (voir actifs_ et la corbeille dans Api.gs).
  ELEVES: { nom: 'Eleves', entetes: ['id', 'nom', 'prenom', 'classe', 'parent_nom', 'parent_whatsapp', 'cree_le', 'supprime_le'] },
  SEANCES: { nom: 'Seances', entetes: ['id', 'matiere', 'date_seance', 'heure_debut', 'classe', 'enseignant_id', 'cree_le', 'supprime_le', 'cloture_le'] }, // cloture_le : date à laquelle l'appel a été terminé (vide = appel en cours)
  PRESENCES: { nom: 'Presences', entetes: ['id', 'seance_id', 'eleve_id', 'statut', 'motif', 'horodatage', 'pointe_par'] },
  INVITATIONS: { nom: 'Invitations', entetes: ['id', 'role', 'nom_suggere', 'expire_le', 'utilise_le', 'cree_par', 'cree_le'] },
  // Journal des actions : qui a fait quoi et quand. On y ajoute des lignes, on n'en modifie jamais (voir journaliser_).
  JOURNAL: { nom: 'Journal', entetes: ['id', 'horodatage', 'utilisateur_id', 'utilisateur_nom', 'action', 'cible', 'detail'] },
  NOTIFICATIONS: { nom: 'Notifications', entetes: ['id', 'seance_id', 'eleve_id', 'telephone', 'statut', 'erreur', 'message_id', 'tentatives', 'cree_le', 'maj_le'] },
};

let classeurEnCache = null;
let cacheFeuilles = {}; // lignes déjà lues pendant cet appel, par nom de feuille (voir versObjets_)
let verrouTenu = false; // vrai pendant une section avecVerrou_ (voir en bas de fichier)

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
  // Les feuilles des invitations et du journal ont été ajoutées après la première version :
  // on les crée automatiquement si elles manquent dans un classeur déjà installé.
  if (!s && (def === FEUILLES.INVITATIONS || def === FEUILLES.JOURNAL)) {
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
    .addSeparator()
    .addItem('Sauvegarder maintenant', 'sauvegarderMaintenant')
    .addItem('Activer la sauvegarde automatique (chaque nuit)', 'activerSauvegardeAutomatique')
    .addItem('Désactiver la sauvegarde automatique', 'desactiverSauvegardeAutomatique')
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
  // Cache valable le temps d'UN appel : une même feuille n'est lue qu'une fois par requête.
  // Il est vidé à chaque écriture et à chaque prise de verrou (voir avecVerrou_), et on renvoie
  // des copies pour qu'un appelant ne puisse pas abîmer les données en cache.
  if (!cacheFeuilles[def.nom]) cacheFeuilles[def.nom] = lireFeuille_(def);
  return cacheFeuilles[def.nom].map((o) => Object.assign({}, o));
}

function lireFeuille_(def) {
  const s = feuille_(def);
  const donnees = s.getDataRange().getValues();
  const entetes = donnees[0].slice();
  // Évolution du schéma : une colonne ajoutée à la fin de def.entetes n'existe pas encore dans un
  // classeur installé avant la mise à jour. On écrit alors son en-tête ici. C'est sans danger même
  // si deux personnes le font en même temps : elles écrivent la même valeur dans la même cellule.
  def.entetes.forEach((h, c) => {
    if (entetes[c] === undefined || entetes[c] === '') {
      s.getRange(1, c + 1, 1, 1).setValues([[h]]);
      entetes[c] = h;
    }
  });
  const lignes = [];
  for (let i = 1; i < donnees.length; i++) {
    if (!donnees[i][0]) continue; // ligne vide : on l'ignore
    const o = {};
    entetes.forEach((h, c) => {
      if (h !== '') o[h] = normaliserValeur_(h, donnees[i][c] === undefined ? '' : donnees[i][c]);
    });
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
  delete cacheFeuilles[def.nom];
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

/** Les lignes qui ne sont pas dans la corbeille (colonne supprime_le vide). Pour les élèves et les séances. */
function actifs_(def) {
  return versObjets_(def).filter((o) => !o.supprime_le);
}

/** Comme trouverParId_, mais renvoie null si la ligne est dans la corbeille. */
function trouverActifParId_(def, id) {
  const o = trouverParId_(def, id);
  return o && !o.supprime_le ? o : null;
}

// Toutes les écritures se font sous verrou, lecture comprise : entre « je lis le numéro de ligne »
// et « j'écris », une autre personne pourrait sinon ajouter ou supprimer une ligne, et l'écriture
// tomberait au mauvais endroit (ou deux ajouts simultanés s'écraseraient).

function inserer_(def, objet) {
  return avecVerrou_(() => {
    const s = feuille_(def);
    const id = objet.id || Utilities.getUuid();
    const complet = Object.assign({ cree_le: nowIso_() }, objet, { id });
    const ligne = def.entetes.map((h) => (complet[h] === undefined ? '' : complet[h]));
    ecrireLigne_(s, s.getLastRow() + 1, def, ligne);
    return Object.assign({}, complet);
  });
}

/**
 * Ajoute plusieurs lignes en une seule écriture. Dans Apps Script, chaque écriture dans le classeur
 * coûte un aller-retour avec Google : écrire 200 lignes une par une prendrait des minutes.
 */
function insererPlusieurs_(def, objets) {
  if (!objets.length) return [];
  return avecVerrou_(() => {
    const s = feuille_(def);
    const maintenant = nowIso_();
    const complets = objets.map((o) => Object.assign({ cree_le: maintenant }, o, { id: o.id || Utilities.getUuid() }));
    const lignes = complets.map((c) => def.entetes.map((h) => (c[h] === undefined ? '' : c[h])));
    const zone = s.getRange(s.getLastRow() + 1, 1, lignes.length, def.entetes.length);
    const formats = formatsLigne_(def)[0];
    zone.setNumberFormats(lignes.map(() => formats));
    zone.setValues(lignes);
    delete cacheFeuilles[def.nom];
    return complets;
  });
}

/**
 * Remplace une valeur par une autre dans toute une colonne, en une seule écriture (lignes de la
 * corbeille comprises). Renvoie le nombre de lignes modifiées.
 */
function remplacerDansColonne_(def, colonne, ancienne, nouvelle) {
  return avecVerrou_(() => {
    const s = feuille_(def);
    const dernier = s.getLastRow();
    const indice = def.entetes.indexOf(colonne);
    if (indice < 0) throw new Error('Colonne inconnue : ' + colonne);
    if (dernier < 2) return 0;
    const zone = s.getRange(2, indice + 1, dernier - 1, 1);
    let nb = 0;
    const valeurs = zone.getValues().map((ligne) => {
      if (String(normaliserValeur_(colonne, ligne[0])) !== ancienne) return ligne;
      nb++;
      return [nouvelle];
    });
    if (nb) {
      zone.setNumberFormat(estColonneTexte_(colonne) ? '@' : 'General');
      zone.setValues(valeurs);
      delete cacheFeuilles[def.nom];
    }
    return nb;
  });
}

function mettreAJour_(def, id, patch) {
  return avecVerrou_(() => {
    const existant = trouverParId_(def, id);
    if (!existant) return null;
    const fusion = Object.assign({}, existant, patch, { id });
    delete fusion.__ligne;
    const ligne = def.entetes.map((h) => (fusion[h] === undefined ? '' : fusion[h]));
    ecrireLigne_(feuille_(def), existant.__ligne, def, ligne);
    return fusion;
  });
}

function supprimerLigne_(def, id) {
  return avecVerrou_(() => {
    const existant = trouverParId_(def, id);
    if (!existant) return false;
    feuille_(def).deleteRow(existant.__ligne);
    delete cacheFeuilles[def.nom];
    return true;
  });
}

/** Supprime toutes les lignes correspondant au filtre (utilisé pour les suppressions en cascade). */
function supprimerToutesLignesOu_(def, filtre) {
  return avecVerrou_(() => {
    const s = feuille_(def);
    // De bas en haut : supprimer une ligne décale les numéros des lignes situées en dessous.
    const correspondantes = versObjets_(def).filter(filtre).sort((a, b) => b.__ligne - a.__ligne);
    correspondantes.forEach((o) => s.deleteRow(o.__ligne));
    delete cacheFeuilles[def.nom];
    return correspondantes.length;
  });
}

/**
 * Ajoute une ligne au journal des actions. « u » est l'utilisateur qui agit, « action » un code
 * court (par exemple 'eleve.creer'), « cible » ce qui est concerné, en clair.
 * Le journal ne doit jamais faire échouer l'action qu'il décrit : elle est déjà faite quand on
 * arrive ici. En cas de problème d'écriture, on le note dans les journaux d'exécution et on continue.
 */
function journaliser_(u, action, cible, detail) {
  try {
    inserer_(FEUILLES.JOURNAL, {
      horodatage: nowIso_(), utilisateur_id: u ? u.id : '', utilisateur_nom: u ? u.nom : '',
      action: action, cible: String(cible || '').slice(0, 200), detail: String(detail || '').slice(0, 300),
    });
  } catch (e) {
    Logger.log('Journal non écrit (' + action + ') : ' + e.message);
  }
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
 * Section critique protégée par un verrou : une seule exécution à la fois peut s'y trouver.
 * À garder courte : ne jamais y mettre un appel réseau (WhatsApp) qui bloquerait les autres
 * utilisateurs pendant ce temps. Réentrant : une fonction déjà sous verrou peut en appeler une
 * autre qui le demande aussi (c'est le cas de inserer_, mettreAJour_, supprimerLigne_…).
 */
function avecVerrou_(fn) {
  if (verrouTenu) return fn();
  const verrou = LockService.getScriptLock();
  try {
    verrou.waitLock(20000);
  } catch (e) {
    throw new Error("L'application est très sollicitée en ce moment. Réessayez dans quelques secondes.");
  }
  verrouTenu = true;
  cacheFeuilles = {}; // ce qu'on a lu avant d'avoir le verrou a pu changer entre-temps
  try {
    return fn();
  } finally {
    verrouTenu = false;
    try {
      SpreadsheetApp.flush(); // les écritures doivent être visibles des autres avant de rendre le verrou
    } finally {
      verrou.releaseLock();
    }
  }
}
