// @ts-check
/*
 * models/library.js — la biblioteca: series, temporadas y capítulos armados desde el árbol de MEGA,
 * el índice de capítulos, el idioma elegido (Sub/Doblado) y el progreso que sigue a las carpetas renombradas.
 */

import { index, state, pkey, setIndex, saveProgressLocal } from './store.js';
import { LS } from '../lib/util.js';
import { baseName, episodeNumber, MIME, isVideoName, sortEpisodes, seasonInfo, langOf, twinKey } from './naming.js';
import { isSubtitleName } from '../subs.js';
import { C, isGone, visibleChildren } from './mega.js';

/** @typedef {import('./types.js').Library} Library */
/** @typedef {import('./types.js').LibraryIndex} LibraryIndex */
/** @typedef {import('./types.js').IndexEntry} IndexEntry */
/** @typedef {import('./types.js').Series} Series */
/** @typedef {import('./types.js').Season} Season */
/** @typedef {import('./types.js').Episode} Episode */
/** @typedef {import('./types.js').Lang} Lang */
/** @typedef {import('./types.js').MegaNode} MegaNode */
/** @typedef {import('./types.js').ProgressMap} ProgressMap */

// claves de localStorage de este módulo (con el prefijo kai.)
const KEY_LIBRARY = 'library';
const KEY_PATH_IDS = 'pathIds'; // ruta → id de MEGA que tuvo, para seguir carpetas renombradas
const KEY_HEARD_LANG = 'alang'; // id → idioma que se oyó en el audio (archivos sin SUB/DOB en el nombre)
const KEY_LANG = 'lang'; //       por perfil: nombre de la serie → idioma elegido
const KEY_LANG_LAST = 'langLast'; // por perfil: el último idioma elegido en cualquier serie

const LANGS = /** @type {Lang[]} */ (['sub', 'dob']);

/* ── del árbol de MEGA a la biblioteca ── */

/**
 * Ruta de un nodo desde la raíz de MEGA ("Anime/Fate/1. UBW").
 * @param {MegaNode | null | undefined} node
 * @param {MegaNode | null | undefined} [root] la raíz de la cuenta (por omisión, la de la sesión)
 */
export function nodePath(node, root = state.storage && state.storage.root) {
  const parts = [];
  for (let n = node; n && n.parent && n !== root; n = n.parent) parts.unshift(n.name);
  return parts.join('/');
}

/**
 * La carpeta en esa ruta, sin distinguir mayúsculas. Si hay dos con el mismo nombre se usa la que tiene más cosas
 * (el orden en que MEGA las entrega puede cambiar).
 * @param {{ root: MegaNode }} storage
 * @param {string} path
 * @returns {MegaNode | null}
 */
export function findFolder(storage, path) {
  const parts = path
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  let node = storage.root;
  for (const p of parts) {
    const same = (node.children || []).filter((c) => c.directory && c.name && c.name.toLowerCase() === p.toLowerCase());
    const pick = same.sort((a, b) => (b.children || []).length - (a.children || []).length)[0];
    if (!pick) return null;
    node = pick;
  }
  return node;
}

const keyOf = (/** @type {MegaNode} */ n) => C.bytesToB64u(new Uint8Array(/** @type {ArrayLike<number>} */ (n.key)));

/** @param {MegaNode} c */
export const isPlayable = (c) => !c.directory && !!c.name && isVideoName(c.name) && !!c.key && !isGone(c);

/**
 * Capítulo a partir de un nodo de MEGA, con los subtítulos sueltos que se llaman igual ("x.mp4" → "x.srt", "x.es.srt").
 * @param {MegaNode} f
 * @param {string} folderPath ruta de su carpeta desde la raíz de MEGA
 * @param {MegaNode[]} [siblings] lo demás que hay en la carpeta
 * @returns {Episode}
 */
