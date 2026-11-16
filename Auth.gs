// ═══════════════════════════════════════════════════════════════════════
// Authentification. Une application Apps Script n'a pas de cookies de session
// comme un serveur classique : on utilise un jeton aléatoire, que le navigateur
// garde dans son stockage local et renvoie à chaque appel.
// ═══════════════════════════════════════════════════════════════════════

// ── Mots de passe (PBKDF2 salé ; pas de bcrypt disponible dans Apps Script) ──

// Format stocké dans mdp_hash : « pbkdf2$<itérations>$<hex> » (PBKDF2-HMAC-SHA256, lent exprès :
// si la feuille fuit, chaque essai de mot de passe coûte des milliers de calculs à l'attaquant).
// Les anciens comptes (SHA-256 simple, sans préfixe) restent acceptés et sont convertis
// automatiquement à la prochaine connexion réussie.
// Si la connexion devient trop lente, baissez ce nombre : les comptes existants continuent de
// fonctionner (leur nombre d'itérations est écrit dans leur hash) et sont convertis au passage.
const ITERATIONS_MDP = 2000;
const PREFIXE_MDP = 'pbkdf2$';

function hacherMotDePasse_(motDePasse) {
  const sel = Utilities.getUuid();
  return { hash: PREFIXE_MDP + ITERATIONS_MDP + '$' + pbkdf2Hex_(String(motDePasse), sel, ITERATIONS_MDP), sel };
}

function motDePasseValide_(motDePasse, hashStocke, selStocke) {
  const mdp = typeof motDePasse === 'string' ? motDePasse : '';
  const h = String(hashStocke || '');
  if (!mdp || !h) return false;
  if (h.indexOf(PREFIXE_MDP) === 0) {
    const parties = h.split('$');
    const iterations = parseInt(parties[1], 10);
    if (!(iterations > 0) || iterations > 100000) return false;
    return egaliteConstante_(pbkdf2Hex_(mdp, String(selStocke), iterations), parties[2]);
  }
  return egaliteConstante_(sha256Hex_(mdp + selStocke), h); // ancien format
}

/** Vrai si le hash stocké n'est pas au format courant (ancien SHA-256, ou autre nombre d'itérations). */
function hashObsolete_(hashStocke) {
  return String(hashStocke || '').indexOf(PREFIXE_MDP + ITERATIONS_MDP + '$') !== 0;
}

/** PBKDF2-HMAC-SHA256, un seul bloc (32 octets), résultat en hexadécimal. */
function pbkdf2Hex_(motDePasse, sel, iterations) {
  const cle = Utilities.newBlob(motDePasse).getBytes();
  let u = Utilities.computeHmacSha256Signature(Utilities.newBlob(sel).getBytes().concat([0, 0, 0, 1]), cle);
  const t = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, cle);
    for (let j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return t.map((o) => ('0' + (o & 0xff).toString(16)).slice(-2)).join('');
}

/** Comparaison sans sortie anticipée (ne révèle pas, par le temps de réponse, où les chaînes diffèrent). */
function egaliteConstante_(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
  return diff === 0;
}

function sha256Hex_(texte) {
  const octets = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texte, Utilities.Charset.UTF_8);
  return octets.map((o) => ('0' + ((o + 256) % 256).toString(16)).slice(-2)).join('');
}

// ── Sessions : valables 12 h, rangées dans les propriétés du script ──
// Le jeton lui-même n'est jamais stocké : la clé de la propriété est son empreinte SHA-256.
// Quelqu'un qui lit les propriétés du script (un éditeur du projet, par exemple) n'y trouve donc
// aucun jeton utilisable. SHA-256 simple suffit ici, contrairement aux mots de passe : un jeton
// est un UUID aléatoire, impossible à deviner par essais successifs.

const DUREE_SESSION_MS = 12 * 60 * 60 * 1000;

function cleSession_(jeton) {
  return 'session_' + sha256Hex_(String(jeton));
}

