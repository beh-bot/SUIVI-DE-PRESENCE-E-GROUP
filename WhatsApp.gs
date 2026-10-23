// ═══════════════════════════════════════════════════════════════════════
// Envoi WhatsApp (API WhatsApp Business Cloud de Meta) et journal des notifications.
// Les clés se règlent dans Extensions > Apps Script > icône ⚙️ Paramètres du projet
// > Propriétés du script — jamais dans le code, jamais visibles des enseignants.
// ═══════════════════════════════════════════════════════════════════════

function configWhatsApp() {
  const p = PropertiesService.getScriptProperties();
  return {
    actif: p.getProperty('WHATSAPP_ENABLED') !== 'false',
    simulation: p.getProperty('WHATSAPP_DRY_RUN') === 'true',
    base: (p.getProperty('WHATSAPP_API_BASE') || 'https://graph.facebook.com').replace(/\/$/, ''),
    version: p.getProperty('WHATSAPP_API_VERSION') || 'v21.0',
    numeroId: p.getProperty('WHATSAPP_PHONE_NUMBER_ID'),
    jeton: p.getProperty('WHATSAPP_ACCESS_TOKEN'),
    template: p.getProperty('WHATSAPP_TEMPLATE_NAME') || 'absence_eleve',
    langue: p.getProperty('WHATSAPP_TEMPLATE_LANG') || 'fr',
  };
}

// Traduction des erreurs Meta les plus courantes en messages compréhensibles.
const MESSAGES_META = {
  190: "Jeton d'accès WhatsApp invalide ou expiré. Contactez l'administrateur.",
  100: 'Requête refusée par WhatsApp (paramètre invalide). Vérifiez le numéro du parent.',
  131026: "Message non distribuable : ce numéro n'est probablement pas sur WhatsApp.",
  131030: 'Numéro non autorisé : en mode test Meta, ajoutez-le aux destinataires de test.',
  131042: "Problème de paiement sur le compte WhatsApp Business. Contactez l'administrateur.",
  132000: 'Le nombre de variables ne correspond pas au template WhatsApp.',
  132001: 'Template WhatsApp introuvable ou non approuvé (vérifiez son nom et sa langue).',
  132015: 'Template WhatsApp en pause ou désactivé par Meta.',
  133010: "Numéro d'envoi WhatsApp non enregistré.",
};

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function dateLongueFr(iso) {
  const parties = iso.split('-');
  const jour = parseInt(parties[2], 10);
  const mois = parseInt(parties[1], 10);
  return `${jour} ${MOIS_FR[mois - 1]} ${parties[0]}`;
}

/**
 * Envoie le message WhatsApp d'absence. Retourne { messageId } en cas de succès,
 * lève une Error au message lisible (affiché à l'enseignant) en cas d'échec.
 */
function envoyerMessageAbsence(params) {
  const c = configWhatsApp();
  if (!c.actif) throw new Error('Les notifications WhatsApp sont désactivées (propriété WHATSAPP_ENABLED=false).');

  if (c.simulation) {
    Logger.log(
      '[WhatsApp simulation] -> %s : %s absent(e) en %s le %s a %s',
      params.telephone, params.eleveNom, params.matiere, dateLongueFr(params.dateSeance), params.heure
    );
    return { messageId: 'simulation-' + new Date().getTime() };
  }

  if (!c.numeroId || !c.jeton) {
    throw new Error(
      "WhatsApp non configuré : renseignez WHATSAPP_PHONE_NUMBER_ID et WHATSAPP_ACCESS_TOKEN " +
      "(Extensions > Apps Script > ⚙️ Paramètres du projet > Propriétés du script)."
    );
  }

  const corps = {
    messaging_product: 'whatsapp',
    to: params.telephone.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: c.template,
      language: { code: c.langue },
      components: [{
        type: 'body',
        parameters: [params.eleveNom, params.matiere, dateLongueFr(params.dateSeance), params.heure].map((t) => ({ type: 'text', text: t })),
      }],
    },
  };

  const reponse = UrlFetchApp.fetch(`${c.base}/${c.version}/${c.numeroId}/messages`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + c.jeton },
    payload: JSON.stringify(corps),
    muteHttpExceptions: true,
  });

  let donnees = {};
  try {
    donnees = JSON.parse(reponse.getContentText());
  } catch (e) {
    // réponse illisible : donnees reste {}
  }

  if (reponse.getResponseCode() >= 300) {
    const err = donnees.error || {};
    throw new Error(
      MESSAGES_META[err.code]
        ? `${MESSAGES_META[err.code]} [code ${err.code}]`
        : `Erreur WhatsApp (HTTP ${reponse.getResponseCode()}) : ${err.message || 'réponse inattendue'}`
    );
  }
  const id = donnees.messages && donnees.messages[0] && donnees.messages[0].id;
  if (!id) throw new Error("WhatsApp n'a pas confirmé l'envoi (réponse sans identifiant de message).");
  return { messageId: id };
}

