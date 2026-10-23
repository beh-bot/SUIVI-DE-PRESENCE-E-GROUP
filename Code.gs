// ═══════════════════════════════════════════════════════════════════════
// Point d'entrée de l'application web. Google appelle doGet() quand quelqu'un
// ouvre le lien de l'application (voir Déployer > Gérer les déploiements).
// ═══════════════════════════════════════════════════════════════════════

function doGet(e) {
  // Page de test : ajoutez  ?test=1  à la fin du lien de l'application pour vérifier
  // que le déploiement répond, sans dépendre de l'écran de l'application.
  if (e && e.parameter && e.parameter.test) return pageDeTest();

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Excellence Group · Suivi de présence')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function pageDeTest() {
  let feuillesOk = 'non';
  let adminOk = 'non';
  try {
    classeur();
    feuillesOk = Object.keys(FEUILLES).filter((k) => k !== 'INVITATIONS').every((k) => classeur().getSheetByName(FEUILLES[k].nom)) ? 'oui' : 'non (lancez « 1) Initialiser les feuilles »)';
    if (feuillesOk === 'oui') {
      adminOk = versObjets(FEUILLES.UTILISATEURS).some((u) => u.actif && u.role === 'admin') ? 'oui' : 'non (lancez « 2) Créer un administrateur »)';
    }
  } catch (err) {
    feuillesOk = 'erreur : ' + err.message;
  }
  const html =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<body style="font-family:sans-serif;padding:24px;line-height:1.5">' +
    '<h1 style="color:#C0170D">Le déploiement fonctionne ✅</h1>' +
    '<p>Google répond correctement à ce lien.</p>' +
    '<p>Feuilles de données prêtes : <b>' + feuillesOk + '</b><br>' +
    'Au moins un administrateur créé : <b>' + adminOk + '</b></p>' +
    '<p style="color:#6E5A58">Si ceci s\'affiche mais pas l\'application, retirez « ?test=1 » du lien.</p></body>';
  return HtmlService.createHtmlOutput(html).setTitle('Test du déploiement');
}
