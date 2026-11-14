// Imitations en mémoire des services Google Apps Script (SpreadsheetApp, PropertiesService,
// LockService…) et chargement du code serveur (.gs) dans cet environnement.
// Utilisé par tests/simulation.cjs (tests) et tests/apercu-local.cjs (aperçu dans le navigateur).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const racine = path.join(__dirname, '..');
const FICHIERS = ['Code.gs', 'Auth.gs', 'Db.gs', 'Api.gs', 'WhatsApp.gs', 'Sauvegarde.gs'];

const signe = (b) => Array.from(b, (o) => (o > 127 ? o - 256 : o));
const octets = (a) => Buffer.from(a.map((o) => o & 255));

function creerFeuille(nom, cellulesInitiales) {
  const cellules = cellulesInitiales || []; // cellules[ligne][colonne], base 0
  const feuille = {
    lectures: 0,
    getName: () => nom,
    setName(n) { feuille.renommer(n); nom = n; },
    renommer() {}, // remplacé par le classeur qui contient la feuille
    // Comme dans Google Sheets : la copie arrive dans le classeur de destination sous le nom « Copie de … ».
    copyTo: (destination) => destination.ajouterFeuille('Copie de ' + nom, cellules.map((l) => l.slice())),
    getLastRow: () => cellules.length,
    getMaxRows: () => Math.max(cellules.length, 1000),
    setFrozenRows() {},
    deleteRow(n) { cellules.splice(n - 1, 1); },
    getDataRange: () => feuille.getRange(1, 1, Math.max(cellules.length, 1), Math.max(1, ...cellules.map((l) => l.length))),
    getRange(l, c, nl, nc) {
      return {
        getValues() {
          feuille.lectures++;
          const res = [];
          for (let i = 0; i < nl; i++) {
            const ligne = [];
            for (let j = 0; j < nc; j++) ligne.push((cellules[l - 1 + i] || [])[c - 1 + j] ?? '');
            res.push(ligne);
          }
          return res;
        },
        setValues(v) {
          v.forEach((ligne, i) => {
            while (cellules.length < l + i) cellules.push([]);
            ligne.forEach((val, j) => { cellules[l - 1 + i][c - 1 + j] = val; });
          });
        },
        setNumberFormats() {},
        setNumberFormat() {},
      };
    },
  };
  return feuille;
}

/**
 * Crée un environnement neuf (classeur vide) et y charge le code serveur.
 * Renvoie { S, noms, feuilles, classeurs, declencheurs, proprietes, cache, verrou, alertes, contexte } :
 *   S          toutes les fonctions du serveur, plus FEUILLES ;
 *   contexte   { dansSheets } : true = lancé depuis Google Sheets, false = application web.
 */
