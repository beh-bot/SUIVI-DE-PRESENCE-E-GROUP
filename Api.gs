// ═══════════════════════════════════════════════════════════════════════
// Fonctions appelées depuis le navigateur (google.script.run). Chacune vérifie
// elle-même les droits (exigerConnexion / exigerAdmin) : ne jamais faire confiance
// à ce que cache ou non l'écran, les vérifications ici sont ce qui protège vraiment.
// ═══════════════════════════════════════════════════════════════════════

// ── Validation ────────────────────────────────────────────────────────

function texteRequis(v, libelle, max) {
  const s = (typeof v === 'string' ? v : '').trim().replace(/\s+/g, ' ');
  if (!s) throw new Error(`${libelle} est obligatoire.`);
  if (max && s.length > max) throw new Error(`${libelle} ne doit pas dépasser ${max} caractères.`);
  return s;
}

function telephoneE164(v) {
  let s = (typeof v === 'string' ? v : '').trim().replace(/[\s.\-()]/g, '');
  if (s.indexOf('00') === 0) s = '+' + s.slice(2);
  if (!/^\+[1-9]\d{7,14}$/.test(s)) {
    throw new Error("Numéro WhatsApp invalide. Saisissez-le avec l'indicatif du pays, par exemple +2250700000000.");
  }
  return s;
}

function dateIsoValide(v, libelle) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(`${libelle || 'La date'} est invalide (format AAAA-MM-JJ).`);
  }
  return v;
}

function heureValide(v) {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
    throw new Error("L'heure est invalide (format HH:MM).");
  }
  return v;
}

/** Identifiant de connexion : minuscules, sans espace ; une adresse e-mail reste acceptée. */
function identifiantValide(v) {
  const e = texteRequis(v, "L'identifiant", 60).toLowerCase();
  if (e.length < 3 || !/^[a-z0-9][a-z0-9._@+-]*$/.test(e)) {
    throw new Error("L'identifiant doit faire 3 caractères minimum, sans espace ni accent (lettres, chiffres, point, tiret ou _). Exemple : kone.adama");
  }
  return e;
}

function motDePasseValideFormat(v) {
  if (typeof v !== 'string' || v.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
  return v;
}

// ── Comptes (encadreurs et administrateurs) ─────────────────────────

/** Utilisée par le menu Google Sheets (premier administrateur) ET par creerUtilisateur() ci-dessous. */
function creerCompteInterne(nom, email, motDePasse, role) {
  return avecVerrou(() => creerCompteBrut(nom, email, motDePasse, role));
}

/** Création du compte SANS verrou : à appeler uniquement depuis une section déjà protégée par avecVerrou(). */
function creerCompteBrut(nom, email, motDePasse, role) {
  const n = texteRequis(nom, 'Le nom', 80);
  const e = identifiantValide(email);
  const m = motDePasseValideFormat(motDePasse);
  if (versObjets(FEUILLES.UTILISATEURS).some((u) => String(u.email).toLowerCase() === e && u.actif)) {
    throw new Error('Cet identifiant est déjà utilisé.');
  }
  const paire = hacherMotDePasse(m);
  return inserer(FEUILLES.UTILISATEURS, {
    nom: n, email: e, mdp_hash: paire.hash, mdp_sel: paire.sel, role: role, actif: true,
  });
}

// ── Invitations : lien à usage unique pour qu'un encadreur crée lui-même son compte ──

const DUREE_INVITATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Adresse publique de l'application (celle qui se termine par /exec). */
function urlApplication() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return ''; // autorisation pas encore accordée : l'écran affichera alors la marche à suivre manuelle
  }
}

function lienInvitation(id) {
  const base = urlApplication();
  return base ? base + '?invitation=' + id : '';
}

function invitationActive(inv) {
  return Boolean(inv && !inv.utilise_le && inv.expire_le && new Date(inv.expire_le).getTime() > Date.now());
}

