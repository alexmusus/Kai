/*
 * models/library.js — la biblioteca: series, temporadas y capítulos armados desde el árbol de MEGA,
 * el índice de capítulos, el idioma elegido (Sub/Doblado) y el progreso que sigue a las carpetas renombradas.
 */

import { index, state, pkey, setIndex, saveProgressLocal } from './store.js';
import { LS } from '../lib/util.js';
import { baseName, episodeNumber, MIME, isVideoName, sortEpisodes, seasonInfo, langOf, twinKey } from './naming.js';
import { isSubtitleName } from '../subs.js';
import { goneNodes, C } from './mega.js';

/** Idiomas de una lista de capítulos, contando las versiones ocultas en el otro idioma. */
export function langsOf(eps) {
  const out = new Set();
  for (const ep of eps) {
    if (ep.lang) out.add(ep.lang);
    for (const path of (index.twins && index.twins.get(ep.path)) || []) { const t = index.byPath.get(path); if (t && t.ep.lang) out.add(t.ep.lang); }
  }
  return ['sub', 'dob'].filter((l) => out.has(l));
}

export function loadProfileState() {
  state.progress = LS.get(pkey('progress'), {});
  state.dirty = LS.get(pkey('dirty'), false);
  if (state.library && migrateProgressKeys(state.progress)) state.dirty = true; // rutas de carpetas renombradas
  try { if (state.library) setIndex(buildIndex(state.library)); } catch { /* aún no hay índice */ } // el idioma elegido es de cada perfil
}

export function nodePath(node) {
  const parts = [];
  for (let n = node; n && n.parent && n !== state.storage.root; n = n.parent) parts.unshift(n.name);
  return parts.join('/');
}

export function findFolder(storage, path) {
  const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
  let node = storage.root;
  for (const p of parts) {
    // si hay dos carpetas con el mismo nombre, se usa la que tiene más cosas (el orden en que MEGA las entrega puede cambiar)
    const same = (node.children || []).filter((c) => c.directory && c.name && c.name.toLowerCase() === p.toLowerCase());
    node = same.sort((a, b) => (b.children || []).length - (a.children || []).length)[0];
    if (!node) return null;
  }
  return node;
}

/** Capítulo a partir de un nodo de MEGA. `folderPath` es la ruta desde la raíz de MEGA. */
export function makeEpisode(f, folderPath, siblings = []) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const base = baseName(f.name);
  const subs = siblings
    .filter((s) => !s.directory && s.key && isSubtitleName(s.name) && !goneNodes.has(s.nodeId))
    .filter((s) => baseName(s.name) === base || baseName(s.name).startsWith(base + '.'))
    .map((s) => ({ id: s.nodeId, name: s.name, size: s.size, key: C.bytesToB64u(new Uint8Array(s.key)) }));
  return {
    id: f.nodeId,
    name: f.name,
    path: (folderPath ? folderPath + '/' : '') + f.name,
    ep: episodeNumber(f.name),
    size: f.size,
    key: C.bytesToB64u(new Uint8Array(f.key)),
    fa: f.fa || null,
    mime: MIME[ext] || 'video/mp4',
    ts: f.timestamp || 0, // cuándo llegó a MEGA, para "agregados recientemente"
    subs,
  };
}

export const isPlayable = (c) => !c.directory && c.name && isVideoName(c.name) && c.key && !goneNodes.has(c.nodeId);
export const visibleChildren = (n) => (n.children || []).filter((c) => c.name && !goneNodes.has(c.nodeId));

export function buildLibrary(storage) {
  const root = findFolder(storage, state.settings.root);
  if (!root) {
    const err = new Error('NOROOT');
    throw err;
  }
  const rootPath = nodePath(root);
  const series = [];
  for (const sf of visibleChildren(root).filter((c) => c.directory && !c.name.startsWith('.'))) {
    const seasons = [];
    const kids = visibleChildren(sf);
    const direct = kids.filter(isPlayable);
    if (direct.length) {
      seasons.push({ num: null, title: '', name: '', episodes: sortEpisodes(direct.map((f) => makeEpisode(f, rootPath + '/' + sf.name, kids))) });
    }
    for (const se of kids.filter((c) => c.directory)) {
      const sk = visibleChildren(se);
      const vids = sk.filter(isPlayable);
      if (!vids.length) continue;
      seasons.push({ ...seasonInfo(se.name), name: se.name, episodes: sortEpisodes(vids.map((f) => makeEpisode(f, rootPath + '/' + sf.name + '/' + se.name, sk))) });
    }
    if (!seasons.length) continue;
    seasons.sort((a, b) => (a.num ?? 9999) - (b.num ?? 9999) || a.name.localeCompare(b.name, 'es', { numeric: true }));
    const added = Math.max(0, ...seasons.flatMap((se) => se.episodes.map((e) => e.ts || 0)));
    series.push({ name: sf.name, folderId: sf.nodeId, seasons, added });
  }
  series.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  return { root: state.settings.root, rootId: root.nodeId, v: 2, series, updated: Date.now() };
}

