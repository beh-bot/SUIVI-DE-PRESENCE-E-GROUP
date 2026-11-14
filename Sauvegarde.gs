// ═══════════════════════════════════════════════════════════════════════
// Sauvegarde du classeur : une copie des feuilles de données dans un autre classeur
// Google Sheets, rangé dans le Google Drive du propriétaire.
//   - « Sauvegarder maintenant » (menu) : crée un nouveau classeur daté à chaque fois.
//   - Sauvegarde automatique : chaque nuit, dans 7 classeurs qui tournent (un par jour de
//     la semaine, réécrit la semaine suivante). On garde donc toujours 7 jours d'historique
//     sans que les fichiers s'accumulent.
// Pour restaurer, voir DOCS/08-corbeille-et-sauvegarde.md.
// ═══════════════════════════════════════════════════════════════════════

const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const FONCTION_SAUVEGARDE_AUTO = 'sauvegardeAutomatique';
const DELAI_MIN_SAUVEGARDE_AUTO_MS = 20 * 60 * 60 * 1000;

function nomSauvegarde_(precision) {
  const quand = Utilities.formatDate(new Date(), fuseauClasseur_(), 'yyyy-MM-dd HH:mm');
  return 'Sauvegarde Suivi de présence – ' + (precision ? precision + ' – ' : '') + quand;
}

/**
 * Remplace le contenu du classeur de destination par une copie des feuilles de données.
 * Sous verrou : aucune écriture ne peut avoir lieu pendant la copie, les feuilles copiées
 * sont donc cohérentes entre elles (pas de pointage sans sa séance, par exemple).
 */
function copierDonneesVers_(destination) {
  avecVerrou_(() => {
    const source = classeur_();
    const anciennes = destination.getSheets();
    const copies = [];
    Object.keys(FEUILLES).forEach((cle) => {
      const f = source.getSheetByName(FEUILLES[cle].nom);
      if (f) copies.push({ nom: FEUILLES[cle].nom, feuille: f.copyTo(destination) });
    });
    if (!copies.length) throw new Error('Aucune feuille de données à sauvegarder. Lancez « 1) Initialiser les feuilles ».');
    // Un classeur doit toujours garder au moins une feuille : on supprime les anciennes après avoir ajouté les nouvelles.
    anciennes.forEach((f) => destination.deleteSheet(f));
    copies.forEach((c) => c.feuille.setName(c.nom));
  });
}

// ── Menu Google Sheets ────────────────────────────────────────────────

function sauvegarderMaintenant() {
  const ui = SpreadsheetApp.getUi(); // échoue hors de Google Sheets : réservé au menu
  try {
    const destination = SpreadsheetApp.create(nomSauvegarde_('manuelle'));
    copierDonneesVers_(destination);
    ui.alert('Sauvegarde créée dans votre Google Drive :\n\n' + destination.getName() + '\n' + destination.getUrl());
  } catch (e) {
    ui.alert('Erreur : ' + e.message);
  }
}

function retirerDeclencheursSauvegarde_() {
  ScriptApp.getProjectTriggers().forEach((d) => {
    if (d.getHandlerFunction() === FONCTION_SAUVEGARDE_AUTO) ScriptApp.deleteTrigger(d);
  });
}

function activerSauvegardeAutomatique() {
  const ui = SpreadsheetApp.getUi();
  try {
    retirerDeclencheursSauvegarde_(); // jamais deux déclencheurs pour la même sauvegarde
    ScriptApp.newTrigger(FONCTION_SAUVEGARDE_AUTO).timeBased().everyDays(1).atHour(2).create();
    PropertiesService.getScriptProperties().setProperty('SAUVEGARDE_AUTO', 'oui');
    ui.alert('Sauvegarde automatique activée : une copie des données sera faite chaque nuit, vers 2 h, dans votre Google Drive. Les 7 derniers jours sont conservés.');
  } catch (e) {
    ui.alert('Erreur : ' + e.message);
  }
}

function desactiverSauvegardeAutomatique() {
  const ui = SpreadsheetApp.getUi();
  try {
    retirerDeclencheursSauvegarde_();
    PropertiesService.getScriptProperties().deleteProperty('SAUVEGARDE_AUTO');
    ui.alert('Sauvegarde automatique désactivée. Les sauvegardes déjà faites restent dans votre Google Drive.');
  } catch (e) {
    ui.alert('Erreur : ' + e.message);
  }
}

// ── Sauvegarde automatique (appelée par le déclencheur, chaque nuit) ──

/**
 * Cette fonction doit garder un nom sans « _ » pour que le déclencheur puisse l'appeler. Elle est
 * donc aussi appelable depuis le navigateur, par n'importe qui. Deux garde-fous la rendent sans
 * danger : elle ne fait rien si la sauvegarde automatique n'a pas été activée depuis le menu, et
 * rien non plus si une sauvegarde automatique a déjà eu lieu dans les 20 dernières heures. Elle ne
 * prend aucun paramètre et ne renvoie rien.
 */
function sauvegardeAutomatique() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SAUVEGARDE_AUTO') !== 'oui') return;
  const derniere = Number(props.getProperty('SAUVEGARDE_DERNIERE_MS')) || 0;
  if (Date.now() - derniere < DELAI_MIN_SAUVEGARDE_AUTO_MS) return;
  props.setProperty('SAUVEGARDE_DERNIERE_MS', String(Date.now()));

  const p = aujourdhui_().split('-').map(Number);
  const jour = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); // 0 = dimanche … 6 = samedi
  const cle = 'SAUVEGARDE_JOUR_' + jour;
  const nom = nomSauvegarde_(JOURS_FR[jour]);
  let destination = null;
  const id = props.getProperty(cle);
  if (id) {
    try {
      destination = SpreadsheetApp.openById(id);
      destination.rename(nom);
    } catch (e) {
      destination = null; // le classeur de ce jour a été supprimé : on en recrée un
    }
  }
  if (!destination) {
    destination = SpreadsheetApp.create(nom);
    props.setProperty(cle, destination.getId());
  }
  try {
    copierDonneesVers_(destination);
  } catch (e) {
    props.setProperty('SAUVEGARDE_DERNIERE_MS', String(derniere)); // échec : on pourra réessayer sans attendre 20 h
    throw e; // Google prévient alors le propriétaire par e-mail (échec d'un déclencheur)
  }
}