/** Supprime les sessions expirées : les propriétés du script ont une taille limitée, on évite qu'elles s'accumulent. */
function purgerSessionsExpirees_() {
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

function creerSession_(utilisateur) {
  purgerSessionsExpirees_();
  const jeton = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(
    cleSession_(jeton),
    JSON.stringify({ id: utilisateur.id, expire: Date.now() + DUREE_SESSION_MS })
  );
  return jeton;
}

function invaliderSession_(jeton) {
  if (jeton) PropertiesService.getScriptProperties().deleteProperty(cleSession_(jeton));
}

/** Coupe toutes les sessions ouvertes d'un utilisateur (mot de passe changé, compte supprimé). */
function invaliderSessionsUtilisateur_(idUtilisateur, jetonAGarder) {
  const props = PropertiesService.getScriptProperties();
  const toutes = props.getProperties();
  const cleAGarder = jetonAGarder ? cleSession_(jetonAGarder) : null;
  Object.keys(toutes).forEach((cle) => {
    if (cle.indexOf('session_') !== 0) return;
    if (cle === cleAGarder) return;
    try {
      if (JSON.parse(toutes[cle]).id === idUtilisateur) props.deleteProperty(cle);
    } catch (e) {
      // jeton illisible : on l'ignore
    }
  });
}

/** Utilisateur courant, relu en base à CHAQUE appel : un compte supprimé ou un rôle changé prend effet immédiatement. */
function utilisateurDuJeton_(jeton) {
  if (!jeton || typeof jeton !== 'string' || jeton.length > 100) return null;
  const brut = PropertiesService.getScriptProperties().getProperty(cleSession_(jeton));
  if (!brut) return null;
  let session;
  try {
    session = JSON.parse(brut);
  } catch (e) {
    return null;
  }
  if (session.expire < Date.now()) {
    invaliderSession_(jeton);
    return null;
  }
  const u = trouverParId_(FEUILLES.UTILISATEURS, session.id);
  if (!u || !u.actif) return null;
  return { id: u.id, nom: u.nom, email: u.email, role: u.role };
}

/** Lève 'SESSION_EXPIREE' (mot-clé que le navigateur reconnaît pour renvoyer vers l'écran de connexion). */
function exigerConnexion_(jeton) {
  const u = utilisateurDuJeton_(jeton);
  if (!u) throw new Error('SESSION_EXPIREE');
  return u;
}

function exigerAdmin_(jeton) {
  const u = exigerConnexion_(jeton);
  if (u.role !== 'admin') throw new Error("Cette action est réservée à l'administrateur.");
  return u;
}

// ── Fonctions appelées depuis le navigateur (google.script.run) ─────────

const MAX_ECHECS_CONNEXION = 5;
const BLOCAGE_CONNEXION_S = 15 * 60;

/** L'« identifiant » est stocké dans la colonne `email` (nom conservé pour ne pas casser les données existantes). */
function connexion(identifiant, motDePasse) {
  const e = String(identifiant || '').trim().toLowerCase().slice(0, 100);
  // Anti force brute : après MAX_ECHECS_CONNEXION échecs sur un identifiant, il est bloqué quelques minutes.
  const cache = CacheService.getScriptCache();
  const cleEchecs = 'echecs_' + sha256Hex_(e);
  const echecs = Number(cache.get(cleEchecs)) || 0;
  if (echecs >= MAX_ECHECS_CONNEXION) {
    throw new Error(`Trop de tentatives. Réessayez dans ${BLOCAGE_CONNEXION_S / 60} minutes.`);
  }
  const u = versObjets_(FEUILLES.UTILISATEURS).find((x) => String(x.email).toLowerCase() === e && x.actif);
  // Identifiant inconnu : on fait quand même le calcul lent, pour rien. Sans cela, la réponse serait
  // nettement plus rapide que pour un identifiant existant, et le temps de réponse suffirait à
  // découvrir quels identifiants existent.
  if (!u) pbkdf2Hex_(typeof motDePasse === 'string' && motDePasse ? motDePasse : 'x', 'sel-factice', ITERATIONS_MDP);
  if (!u || !motDePasseValide_(motDePasse, u.mdp_hash, u.mdp_sel)) {
    cache.put(cleEchecs, String(echecs + 1), BLOCAGE_CONNEXION_S);
    throw new Error('Identifiant ou mot de passe incorrect.');
  }
  cache.remove(cleEchecs);
  if (hashObsolete_(u.mdp_hash)) {
    const paire = hacherMotDePasse_(motDePasse);
    mettreAJour_(FEUILLES.UTILISATEURS, u.id, { mdp_hash: paire.hash, mdp_sel: paire.sel });
  }
  const jeton = creerSession_(u);
  journaliser_(u, 'connexion', u.email);
  return { jeton: jeton, id: u.id, nom: u.nom, email: u.email, role: u.role };
}

function moi(jeton) {
  return exigerConnexion_(jeton);
}

/** Un utilisateur connecté (encadreur ou administrateur) change son propre mot de passe. */
function changerMonMotDePasse(jeton, ancien, nouveau) {
  const courant = exigerConnexion_(jeton);
  const u = trouverParId_(FEUILLES.UTILISATEURS, courant.id);
  if (!u || !motDePasseValide_(ancien, u.mdp_hash, u.mdp_sel)) throw new Error('Le mot de passe actuel est incorrect.');
  motDePasseValideFormat_(nouveau);
  if (String(nouveau) === String(ancien)) throw new Error("Le nouveau mot de passe doit être différent de l'actuel.");
  const paire = hacherMotDePasse_(String(nouveau));
  mettreAJour_(FEUILLES.UTILISATEURS, u.id, { mdp_hash: paire.hash, mdp_sel: paire.sel });
  invaliderSessionsUtilisateur_(u.id, jeton); // les autres appareils devront se reconnecter
  journaliser_(courant, 'compte.mot_de_passe', courant.email, 'changé par son titulaire');
  return { ok: true };
}

function deconnexion(jeton) {
  invaliderSession_(jeton);
  return { ok: true };
}