function resumeInvitation(inv) {
  return { id: inv.id, role: inv.role, nom_suggere: inv.nom_suggere || '', expire_le: inv.expire_le, lien: lienInvitation(inv.id) };
}

function creerInvitation(jeton, champs) {
  const u = exigerAdmin(jeton);
  champs = champs || {};
  const role = champs.role === 'admin' ? 'admin' : 'enseignant';
  const nom = champs.nom && String(champs.nom).trim() ? texteRequis(champs.nom, 'Le nom', 80) : '';
  const inv = inserer(FEUILLES.INVITATIONS, {
    role: role, nom_suggere: nom, expire_le: new Date(Date.now() + DUREE_INVITATION_MS).toISOString(), utilise_le: '', cree_par: u.id,
  });
  return resumeInvitation(inv);
}

function listerInvitations(jeton) {
  exigerAdmin(jeton);
  return versObjets(FEUILLES.INVITATIONS)
    .filter(invitationActive)
    .sort((a, b) => String(b.cree_le).localeCompare(String(a.cree_le)))
    .map(resumeInvitation);
}

function revoquerInvitation(jeton, id) {
  exigerAdmin(jeton);
  if (!supprimerLigne(FEUILLES.INVITATIONS, id)) throw new Error('Invitation introuvable.');
  return { ok: true };
}

const MESSAGE_INVITATION_INVALIDE = "Ce lien d'invitation est invalide, déjà utilisé ou expiré. Demandez-en un nouveau à l'administrateur.";

/** Appelée sans connexion par la page d'invitation : indique seulement si le lien est valable et pour quel rôle. */
function infoInvitation(id) {
  const inv = typeof id === 'string' && id ? trouverParId(FEUILLES.INVITATIONS, id) : null;
  if (!invitationActive(inv)) throw new Error(MESSAGE_INVITATION_INVALIDE);
  return { role: inv.role, nom_suggere: inv.nom_suggere || '' };
}

/** Crée le compte, marque l'invitation comme utilisée (une seule fois) et connecte directement la personne. */
function accepterInvitation(id, champs) {
  champs = champs || {};
  const u = avecVerrou(() => {
    const inv = typeof id === 'string' && id ? trouverParId(FEUILLES.INVITATIONS, id) : null;
    if (!invitationActive(inv)) throw new Error(MESSAGE_INVITATION_INVALIDE);
    const compte = creerCompteBrut(champs.nom, champs.email, champs.mot_de_passe, inv.role);
    mettreAJour(FEUILLES.INVITATIONS, inv.id, { utilise_le: nowIso() });
    return compte;
  });
  const jeton = creerSession(u);
  return { jeton: jeton, id: u.id, nom: u.nom, email: u.email, role: u.role };
}

function listerUtilisateurs(jeton) {
  exigerAdmin(jeton);
  const seances = versObjets(FEUILLES.SEANCES);
  return versObjets(FEUILLES.UTILISATEURS)
    .filter((u) => u.actif)
    .map((u) => ({
      id: u.id, nom: u.nom, email: u.email, role: u.role, cree_le: u.cree_le,
      nb_seances: seances.filter((s) => s.enseignant_id === u.id).length,
    }))
    .sort((a, b) => (b.role === 'admin') - (a.role === 'admin') || a.nom.localeCompare(b.nom));
}

function creerUtilisateur(jeton, champs) {
  exigerAdmin(jeton);
  const role = champs.role === 'admin' ? 'admin' : 'enseignant';
  const u = creerCompteInterne(champs.nom, champs.email, champs.mot_de_passe, role);
  return { id: u.id, nom: u.nom, email: u.email, role: u.role };
}