export function makeEpisode(f, folderPath, siblings = []) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const base = baseName(f.name);
  const subs = siblings
    .filter((s) => !s.directory && s.key && isSubtitleName(s.name) && !isGone(s))
    .filter((s) => baseName(s.name) === base || baseName(s.name).startsWith(base + '.'))
    .map((s) => ({ id: s.nodeId, name: s.name, size: s.size || 0, key: keyOf(s) }));
  return {
    id: f.nodeId,
    name: f.name,
    path: (folderPath ? folderPath + '/' : '') + f.name,
    ep: episodeNumber(f.name),
    size: f.size || 0,
    key: keyOf(f),
    fa: f.fa || null,
    mime: MIME[ext] || 'video/mp4',
    ts: f.timestamp || 0, // cuándo llegó a MEGA, para "agregados recientemente"
    subs,
  };
}

/** @param {MegaNode[]} files @param {string} folderPath @param {MegaNode[]} siblings */
const episodesOf = (files, folderPath, siblings) =>
  sortEpisodes(files.map((f) => makeEpisode(f, folderPath, siblings)));
const byName = (/** @type {string} */ a, /** @type {string} */ b) => a.localeCompare(b, 'es', { numeric: true });

/**
 * Una serie: los videos sueltos en su carpeta son una temporada sin número; cada subcarpeta con videos, otra.
 * @param {MegaNode} folder
 * @param {string} rootPath
 * @returns {Series | null} null si no tiene videos
 */
function buildSeries(folder, rootPath) {
  const path = rootPath + '/' + folder.name;
  const kids = visibleChildren(folder);
  /** @type {Season[]} */
  const seasons = [];
  const direct = kids.filter(isPlayable);
  if (direct.length) seasons.push({ num: null, title: '', name: '', episodes: episodesOf(direct, path, kids) });
  for (const sub of kids.filter((c) => c.directory)) {
    const inner = visibleChildren(sub);
    const videos = inner.filter(isPlayable);
    if (videos.length)
      seasons.push({
        ...seasonInfo(sub.name),
        name: sub.name,
        episodes: episodesOf(videos, path + '/' + sub.name, inner),
      });
  }
  if (!seasons.length) return null;
  seasons.sort((a, b) => (a.num ?? 9999) - (b.num ?? 9999) || byName(a.name, b.name));
  const added = Math.max(0, ...seasons.flatMap((se) => se.episodes.map((e) => e.ts || 0)));
  return { name: folder.name, folderId: folder.nodeId, seasons, added };
}

/**
 * Arma la biblioteca desde la carpeta de series (Ajustes → carpeta; por omisión "Anime").
 * Cada subcarpeta (que no empiece con ".") es una serie. Lanza Error('NOROOT') si la carpeta no existe.
 * @param {{ root: MegaNode }} storage
 * @param {string} [rootSetting]
 * @returns {Library}
 */
export function buildLibrary(storage, rootSetting = state.settings.root) {
  const root = findFolder(storage, rootSetting);
  if (!root) throw new Error('NOROOT');
  const rootPath = nodePath(root, storage.root);
  const series = visibleChildren(root)
    .filter((c) => c.directory && !c.name.startsWith('.'))
    .map((folder) => buildSeries(folder, rootPath))
    .filter((s) => s !== null)
    .sort((a, b) => byName(a.name, b.name));
  return { root: rootSetting, rootId: root.nodeId, v: 2, series, updated: Date.now() };
}

/* ── índice e idiomas ── */

/** Gemelos: el mismo capítulo en Sub y en Doblado. */
const isTwinGroup = (/** @type {Episode[]} */ g) => g.length > 1 && new Set(g.map((e) => e.lang)).size > 1;

/**
 * Elige, de cada capítulo con dos idiomas, el que se muestra. Cambia la temporada (episodes, full, langs).
 * @param {Season} se
 * @param {Lang} pref
 * @param {Map<string, string[]>} twins se llenan aquí
 */
function applyLanguage(se, pref, twins) {
  const full = se.full || se.episodes;
  /** @type {Map<string, Episode[]>} */
  const groups = new Map();
  for (const ep of full) {
    const k = twinKey(ep);
    const g = groups.get(k);
    if (g) g.push(ep);
    else groups.set(k, [ep]);
  }
  if (![...groups.values()].some(isTwinGroup)) {
    delete se.full;
    se.langs = null;
    se.episodes = full;
    return;
  }
  se.full = full;
  se.langs = LANGS.filter((l) => full.some((e) => e.lang === l));
  // de cada capítulo, la versión elegida; si no existe en ese idioma, la otra
  se.episodes = full.filter((ep) => {
    const g = /** @type {Episode[]} */ (groups.get(twinKey(ep)));
    return !isTwinGroup(g) || (g.find((e) => e.lang === pref) || g[0]) === ep;
  });
  for (const g of groups.values()) {
    if (!isTwinGroup(g)) continue;
    for (const e of g)
      twins.set(
        e.path,
        g.filter((x) => x !== e).map((x) => x.path),
      );
  }
}