function creerEnvironnement(options) {
  const opt = Object.assign({ url: 'https://script.example/exec', fuseau: 'UTC' }, options);
  const feuilles = {};
  const proprietes = {};
  const cache = {};
  const alertes = [];
  const verrou = { tenu: false, prises: 0 };
  const contexte = { dansSheets: true };

  // Un classeur = un ensemble de feuilles. Le classeur principal utilise l'objet « feuilles » exposé aux tests.
  const classeurs = {};
  function creerClasseur(id, nom, sesFeuilles) {
    const c = {
      getId: () => id,
      getName: () => nom,
      rename(n) { nom = n; },
      getUrl: () => 'https://docs.example/' + id,
      getSpreadsheetTimeZone: () => opt.fuseau,
      getSheetByName: (n) => sesFeuilles[n] || null,
      insertSheet: (n) => c.ajouterFeuille(n),
      getSheets: () => Object.values(sesFeuilles),
      deleteSheet(f) {
        assert(Object.keys(sesFeuilles).length > 1, 'un classeur doit garder au moins une feuille');
        delete sesFeuilles[f.getName()];
      },
      ajouterFeuille(n, cellules) {
        assert(!sesFeuilles[n], 'une feuille porte déjà le nom ' + n);
        const f = creerFeuille(n, cellules);
        f.renommer = (nouveau) => {
          assert(!sesFeuilles[nouveau], 'une feuille porte déjà le nom ' + nouveau);
          delete sesFeuilles[f.getName()];
          sesFeuilles[nouveau] = f;
        };
        return (sesFeuilles[n] = f);
      },
      feuilles: sesFeuilles,
    };
    return (classeurs[id] = c);
  }
  const classeur = creerClasseur('classeur-test', 'Classeur de test', feuilles);
  const declencheurs = [];
  const interfaceSheets = { alert: (m) => alertes.push(m), ButtonSet: {}, Button: {} };
  const services = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => classeur,
      openById(id) { if (!classeurs[id]) throw new Error('classeur introuvable : ' + id); return classeurs[id]; },
      // Comme dans Google Sheets : un classeur neuf contient une feuille vide.
      create(nom) { const c = creerClasseur('classeur-' + crypto.randomUUID(), nom, {}); c.ajouterFeuille('Feuille 1'); return c; },
      flush() {},
      getUi() { if (!contexte.dansSheets) throw new Error('getUi indisponible dans ce contexte'); return interfaceSheets; },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in proprietes ? proprietes[k] : null),
        setProperty: (k, v) => { proprietes[k] = String(v); },
        deleteProperty: (k) => { delete proprietes[k]; },
        getProperties: () => Object.assign({}, proprietes),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); },
        remove: (k) => { delete cache[k]; },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() { assert(!verrou.tenu, 'verrou demandé alors qu\'il est déjà tenu (non réentrant)'); verrou.tenu = true; verrou.prises++; },
        releaseLock() { verrou.tenu = false; },
      }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 1 },
      Charset: { UTF_8: 1 },
      computeDigest: (a, t) => signe(crypto.createHash('sha256').update(t, 'utf8').digest()),
      computeHmacSha256Signature: (v, k) => signe(crypto.createHmac('sha256', octets(k)).update(octets(v)).digest()),
      // getAs() : la vraie conversion HTML -> PDF est faite par Google ; ici on renvoie un faux fichier.
      newBlob: (s) => ({ getBytes: () => signe(Buffer.from(s, 'utf8')), getAs: () => ({ getBytes: () => signe(Buffer.from('%PDF-faux')) }) }),
      base64Encode: (b) => octets(b).toString('base64'),
      formatDate(d, tz, f) {
        // Heure locale de la machine si fuseau « local », sinon UTC (suffisant pour les tests).
        const loc = opt.fuseau === 'local';
        const p = (n) => String(n).padStart(2, '0');
        return f.replace('yyyy', loc ? d.getFullYear() : d.getUTCFullYear())
          .replace('MM', p((loc ? d.getMonth() : d.getUTCMonth()) + 1))
          .replace('dd', p(loc ? d.getDate() : d.getUTCDate()))
          .replace('HH', p(loc ? d.getHours() : d.getUTCHours()))
          .replace('mm', p(loc ? d.getMinutes() : d.getUTCMinutes()))
          .replace('ss', p(loc ? d.getSeconds() : d.getUTCSeconds()));
      },
    },
    Session: { getScriptTimeZone: () => opt.fuseau },
    ScriptApp: {
      getService: () => ({ getUrl: () => opt.url }),
      getProjectTriggers: () => declencheurs.slice(),
      deleteTrigger(d) { declencheurs.splice(declencheurs.indexOf(d), 1); },
      newTrigger(fonction) {
        const d = { getHandlerFunction: () => fonction };
        const chaine = { timeBased: () => chaine, everyDays: () => chaine, atHour: () => chaine, create() { declencheurs.push(d); return d; } };
        return chaine;
      },
    },
    Logger: { log() {} },
    UrlFetchApp: { fetch() { throw new Error('aucun appel réseau n\'est fait hors de Google'); } },
    HtmlService: {},
  };

  const source = FICHIERS.map((f) => fs.readFileSync(path.join(racine, f), 'utf8')).join('\n');
  const noms = [...source.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]);
  const S = new Function(...Object.keys(services), `${source}\nreturn { ${noms.join(', ')}, FEUILLES };`)(...Object.values(services));
  return { S, noms, feuilles, classeurs, declencheurs, proprietes, cache, verrou, alertes, contexte };
}

module.exports = { creerEnvironnement, racine };