function modifierUtilisateur(jeton, id, champs) {
  const moiCourant = exigerAdmin(jeton);
  const actuel = trouverParId(FEUILLES.UTILISATEURS, id);
  if (!actuel || !actuel.actif) throw new Error('Compte introuvable.');
  const nom = texteRequis(champs.nom, 'Le nom', 80);
  const email = identifiantValide(champs.email);
  const role = champs.role === 'admin' ? 'admin' : 'enseignant';
  if (id === moiCourant.id && role !== 'admin') {
    throw new Error("Vous ne pouvez pas retirer votre propre rôle d'administrateur.");
  }
  if (versObjets(FEUILLES.UTILISATEURS).some((u) => u.actif && u.email === email && u.id !== id)) {
    throw new Error('Cet identifiant est déjà utilisé.');
  }
  const patch = { nom: nom, email: email, role: role };
  if (champs.mot_de_passe) {
    motDePasseValideFormat(champs.mot_de_passe);
    const paire = hacherMotDePasse(champs.mot_de_passe);
    patch.mdp_hash = paire.hash;
    patch.mdp_sel = paire.sel;
  }
  const maj = mettreAJour(FEUILLES.UTILISATEURS, id, patch);
  if (champs.mot_de_passe && id !== moiCourant.id) invaliderSessionsUtilisateur(id);
  return { id: maj.id, nom: maj.nom, email: maj.email, role: maj.role };
}

/**
 * Supprime un compte. S'il a encore des séances attribuées et qu'aucun repreneur n'est indiqué,
 * renvoie { ok:false, code:'SEANCES_ATTRIBUEES', nb_seances } au lieu d'une erreur : le navigateur
 * demande alors qui reprend les séances avant de réessayer avec reassignerA renseigné.
 */
function supprimerUtilisateur(jeton, id, reassignerA) {
  const moiCourant = exigerAdmin(jeton);
  if (id === moiCourant.id) throw new Error('Vous ne pouvez pas supprimer votre propre compte.');
  const u = trouverParId(FEUILLES.UTILISATEURS, id);
  if (!u || !u.actif) throw new Error('Compte introuvable.');

  const seances = versObjets(FEUILLES.SEANCES).filter((s) => s.enseignant_id === id);
  if (seances.length && !reassignerA) {
    return { ok: false, code: 'SEANCES_ATTRIBUEES', nb_seances: seances.length };
  }
  if (seances.length) {
    const repreneur = trouverParId(FEUILLES.UTILISATEURS, reassignerA);
    if (!repreneur || !repreneur.actif || reassignerA === id) throw new Error('Le repreneur choisi est invalide.');
    seances.forEach((s) => mettreAJour(FEUILLES.SEANCES, s.id, { enseignant_id: reassignerA }));
  }
  mettreAJour(FEUILLES.UTILISATEURS, id, { actif: false, email: `supprime-${id}-${u.email}` });
  invaliderSessionsUtilisateur(id);
  return { ok: true, seances_reattribuees: seances.length };
}

// ── Élèves ────────────────────────────────────────────────────────────

function listerEleves(jeton) {
  exigerAdmin(jeton);
  return versObjets(FEUILLES.ELEVES)
    .map(sansLigne)
    .sort((a, b) => a.classe.localeCompare(b.classe) || a.nom.localeCompare(b.nom));
}

function listerClasses(jeton) {
  exigerConnexion(jeton);
  const c1 = versObjets(FEUILLES.ELEVES).map((e) => e.classe);
  const c2 = versObjets(FEUILLES.SEANCES).map((s) => s.classe);
  const toutes = {};
  c1.concat(c2).forEach((c) => (toutes[c] = true));
  return Object.keys(toutes).sort();
}

function validerEleve(champs) {
  return {
    nom: texteRequis(champs.nom, 'Le nom', 80),
    prenom: texteRequis(champs.prenom, 'Le prénom', 80),
    classe: texteRequis(champs.classe, 'La classe', 40),
    parent_nom: texteRequis(champs.parent_nom, 'Le nom du parent ou tuteur', 80),
    parent_whatsapp: telephoneE164(champs.parent_whatsapp),
  };
}