/**
 * Crée l'entrée de journal si elle n'existe pas (une seule fois par séance+élève,
 * même si l'élève est repointé plusieurs fois), puis tente l'envoi.
 */
function declencherNotificationAbsence(seance, eleve) {
  const entree = avecVerrou(() => {
    const trouvee = versObjets(FEUILLES.NOTIFICATIONS).find((n) => n.seance_id === seance.id && n.eleve_id === eleve.id);
    if (trouvee) return trouvee;
    return inserer(FEUILLES.NOTIFICATIONS, {
      seance_id: seance.id, eleve_id: eleve.id, telephone: eleve.parent_whatsapp,
      statut: 'en_attente', erreur: '', message_id: '', tentatives: 0, maj_le: nowIso(),
    });
  });
  if (entree.statut !== 'en_attente') return; // déjà envoyé, ou déjà marqué échoué (voir bouton « Renvoyer »)
  tenterEnvoi(entree.id, seance, eleve);
}

function tenterEnvoi(notifId, seance, eleve) {
  const avant = trouverParId(FEUILLES.NOTIFICATIONS, notifId);
  const tentatives = (avant ? avant.tentatives : 0) + 1;
  try {
    const resultat = envoyerMessageAbsence({
      telephone: eleve.parent_whatsapp, eleveNom: `${eleve.prenom} ${eleve.nom}`,
      matiere: seance.matiere, dateSeance: seance.date_seance, heure: seance.heure_debut,
    });
    mettreAJour(FEUILLES.NOTIFICATIONS, notifId, {
      statut: 'envoye', erreur: '', message_id: resultat.messageId, telephone: eleve.parent_whatsapp,
      maj_le: nowIso(), tentatives: tentatives,
    });
  } catch (e) {
    mettreAJour(FEUILLES.NOTIFICATIONS, notifId, {
      statut: 'echoue', erreur: String(e.message).slice(0, 500), telephone: eleve.parent_whatsapp,
      maj_le: nowIso(), tentatives: tentatives,
    });
  }
}

function listerNotifications(jeton, statut) {
  exigerAdmin(jeton);
  const seances = versObjets(FEUILLES.SEANCES);
  const eleves = versObjets(FEUILLES.ELEVES);
  return versObjets(FEUILLES.NOTIFICATIONS)
    .filter((n) => !statut || n.statut === statut)
    .map((n) => {
      const s = seances.find((x) => x.id === n.seance_id) || {};
      const e = eleves.find((x) => x.id === n.eleve_id) || {};
      return Object.assign(sansLigne(n), {
        matiere: s.matiere, date_seance: s.date_seance, heure_debut: s.heure_debut, classe: s.classe,
        nom: e.nom, prenom: e.prenom, parent_nom: e.parent_nom,
      });
    })
    .sort((a, b) => String(b.maj_le).localeCompare(String(a.maj_le)))
    .slice(0, 200);
}

/** Réservé à l'administrateur, ou à l'enseignant responsable de la séance concernée. */
function renvoyerNotification(jeton, notifId) {
  const u = exigerConnexion(jeton);
  const n = trouverParId(FEUILLES.NOTIFICATIONS, notifId);
  if (!n) throw new Error('Notification introuvable.');
  const seance = trouverParId(FEUILLES.SEANCES, n.seance_id);
  if (u.role !== 'admin' && (!seance || seance.enseignant_id !== u.id)) {
    throw new Error('Cette séance ne vous est pas attribuée.');
  }
  if (n.statut !== 'echoue') throw new Error('Seul un message échoué peut être renvoyé.');
  const eleve = trouverParId(FEUILLES.ELEVES, n.eleve_id);
  mettreAJour(FEUILLES.NOTIFICATIONS, notifId, { statut: 'en_attente' });
  tenterEnvoi(notifId, seance, eleve);
  return sansLigne(trouverParId(FEUILLES.NOTIFICATIONS, notifId));
}
