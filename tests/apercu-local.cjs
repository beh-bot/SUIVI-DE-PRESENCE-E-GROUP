// Aperçu local de l'application, sans Google : sert Index.html et exécute le code serveur (.gs)
// contre de faux services en mémoire (tests/faux-google.cjs).
//   node tests/apercu-local.cjs        puis ouvrir http://localhost:8765
// Les données sont des données de démonstration, perdues à l'arrêt. Aucun message WhatsApp
// n'est envoyé (mode simulation) et les PDF téléchargés sont de faux fichiers : la vraie
// conversion en PDF est faite par Google.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { creerEnvironnement, racine } = require('./faux-google.cjs');

const PORT = Number(process.env.PORT) || 8765;
const URL_APP = `http://localhost:${PORT}/`;
const { S, noms, proprietes, contexte } = creerEnvironnement({ url: URL_APP, fuseau: 'local' });
const publiques = new Set(noms.filter((n) => !n.endsWith('_')));

// ── Données de démonstration ────────────────────────────────────────────
const ADMIN = { identifiant: 'admin', motDePasse: 'demo-admin-1' };
const ENCADREUR = { identifiant: 'kone.adama', motDePasse: 'demo-encadreur-1' };

function semer() {
  S.initialiserFeuilles(); // lancé « depuis Google Sheets »
  contexte.dansSheets = false; // ensuite on est dans l'application web
  proprietes.WHATSAPP_DRY_RUN = 'true';
  S.creerCompteInterne_('Awa Coulibaly', ADMIN.identifiant, ADMIN.motDePasse, 'admin');
  const prof = S.creerCompteInterne_('Koné Adama', ENCADREUR.identifiant, ENCADREUR.motDePasse, 'enseignant');
  const admin = S.connexion(ADMIN.identifiant, ADMIN.motDePasse);
  const eleves = [
    ['Bamba', 'Issa', '3e A'], ['Yao', 'Aya', '3e A'], ['Traoré', 'Fatou', '3e A'], ['Kouassi', 'Jean', '3e A'],
    ['Diallo', 'Moussa', 'Tle D'], ['Ouattara', 'Mariam', 'Tle D'], ['N\'Guessan', 'Paul', 'Tle D'],
  ].map(([nom, prenom, classe], i) => S.creerEleve(admin.jeton, {
    nom, prenom, classe, parent_nom: `Parent ${nom}`, parent_whatsapp: `+22507000000${String(i + 1).padStart(2, '0')}`,
  }));
  const jour = (decalage) => {
    const d = new Date(Date.now() + decalage * 864e5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const hier = S.creerSeance(admin.jeton, { matiere: 'Physique-Chimie', date_seance: jour(-1), heure_debut: '15:00', classe: '3e A', enseignant_id: prof.id });
  eleves.filter((e) => e.classe === '3e A').forEach((e, i) => S.pointerEleve(admin.jeton, hier.id, e.id, i === 1 ? 'absent' : 'present', i === 1 ? 'Malade' : ''));
  S.creerSeance(admin.jeton, { matiere: 'Mathématiques', date_seance: jour(0), heure_debut: '08:30', classe: '3e A', enseignant_id: prof.id });
  S.creerSeance(admin.jeton, { matiere: 'SVT', date_seance: jour(0), heure_debut: '10:30', classe: 'Tle D', enseignant_id: admin.id });
  S.deconnexion(admin.jeton);
}
semer();

// ── Remplaçant de google.script (injecté dans la page) ──────────────────
const CALE = `<script>
window.google = { script: {
  get run() {
    const etat = { ok: () => {}, ko: (e) => { throw e; } };
    return new Proxy({}, { get(cible, nom, proxy) {
      if (nom === 'withSuccessHandler') return (f) => { etat.ok = f; return proxy; };
      if (nom === 'withFailureHandler') return (f) => { etat.ko = f; return proxy; };
      return (...args) => {
        fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom, args }) })
          .then((r) => r.json())
          .then((r) => (r.erreur !== undefined ? etat.ko(new Error(r.erreur)) : etat.ok(r.resultat)))
          .catch((e) => etat.ko(new Error('Serveur local injoignable : ' + e.message)));
      };
    } });
  },
  url: { getLocation: (cb) => cb({ parameter: Object.fromEntries(new URLSearchParams(location.search)), hash: location.hash }) },
} };
</script>
<div style="position:fixed;right:8px;bottom:8px;z-index:9998;background:#2B1818;color:#fff;padding:6px 10px;border-radius:8px;font:12px/1.3 sans-serif;opacity:.85">
  Aperçu local : données de démonstration, aucun WhatsApp envoyé
</div>`;

function page() {
  const html = fs.readFileSync(path.join(racine, 'Index.html'), 'utf8'); // relu à chaque fois : un rafraîchissement suffit après une modification
  return html.replace('<script>', () => CALE + '<script>');
}

http.createServer((req, res) => {
  const url = new URL(req.url, URL_APP);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page());
    return;
  }
  if (req.method === 'POST' && url.pathname === '/rpc') {
    let corps = '';
    req.on('data', (m) => { corps += m; if (corps.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let reponse;
      try {
        const { nom, args } = JSON.parse(corps);
        // Comme Apps Script : seules les fonctions sans « _ » final sont appelables depuis le navigateur.
        if (!publiques.has(nom)) throw new Error(`Fonction « ${nom} » introuvable ou privée.`);
        const resultat = S[nom](...(Array.isArray(args) ? args : []));
        reponse = { resultat: resultat === undefined ? null : resultat };
      } catch (e) {
        reponse = { erreur: e && e.message ? e.message : String(e) };
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(reponse));
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Introuvable');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Aperçu local : ${URL_APP}`);
  console.log(`  Administrateur : ${ADMIN.identifiant} / ${ADMIN.motDePasse}`);
  console.log(`  Encadreur      : ${ENCADREUR.identifiant} / ${ENCADREUR.motDePasse}`);
});