function creerEleve(jeton, champs) {
  exigerAdmin(jeton);
  return sansLigne(inserer(FEUILLES.ELEVES, validerEleve(champs)));
}

function modifierEleve(jeton, id, champs) {
  exigerAdmin(jeton);
  const maj = mettreAJour(FEUILLES.ELEVES, id, validerEleve(champs));
  if (!maj) throw new Error('Élève introuvable.');
  return sansLigne(maj);
}

function supprimerEleve(jeton, id) {
  exigerAdmin(jeton);
  const ok = supprimerLigne(FEUILLES.ELEVES, id);
  if (!ok) throw new Error('Élève introuvable.');
  supprimerToutesLignesOu(FEUILLES.PRESENCES, (p) => p.eleve_id === id);
  supprimerToutesLignesOu(FEUILLES.NOTIFICATIONS, (n) => n.eleve_id === id);
  return { ok: true };
}

function historiqueEleve(jeton, id) {
  exigerAdmin(jeton);
  const eleve = trouverParId(FEUILLES.ELEVES, id);
  if (!eleve) throw new Error('Élève introuvable.');
  const seances = versObjets(FEUILLES.SEANCES);
  const pointages = versObjets(FEUILLES.PRESENCES)
    .filter((p) => p.eleve_id === id)
    .map((p) => {
      const s = seances.find((x) => x.id === p.seance_id) || {};
      return {
        seance_id: p.seance_id, matiere: s.matiere, date_seance: s.date_seance, heure_debut: s.heure_debut,
        statut: p.statut, motif: p.motif, horodatage: p.horodatage,
      };
    })
    .sort((a, b) => (b.date_seance + b.heure_debut).localeCompare(a.date_seance + a.heure_debut));
  const presences = pointages.filter((p) => p.statut === 'present').length;
  const absences = pointages.length - presences;
  return {
    eleve: sansLigne(eleve), presences: presences, absences: absences, total: pointages.length,
    taux: pointages.length ? Math.round((presences / pointages.length) * 100) : null, pointages: pointages,
  };
}

// ── Séances ───────────────────────────────────────────────────────────

function chargerSeanceAvecEnseignant(id) {
  const s = trouverParId(FEUILLES.SEANCES, id);
  if (!s) throw new Error('Séance introuvable.');
  const ens = trouverParId(FEUILLES.UTILISATEURS, s.enseignant_id);
  return Object.assign(sansLigne(s), { enseignant_nom: ens ? ens.nom : '(compte supprimé)' });
}

function verifierAccesSeance(seance, utilisateur) {
  if (utilisateur.role === 'admin' || seance.enseignant_id === utilisateur.id) return;
  throw new Error('Cette séance ne vous est pas attribuée.');
}

function listerSeances(jeton, filtres) {
  const u = exigerConnexion(jeton);
  filtres = filtres || {};
  const utilisateurs = versObjets(FEUILLES.UTILISATEURS);
  const presences = versObjets(FEUILLES.PRESENCES);
  const eleves = versObjets(FEUILLES.ELEVES);
  return versObjets(FEUILLES.SEANCES)
    .filter((s) => u.role === 'admin' || s.enseignant_id === u.id)
    .filter((s) => !filtres.date || s.date_seance === filtres.date)
    .filter((s) => !filtres.classe || s.classe === filtres.classe)
    .map((s) => {
      const ens = utilisateurs.find((x) => x.id === s.enseignant_id);
      const pts = presences.filter((p) => p.seance_id === s.id);
      return Object.assign(sansLigne(s), {
        enseignant_nom: ens ? ens.nom : '(compte supprimé)',
        attendus: eleves.filter((e) => e.classe === s.classe).length,
        presents: pts.filter((p) => p.statut === 'present').length,
        absents: pts.filter((p) => p.statut === 'absent').length,
      });
    })
    .sort((a, b) => (b.date_seance + b.heure_debut).localeCompare(a.date_seance + a.heure_debut))
    .slice(0, 200);
}

