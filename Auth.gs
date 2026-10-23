// ═══════════════════════════════════════════════════════════════════════
// Authentification. Une application Apps Script n'a pas de cookies de session
// comme un serveur classique : on utilise un jeton aléatoire, que le navigateur
// garde dans son stockage local et renvoie à chaque appel.
// ═══════════════════════════════════════════════════════════════════════

// ── Mots de passe (hachage SHA-256 salé ; pas de bcrypt disponible dans Apps Script) ──

function hacherMotDePasse(motDePasse) {
  const sel = Utilities.getUuid();
  return { hash: sha256Hex(motDePasse + sel), sel };
}

function motDePasseValide(motDePasse, hashStocke, selStocke) {
  return sha256Hex(String(motDePasse) + selStocke) === hashStocke;
}

function sha256Hex(texte) {
  const octets = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texte, Utilities.Charset.UTF_8);
  return octets.map((o) => ('0' + ((o + 256) % 256).toString(16)).slice(-2)).join('');
}

// ── Sessions : jetons stockés dans les propriétés du script, valables 12 h ──

const DUREE_SESSION_MS = 12 * 60 * 60 * 1000;

/** Supprime les sessions expirées : les propriétés du script ont une taille limitée, on évite qu'elles s'accumulent. */
function purgerSessionsExpirees() {
  const props = PropertiesService.getScriptProperties();
  const toutes = props.getProperties();
  Object.keys(toutes).forEach((cle) => {
    if (cle.indexOf('session_') !== 0) return;
    try {
      if (JSON.parse(toutes[cle]).expire < Date.now()) props.deleteProperty(cle);
    } catch (e) {
      props.deleteProperty(cle);
    }
  });
}

function creerSession(utilisateur) {
  purgerSessionsExpirees();
  const jeton = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(
    'session_' + jeton,
    JSON.stringify({ id: utilisateur.id, expire: Date.now() + DUREE_SESSION_MS })
  );
  return jeton;
}

function invaliderSession(jeton) {
  if (jeton) PropertiesService.getScriptProperties().deleteProperty('session_' + jeton);
}

/** Coupe toutes les sessions ouvertes d'un utilisateur (mot de passe changé, compte supprimé). */
function invaliderSessionsUtilisateur(idUtilisateur, jetonAGarder) {
  const props = PropertiesService.getScriptProperties();
  const toutes = props.getProperties();
  Object.keys(toutes).forEach((cle) => {
    if (cle.indexOf('session_') !== 0) return;
    if (jetonAGarder && cle === 'session_' + jetonAGarder) return;
    try {
      if (JSON.parse(toutes[cle]).id === idUtilisateur) props.deleteProperty(cle);
    } catch (e) {
      // jeton illisible : on l'ignore
    }
  });
}

/** Utilisateur courant, relu en base à CHAQUE appel : un compte supprimé ou un rôle changé prend effet immédiatement. */
function utilisateurDuJeton(jeton) {
  if (!jeton) return null;
  const brut = PropertiesService.getScriptProperties().getProperty('session_' + jeton);
  if (!brut) return null;
  let session;
  try {
    session = JSON.parse(brut);
  } catch (e) {
    return null;
  }
  if (session.expire < Date.now()) {
    invaliderSession(jeton);
    return null;
  }
  const u = trouverParId(FEUILLES.UTILISATEURS, session.id);
  if (!u || !u.actif) return null;
  return { id: u.id, nom: u.nom, email: u.email, role: u.role };
}

/** Lève 'SESSION_EXPIREE' (mot-clé que le navigateur reconnaît pour renvoyer vers l'écran de connexion). */
function exigerConnexion(jeton) {
  const u = utilisateurDuJeton(jeton);
  if (!u) throw new Error('SESSION_EXPIREE');
  return u;
}

function exigerAdmin(jeton) {
  const u = exigerConnexion(jeton);
  if (u.role !== 'admin') throw new Error("Cette action est réservée à l'administrateur.");
  return u;
}

// ── Fonctions appelées depuis le navigateur (google.script.run) ─────────

/** L'« identifiant » est stocké dans la colonne `email` (nom conservé pour ne pas casser les données existantes). */
function connexion(identifiant, motDePasse) {
  const e = String(identifiant || '').trim().toLowerCase();
  const u = versObjets(FEUILLES.UTILISATEURS).find((x) => String(x.email).toLowerCase() === e && x.actif);
  if (!u || !motDePasseValide(motDePasse, u.mdp_hash, u.mdp_sel)) {
    throw new Error('Identifiant ou mot de passe incorrect.');
  }
  const jeton = creerSession(u);
  return { jeton: jeton, id: u.id, nom: u.nom, email: u.email, role: u.role };
}

function moi(jeton) {
  return exigerConnexion(jeton);
}

/** Un utilisateur connecté (encadreur ou administrateur) change son propre mot de passe. */
function changerMonMotDePasse(jeton, ancien, nouveau) {
  const courant = exigerConnexion(jeton);
  const u = trouverParId(FEUILLES.UTILISATEURS, courant.id);
  if (!u || !motDePasseValide(ancien, u.mdp_hash, u.mdp_sel)) throw new Error('Le mot de passe actuel est incorrect.');
  motDePasseValideFormat(nouveau);
  if (String(nouveau) === String(ancien)) throw new Error("Le nouveau mot de passe doit être différent de l'actuel.");
  const paire = hacherMotDePasse(String(nouveau));
  mettreAJour(FEUILLES.UTILISATEURS, u.id, { mdp_hash: paire.hash, mdp_sel: paire.sel });
  invaliderSessionsUtilisateur(u.id, jeton); // les autres appareils devront se reconnecter
  return { ok: true };
}

function deconnexion(jeton) {
  invaliderSession(jeton);
  return { ok: true };
}