export function buildIndex(lib) {
  const byId = new Map();
  const byPath = new Map();
  const twins = new Map(); // ruta → rutas del mismo capítulo en el otro idioma
  if (lib && lib.v === 2) {
    lib.series.forEach((s, si) => {
      s.all = [];
      s.full = [];
      s.langs = [];
      const pref = langPref(s);
      const heard = LS.get('alang', {}) || {};
      s.seasons.forEach((se, ki) => {
        const full = se.full || se.episodes;
        const groups = new Map();
        for (const ep of full) {
          ep.lang = langOf(ep.name) || heard[ep.id] || null;
          if (ep.lang && !s.langs.includes(ep.lang)) s.langs.push(ep.lang);
          const k = twinKey(ep);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(ep);
        }
        const isTwin = (g) => g.length > 1 && new Set(g.map((e) => e.lang)).size > 1;
        if ([...groups.values()].some(isTwin)) {
          se.full = full;
          se.langs = ['sub', 'dob'].filter((l) => full.some((e) => e.lang === l));
          // de cada capítulo, la versión elegida; si no existe en ese idioma, la otra
          se.episodes = full.filter((ep) => {
            const g = groups.get(twinKey(ep));
            if (!isTwin(g)) return true;
            return (g.find((e) => e.lang === pref) || g[0]) === ep;
          });
          for (const g of groups.values()) if (isTwin(g)) for (const e of g) twins.set(e.path, g.filter((x) => x !== e).map((x) => x.path));
        } else {
          delete se.full;
          se.langs = null;
          se.episodes = full;
        }
        for (const ep of full) {
          const entry = { ep, si, ki, ei: se.episodes.indexOf(ep) };
          byId.set(ep.id, entry);
          byPath.set(ep.path, entry);
          s.full.push(ep);
        }
        s.all.push(...se.episodes);
      });
    });
  }
  return { byId, byPath, twins };
}
/** Idioma que se muestra de una serie con las dos versiones: el que elegiste aquí; si no, el del último capítulo
 *  que viste de ella (así se sigue igual en otro dispositivo); si no, el último que elegiste en cualquier serie. */
// (con function: el índice se arma antes de que exista pkey)
export function langKey(k) { return `p.${state.profile ? state.profile.id : '_'}.${k}`; }
export function langPref(s) {
  const own = (LS.get(langKey('lang'), {}) || {})[s.name];
  if (own) return own;
  let best = null;
  for (const se of s.seasons) for (const ep of se.full || se.episodes) {
    const p = state.progress[ep.path];
    const l = p && langOf(ep.name);
    if (l && (!best || (p.u || 0) > best.u)) best = { u: p.u || 0, l };
  }
  return best ? best.l : LS.get(langKey('langLast'), 'sub');
}
/** Si el archivo no dice SUB/DOB en el nombre, el idioma del audio lo dice: español = doblado, japonés = sub. */
export function learnAudioLang(ep, code) {
  if (!ep || langOf(ep.name)) return;
  const l = /^(spa|es|esl|esp)$/i.test(code || '') ? 'dob' : /^(jpn|ja)$/i.test(code || '') ? 'sub' : '';
  if (!l) return;
  const heard = LS.get('alang', {}) || {};
  if (heard[ep.id] === l) return;
  heard[ep.id] = l;
  LS.set('alang', heard);
  setIndex(buildIndex(state.library));
}
export function setLangPref(s, lang) {
  const all = LS.get(pkey('lang'), {}) || {};
  all[s.name] = lang;
  LS.set(pkey('lang'), all);
  LS.set(pkey('langLast'), lang);
  setIndex(buildIndex(state.library));
}

export function setLibrary(lib) {
  rememberPaths(state.library); // las rutas de antes, por si se renombró o movió una carpeta
  // si no cabe, mejor no dejar guardada una biblioteca vieja (se mostraría al abrir Kai hasta conectar con MEGA)
  if (!LS.set('library', lib)) LS.del('library');
  state.library = lib;
  setIndex(buildIndex(lib));
  rememberPaths(lib);
  if (migrateProgressKeys(state.progress)) { state.dirty = true; saveProgressLocal(); }
}

/* El progreso se guarda por ruta del archivo. MEGA le da a cada archivo un id que no cambia al renombrar o mover,
 * así que Kai recuerda qué ruta tuvo cada id: si una carpeta cambia de nombre, lo visto pasa a la ruta nueva. */
export function rememberPaths(lib) {
  if (!lib || lib.v !== 2) return;
  const known = LS.get('pathIds', {}) || {};
  let changed = false;
  for (const s of lib.series) for (const se of s.seasons) for (const ep of se.full || se.episodes) {
    if (known[ep.path] !== ep.id) { known[ep.path] = ep.id; changed = true; }
  }
  if (changed) LS.set('pathIds', known);
}

export function librarySignature(lib) {
  if (!lib) return '';
  return lib.root + '|' + lib.series.map((s) => s.name + '@' + (s.added || 0) + ':' + s.seasons.map((se) => se.name + '=' + (se.full || se.episodes).map((e) => e.id + (e.fa ? '+' : '') + e.subs.length).join(',')).join(';')).join('|');
}

/** La versión 1 guardaba rutas relativas a la carpeta de series; ahora son desde la raíz de MEGA. */
export function migrateProgressKeys(obj) {
  if (!state.library || !state.library.series) return false;
  const prefix = state.settings.root.replace(/^\/+|\/+$/g, '') + '/';
  let changed = false;
  const known = LS.get('pathIds', {}) || {};
  for (const k of Object.keys(obj)) {
    if (index.byPath.has(k)) continue;
    let nk = index.byPath.has(prefix + k) ? prefix + k : null;
    if (!nk && known[k]) { const e = index.byId.get(known[k]); if (e && e.ep.path !== k) nk = e.ep.path; } // carpeta renombrada o movida
    if (!nk) continue;
    if (!obj[nk] || obj[nk].u < obj[k].u) obj[nk] = obj[k];
    delete obj[k];
    changed = true;
  }
  return changed;
}