function creerSeance(jeton, champs) {
  const u = exigerAdmin(jeton);
  const enseignantId = champs.enseignant_id || u.id;
  const ens = trouverParId(FEUILLES.UTILISATEURS, enseignantId);
  if (!ens || !ens.actif) throw new Error('Encadreur introuvable.');
  const s = inserer(FEUILLES.SEANCES, {
    matiere: texteRequis(champs.matiere, 'La matière', 60),
    date_seance: dateIsoValide(champs.date_seance),
    heure_debut: heureValide(champs.heure_debut),
    classe: texteRequis(champs.classe, 'La classe', 40),
    enseignant_id: enseignantId,
  });
  return chargerSeanceAvecEnseignant(s.id);
}

function supprimerSeance(jeton, id) {
  exigerAdmin(jeton);
  const ok = supprimerLigne(FEUILLES.SEANCES, id);
  if (!ok) throw new Error('Séance introuvable.');
  supprimerToutesLignesOu(FEUILLES.PRESENCES, (p) => p.seance_id === id);
  supprimerToutesLignesOu(FEUILLES.NOTIFICATIONS, (n) => n.seance_id === id);
  return { ok: true };
}

// ── Pointage ──────────────────────────────────────────────────────────

function lignesPointage(seance) {
  const eleves = versObjets(FEUILLES.ELEVES).filter((e) => e.classe === seance.classe);
  const presences = versObjets(FEUILLES.PRESENCES).filter((p) => p.seance_id === seance.id);
  const notifs = versObjets(FEUILLES.NOTIFICATIONS).filter((n) => n.seance_id === seance.id);
  return eleves
    .map((e) => {
      const p = presences.find((x) => x.eleve_id === e.id);
      const n = notifs.find((x) => x.eleve_id === e.id);
      return {
        id: e.id, nom: e.nom, prenom: e.prenom, parent_nom: e.parent_nom,
        statut: p ? p.statut : null, motif: p ? p.motif : '', horodatage: p ? p.horodatage : null,
        notif_id: n ? n.id : null, notif_statut: n ? n.statut : null,
        notif_erreur: n ? n.erreur : null, notif_tentatives: n ? n.tentatives : 0,
      };
    })
    .sort((a, b) => a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom));
}

function ouvrirPointage(jeton, seanceId) {
  const u = exigerConnexion(jeton);
  const seance = chargerSeanceAvecEnseignant(seanceId);
  verifierAccesSeance(seance, u);
  return { seance: seance, eleves: lignesPointage(seance) };
}

/**
 * Un clic = un horodatage serveur exact. Une seule ligne par (séance, élève) : un second clic
 * met à jour la même ligne au lieu d'en créer une autre. L'envoi WhatsApp se fait ici, avant
 * de répondre au navigateur (pas de tâche « en arrière-plan » possible dans Apps Script).
 */
function pointerEleve(jeton, seanceId, eleveId, statut, motif) {
  const u = exigerConnexion(jeton);
  const seance = chargerSeanceAvecEnseignant(seanceId);
  verifierAccesSeance(seance, u);
  if (statut !== 'present' && statut !== 'absent') throw new Error('Le statut doit être « present » ou « absent ».');
  const eleve = trouverParId(FEUILLES.ELEVES, eleveId);
  if (!eleve) throw new Error('Élève introuvable.');
  if (eleve.classe !== seance.classe) throw new Error("Cet élève n'appartient pas à la classe de la séance.");
  const motifNettoye = statut === 'absent' && motif ? texteRequis(motif, 'Le motif', 200) : '';

  avecVerrou(() => {
    const existante = versObjets(FEUILLES.PRESENCES).find((p) => p.seance_id === seanceId && p.eleve_id === eleveId);
    const donnees = { seance_id: seanceId, eleve_id: eleveId, statut: statut, motif: motifNettoye, horodatage: nowIso(), pointe_par: u.id };
    if (existante) mettreAJour(FEUILLES.PRESENCES, existante.id, donnees);
    else inserer(FEUILLES.PRESENCES, donnees);
  });

  if (statut === 'absent') declencherNotificationAbsence(seance, eleve);
  return lignesPointage(seance).find((l) => l.id === eleveId);
}