/**
 * Índice de capítulos por id y por ruta. Además deja en la biblioteca lo que depende del perfil:
 * el idioma de cada capítulo, la versión que se muestra de cada uno y las listas s.all / s.full.
 * @param {Library | null | undefined} lib
 * @returns {LibraryIndex}
 */
export function buildIndex(lib) {
  /** @type {LibraryIndex} */
  const ix = { byId: new Map(), byPath: new Map(), twins: new Map() };
  if (!lib || lib.v !== 2) return ix;
  const heard = LS.get(KEY_HEARD_LANG, {}) || {};
  lib.series.forEach((s, si) => {
    s.all = [];
    s.full = [];
    s.langs = [];
    const pref = langPref(s);
    s.seasons.forEach((se, ki) => {
      for (const ep of se.full || se.episodes) {
        ep.lang = langOf(ep.name) || heard[ep.id] || null;
        if (ep.lang && !s.langs?.includes(ep.lang)) s.langs?.push(ep.lang);
      }
      applyLanguage(se, pref, ix.twins);
      for (const ep of se.full || se.episodes) {
        /** @type {IndexEntry} */
        const entry = { ep, si, ki, ei: se.episodes.indexOf(ep) };
        ix.byId.set(ep.id, entry);
        ix.byPath.set(ep.path, entry);
        s.full?.push(ep);
      }
      s.all?.push(...se.episodes);
    });
  });
  return ix;
}

const rebuildIndex = () => setIndex(buildIndex(state.library));

/**
 * Idioma que se muestra de una serie con las dos versiones: el que elegiste aquí; si no, el del último capítulo
 * que viste de ella (así se sigue igual en otro dispositivo); si no, el último que elegiste en cualquier serie.
 * @param {Series} s
 * @returns {Lang}
 */
export function langPref(s) {
  const own = (LS.get(pkey(KEY_LANG), {}) || {})[s.name];
  if (own) return own;
  /** @type {{ u: number, l: Lang } | null} */
  let best = null;
  for (const se of s.seasons) {
    for (const ep of se.full || se.episodes) {
      const p = state.progress[ep.path];
      const l = p && langOf(ep.name);
      if (l && (!best || (p.u || 0) > best.u)) best = { u: p.u || 0, l };
    }
  }
  return best ? best.l : LS.get(pkey(KEY_LANG_LAST), 'sub');
}

/**
 * Si el archivo no dice SUB/DOB en el nombre, el idioma del audio lo dice: español = doblado, japonés = sub.
 * @param {Episode | null | undefined} ep
 * @param {string} [code] idioma de la pista de audio (ISO 639)
 */
export function learnAudioLang(ep, code) {
  if (!ep || langOf(ep.name)) return;
  const l = /^(spa|es|esl|esp)$/i.test(code || '') ? 'dob' : /^(jpn|ja)$/i.test(code || '') ? 'sub' : '';
  if (!l) return;
  const heard = LS.get(KEY_HEARD_LANG, {}) || {};
  if (heard[ep.id] === l) return;
  heard[ep.id] = l;
  LS.set(KEY_HEARD_LANG, heard);
  rebuildIndex();
}

/** @param {Series} s @param {Lang} lang */
export function setLangPref(s, lang) {
  const all = LS.get(pkey(KEY_LANG), {}) || {};
  all[s.name] = lang;
  LS.set(pkey(KEY_LANG), all);
  LS.set(pkey(KEY_LANG_LAST), lang);
  rebuildIndex();
}

/**
 * Idiomas de una lista de capítulos, contando las versiones ocultas en el otro idioma.
 * @param {Episode[]} eps
 * @returns {Lang[]}
 */
export function langsOf(eps) {
  const out = new Set();
  for (const ep of eps) {
    if (ep.lang) out.add(ep.lang);
    for (const path of index.twins.get(ep.path) || []) {
      const t = index.byPath.get(path);
      if (t && t.ep.lang) out.add(t.ep.lang);
    }
  }
  return LANGS.filter((l) => out.has(l));
}