// ── Tableau de bord et export ─────────────────────────────────────────

function aujourdhui() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function tableauDeBord(jeton, depuisIso) {
  exigerAdmin(jeton);
  const seances = versObjets(FEUILLES.SEANCES);
  const presences = versObjets(FEUILLES.PRESENCES).filter((p) => {
    if (!depuisIso) return true;
    const s = seances.find((x) => x.id === p.seance_id);
    return s && s.date_seance >= depuisIso;
  });
  const eleves = versObjets(FEUILLES.ELEVES);

  const parClasse = {};
  presences.forEach((p) => {
    const s = seances.find((x) => x.id === p.seance_id);
    if (!s) return;
    if (!parClasse[s.classe]) parClasse[s.classe] = { classe: s.classe, presents: 0, total: 0 };
    parClasse[s.classe].total++;
    if (p.statut === 'present') parClasse[s.classe].presents++;
  });
  const classes = Object.keys(parClasse)
    .map((c) => {
      const x = parClasse[c];
      return Object.assign(x, { absents: x.total - x.presents, taux: x.total ? Math.round((x.presents / x.total) * 100) : null });
    })
    .sort((a, b) => a.classe.localeCompare(b.classe));

  const presentsTotal = classes.reduce((t, c) => t + c.presents, 0);
  const total = classes.reduce((t, c) => t + c.total, 0);

  const absencesParEleve = {};
  presences.filter((p) => p.statut === 'absent').forEach((p) => {
    absencesParEleve[p.eleve_id] = (absencesParEleve[p.eleve_id] || 0) + 1;
  });
  const plusAbsents = Object.keys(absencesParEleve)
    .map((id) => {
      const e = eleves.find((x) => x.id === id);
      return e ? { id: id, nom: e.nom, prenom: e.prenom, classe: e.classe, absences: absencesParEleve[id] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.absences - a.absences)
    .slice(0, 5);

  return {
    aujourdhui: aujourdhui(),
    seancesDuJour: listerSeances(jeton, { date: aujourdhui() }),
    global: { presents: presentsTotal, total: total, taux: total ? Math.round((presentsTotal / total) * 100) : null },
    classes: classes, plusAbsents: plusAbsents, nbEleves: eleves.length,
    notificationsEchouees: versObjets(FEUILLES.NOTIFICATIONS).filter((n) => n.statut === 'echoue').length,
  };
}

function exporterCsvSeance(jeton, seanceId) {
  exigerAdmin(jeton);
  const seance = chargerSeanceAvecEnseignant(seanceId);
  const lignes = lignesPointage(seance);
  const LIB = { present: 'Présent', absent: 'Absent' };
  const LIBN = { envoye: 'Envoyé', echoue: 'Échoué', en_attente: 'En cours' };
  const cellule = (v) => {
    let s = String(v === null || v === undefined ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise une formule si un nom commence par =, +, -, @
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const entetes = ['Nom', 'Prénom', 'Classe', 'Matière', 'Date séance', 'Statut', 'Motif', 'Horodatage', 'Message WhatsApp'];
  const corps = lignes.map((l) =>
    [l.nom, l.prenom, seance.classe, seance.matiere, seance.date_seance, l.statut ? LIB[l.statut] : 'Non pointé', l.motif || '', l.horodatage || '', l.notif_statut ? LIBN[l.notif_statut] : '']
      .map(cellule)
      .join(';')
  );
  return '\uFEFF' + entetes.map(cellule).join(';') + '\r\n' + corps.join('\r\n') + '\r\n';
}

// ── Export PDF ────────────────────────────────────────────────────────
// Le PDF est fabriqué par Google à partir d'une page HTML simple (tableaux et styles en ligne :
// le convertisseur de Google ne comprend ni flexbox ni grilles). Le navigateur reçoit le fichier
// encodé en base64 et le télécharge.

const COULEUR_ROUGE = '#C0170D';
const COULEUR_ROUGE_FONCE = '#8E0F08';
const COULEUR_JAUNE = '#FFC20E';

function echapperHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function nomFichierSur(texte) {
  const s = String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return s || 'document';
}

function horodatageLisible(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
}

function dateLisible(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? iso.split('-').reverse().join('/') : String(iso || '');
}

/**
 * Page HTML commune : bandeau rouge et jaune, titre, lignes d'information, résumé, tableau.
 * colonnes : [{ titre, largeur }] ; lignes : tableaux de cellules { t: texte, couleur?, gras? }.
 */
function htmlRapportPdf(titre, infos, resume, colonnes, lignes) {
  const cellule = (c, style) => {
    const o = typeof c === 'object' && c !== null ? c : { t: c };
    return `<td style="${style}${o.couleur ? 'color:' + o.couleur + ';' : ''}${o.gras ? 'font-weight:bold;' : ''}">${echapperHtml(o.t)}</td>`;
  };
  const bord = 'border-bottom:1px solid #E8DCC8;padding:5px 6px;font-size:10pt;vertical-align:top;';
  const entetes = colonnes.map((c) => `<th align="left" width="${c.largeur}" style="background:${COULEUR_ROUGE_FONCE};color:#FFFFFF;padding:6px;font-size:10pt;">${echapperHtml(c.titre)}</th>`).join('');
  const corps = lignes.length
    ? lignes.map((l, i) => `<tr style="background:${i % 2 ? '#FDF7EC' : '#FFFFFF'};">${l.map((c) => cellule(c, bord)).join('')}</tr>`).join('')
    : `<tr><td colspan="${colonnes.length}" style="${bord}text-align:center;color:#6E5A58;">Aucune donnée.</td></tr>`;
  const maintenant = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  return '<!doctype html><html><head><meta charset="utf-8"></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;color:#2B1818;margin:0;">' +
    `<table width="100%" cellspacing="0" cellpadding="0"><tr><td style="background:${COULEUR_ROUGE_FONCE};color:#FFFFFF;padding:12px 14px;">` +
    '<div style="font-size:16pt;font-weight:bold;letter-spacing:1px;">EXCELLENCE GROUP</div>' +
    '<div style="font-size:10pt;">Suivi de présence</div></td></tr>' +
    `<tr><td style="background:${COULEUR_JAUNE};height:5px;font-size:1px;line-height:5px;">&nbsp;</td></tr></table>` +
    `<h1 style="font-size:17pt;color:${COULEUR_ROUGE};margin:16px 0 6px 0;">${echapperHtml(titre)}</h1>` +
    '<table cellspacing="0" cellpadding="0" style="font-size:10.5pt;margin-bottom:8px;">' +
    infos.map((i) => `<tr><td style="padding:2px 14px 2px 0;color:#6E5A58;">${echapperHtml(i[0])}</td><td style="padding:2px 0;font-weight:bold;">${echapperHtml(i[1])}</td></tr>`).join('') +
    '</table>' +
    (resume ? `<p style="font-size:10.5pt;margin:6px 0 10px 0;padding:6px 8px;background:#FFF1BF;">${echapperHtml(resume)}</p>` : '') +
    `<table width="100%" cellspacing="0" cellpadding="0"><tr>${entetes}</tr>${corps}</table>` +
    `<p style="font-size:8.5pt;color:#6E5A58;margin-top:14px;">Document généré le ${maintenant} par l'application de suivi de présence d'Excellence Group.</p>` +
    '</body></html>';
}

/** Transforme la page HTML en PDF et renvoie { nom, base64 } au navigateur. */
function pdfDepuisHtml(html, nomBase) {
  const nom = nomFichierSur(nomBase) + '.pdf';
  const pdf = Utilities.newBlob(html, 'text/html', nom + '.html').getAs('application/pdf');
  return { nom: nom, base64: Utilities.base64Encode(pdf.getBytes()) };
}

/** Feuille de présence d'une séance : réservée à l'administrateur et à l'encadreur responsable de la séance. */
function exporterPdfSeance(jeton, seanceId) {
  const u = exigerConnexion(jeton);
  const seance = chargerSeanceAvecEnseignant(seanceId);
  verifierAccesSeance(seance, u);
  const lignes = lignesPointage(seance);
  const presents = lignes.filter((l) => l.statut === 'present').length;
  const absents = lignes.filter((l) => l.statut === 'absent').length;
  const LIB_NOTIF = { envoye: 'Envoyé', echoue: 'Échoué', en_attente: 'En cours' };
  const corps = lignes.map((l, i) => [
    String(i + 1),
    { t: `${l.nom} ${l.prenom}`, gras: true },
    l.statut === 'present' ? { t: 'Présent', couleur: '#1F8A5B', gras: true }
      : l.statut === 'absent' ? { t: 'Absent', couleur: COULEUR_ROUGE, gras: true }
      : { t: 'Non pointé', couleur: '#6E5A58' },
    l.motif || '',
    l.horodatage ? horodatageLisible(l.horodatage) : '',
    l.statut === 'absent' && l.notif_statut ? LIB_NOTIF[l.notif_statut] || '' : '',
  ]);
  const html = htmlRapportPdf(
    'Feuille de présence',
    [['Matière', seance.matiere], ['Classe', seance.classe], ['Date', dateLongueFr(seance.date_seance)], ['Heure', seance.heure_debut], ['Encadreur', seance.enseignant_nom]],
    `${presents} présent(s), ${absents} absent(s), ${lignes.length - presents - absents} non pointé(s) sur ${lignes.length} élève(s).`,
    [{ titre: 'N°', largeur: '5%' }, { titre: 'Élève', largeur: '27%' }, { titre: 'Statut', largeur: '12%' }, { titre: 'Motif', largeur: '23%' }, { titre: 'Pointé le', largeur: '20%' }, { titre: 'Message au parent', largeur: '13%' }],
    corps
  );
  return pdfDepuisHtml(html, `presence-${seance.classe}-${seance.date_seance}-${seance.matiere}`);
}

/** Relevé de présence d'un élève : réservé à l'administrateur. */
function exporterPdfEleve(jeton, eleveId) {
  const h = historiqueEleve(jeton, eleveId); // vérifie déjà les droits administrateur
  const e = h.eleve;
  const corps = h.pointages.map((p) => [
    dateLisible(p.date_seance),
    { t: p.matiere, gras: true },
    p.heure_debut || '',
    p.statut === 'present' ? { t: 'Présent', couleur: '#1F8A5B', gras: true } : { t: 'Absent', couleur: COULEUR_ROUGE, gras: true },
    p.motif || '',
    horodatageLisible(p.horodatage),
  ]);
  const html = htmlRapportPdf(
    'Relevé de présence',
    [['Élève', `${e.nom} ${e.prenom}`], ['Classe', e.classe], ['Parent ou tuteur', `${e.parent_nom}, ${e.parent_whatsapp}`]],
    `${h.presences} présence(s), ${h.absences} absence(s) sur ${h.total} pointage(s). Taux de présence : ${h.taux === null ? 'non calculable' : h.taux + ' %'}.`,
    [{ titre: 'Date', largeur: '14%' }, { titre: 'Matière', largeur: '24%' }, { titre: 'Heure', largeur: '10%' }, { titre: 'Statut', largeur: '12%' }, { titre: 'Motif', largeur: '20%' }, { titre: 'Pointé le', largeur: '20%' }],
    corps
  );
  return pdfDepuisHtml(html, `releve-${e.nom}-${e.prenom}`);
}