/* ── guardar la biblioteca y seguir las carpetas renombradas ── */

/**
 * La biblioteca nueva pasa a ser la actual: se guarda, se rearma el índice y el progreso de las rutas viejas
 * pasa a las nuevas.
 * @param {Library} lib
 */
export function setLibrary(lib) {
  rememberPaths(state.library); // las rutas de antes, por si se renombró o movió una carpeta
  // si no cabe, mejor no dejar guardada una biblioteca vieja (se mostraría al abrir Kai hasta conectar con MEGA)
  if (!LS.set(KEY_LIBRARY, lib)) LS.del(KEY_LIBRARY);
  state.library = lib;
  setIndex(buildIndex(lib));
  rememberPaths(lib);
  if (migrateProgressKeys(state.progress)) {
    state.dirty = true;
    saveProgressLocal();
  }
}

/**
 * El progreso se guarda por ruta del archivo. MEGA le da a cada archivo un id que no cambia al renombrar o mover,
 * así que Kai recuerda qué ruta tuvo cada id: si una carpeta cambia de nombre, lo visto pasa a la ruta nueva.
 * @param {Library | null | undefined} lib
 */
export function rememberPaths(lib) {
  if (!lib || lib.v !== 2) return;
  const known = LS.get(KEY_PATH_IDS, {}) || {};
  let changed = false;
  for (const s of lib.series) {
    for (const se of s.seasons) {
      for (const ep of se.full || se.episodes) {
        if (known[ep.path] === ep.id) continue;
        known[ep.path] = ep.id;
        changed = true;
      }
    }
  }
  if (changed) LS.set(KEY_PATH_IDS, known);
}

/**
 * Pasa el progreso guardado con rutas viejas a las rutas actuales: las de la versión 1 (relativas a la carpeta de
 * series) y las de carpetas renombradas o movidas. Si las dos rutas tienen progreso, gana el más reciente.
 * Lo que no se reconoce se deja como está. Cambia `obj`.
 * @param {ProgressMap} obj
 * @returns {boolean} si cambió algo
 */
export function migrateProgressKeys(obj) {
  if (!state.library || !state.library.series) return false;
  const prefix = state.settings.root.replace(/^\/+|\/+$/g, '') + '/';
  const known = LS.get(KEY_PATH_IDS, {}) || {};
  let changed = false;
  for (const k of Object.keys(obj)) {
    if (index.byPath.has(k)) continue;
    let nk = index.byPath.has(prefix + k) ? prefix + k : null;
    if (!nk && known[k]) {
      const e = index.byId.get(known[k]); // carpeta renombrada o movida
      if (e && e.ep.path !== k) nk = e.ep.path;
    }
    if (!nk) continue;
    if (!obj[nk] || obj[nk].u < obj[k].u) obj[nk] = obj[k];
    delete obj[k];
    changed = true;
  }
  return changed;
}

/**
 * Firma de lo que se ve de la biblioteca: si no cambia, no hace falta guardarla ni volver a dibujar.
 * @param {Library | null | undefined} lib
 */
export function librarySignature(lib) {
  if (!lib) return '';
  const ep = (/** @type {Episode} */ e) => e.id + (e.fa ? '+' : '') + e.subs.length;
  const season = (/** @type {Season} */ se) => se.name + '=' + (se.full || se.episodes).map(ep).join(',');
  const series = (/** @type {Series} */ s) => `${s.name}@${s.added || 0}:${s.seasons.map(season).join(';')}`;
  return lib.root + '|' + lib.series.map(series).join('|');
}

/* ── perfil ── */

/** Carga el progreso del perfil elegido y rearma el índice (el idioma elegido es de cada perfil). */
export function loadProfileState() {
  state.progress = LS.get(pkey('progress'), {});
  state.dirty = LS.get(pkey('dirty'), false);
  if (state.library && migrateProgressKeys(state.progress)) state.dirty = true; // rutas de carpetas renombradas
  try {
    if (state.library) rebuildIndex();
  } catch {
    /* una biblioteca guardada dañada: se rearma al conectar con MEGA */
  }
}
