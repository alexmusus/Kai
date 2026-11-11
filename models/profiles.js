// @ts-check
/*
 * models/profiles.js — los perfiles y lo que comparten todos (.kai-compartido.json en la raíz de MEGA):
 * perfiles, intros aprendidas, fichas elegidas y claves de servicios (TMDB).
 *
 * Reglas:
 *  - Al juntar dos copias, de cada perfil/intro/clave gana la más reciente (`u`).
 *  - Dos perfiles con el mismo nombre (pasó en la v4) se juntan en el más antiguo: el otro queda borrado y
 *    apunta al que quedó (`mergedInto`), y su progreso se suma al de ese.
 */

import { state, visibleProfiles, saveShared } from './store.js';
import { LS, hue } from '../lib/util.js';
import { initKnown, announceNew } from './news.js';
import { findFolder, loadProfileState } from './library.js';

/** @typedef {import('./types.js').Profile} Profile */
/**
 * Lo compartido entre perfiles.
 * @typedef {object} Shared
 * @property {Profile[]} profiles
 * @property {Record<string, any>} intros   intros aprendidas por serie
 * @property {Record<string, any>} picks    fichas elegidas
 * @property {Record<string, { v: string, u: number }>} [keys] claves de servicios: { tmdb: { v, u } }
 * @property {string | null} legacyBy       el perfil que se quedó con el progreso de antes de que hubiera perfiles
 */

/* ── respaldo en MEGA ──
 * Los perfiles también se guardan en un atributo de la carpeta de la biblioteca: llega con la lista de archivos
 * de MEGA, sin descargar nada, así que se pueden ver aunque la cuota esté agotada. */
export const BACKUP_ATTR = 'kaip';

const libraryFolder = () => state.storage && findFolder(state.storage, state.settings.root);

/** Guarda el respaldo si cambió. Un fallo no importa: es solo un respaldo. */
export async function backupProfiles() {
  const folder = libraryFolder();
  if (!folder || typeof (/** @type {any} */ (folder).setAttributes) !== 'function') return;
  const want = visibleProfiles()
    .filter((p) => !(/** @type {any} */ (p).mergedInto))
    .map((/** @type {any} */ p) => ({ i: p.id, n: p.name, h: p.hue, c: p.created || 0, u: p.u || 0 }));
  if (
    !want.length ||
    JSON.stringify(/** @type {any} */ (folder.attributes || {})[BACKUP_ATTR]) === JSON.stringify(want)
  )
    return;
  try {
    await /** @type {any} */ (folder).setAttributes({ [BACKUP_ATTR]: want });
  } catch (err) {
    console.warn('respaldo de perfiles', err);
  }
}

/** Los perfiles del respaldo (para poder entrar aunque no se pueda leer .kai-compartido.json). @returns {Profile[]} */
export function profilesFromBackup() {
  const folder = /** @type {any} */ (libraryFolder());
  const b = folder && folder.attributes && folder.attributes[BACKUP_ATTR];
  return Array.isArray(b)
    ? b.filter((x) => x && x.i && x.n).map((x) => ({ id: x.i, name: x.n, hue: x.h, created: x.c, u: x.u }))
    : [];
}

/* ── juntar copias ── */

/**
 * Junta dos copias de lo compartido: de cada perfil, intro, ficha elegida o clave gana la más reciente.
 * Los perfiles quedan ordenados del más antiguo al más nuevo. No cambia ninguna de las dos.
 * @param {Partial<Shared>} a
 * @param {Partial<Shared>} b
 * @returns {Shared}
 */
export function mergeShared(a, b) {
  /** @param {Record<string, any> | undefined} x @param {Record<string, any> | undefined} y */
  const byU = (x, y) => {
    const out = { ...x };
    for (const [k, v] of Object.entries(y || {})) if (v && (!out[k] || (v.u || 0) > (out[k].u || 0))) out[k] = v;
    return out;
  };
  const byId = (/** @type {Profile[] | undefined} */ list) => Object.fromEntries((list || []).map((p) => [p.id, p]));
  const profiles = /** @type {any[]} */ (Object.values(byU(byId(a.profiles), byId(b.profiles))));
  return {
    profiles: profiles.sort((x, y) => (x.created || 0) - (y.created || 0)),
    intros: byU(a.intros, b.intros),
    picks: byU(a.picks, b.picks),
    keys: byU(a.keys, b.keys),
    legacyBy: a.legacyBy || b.legacyBy || null,
  };
}

/** Nombre para comparar perfiles: "Alex " y "alex" son el mismo. @param {unknown} n */
export const normName = (n) =>
  String(n || '')
    .trim()
    .toLocaleLowerCase('es');

/**
 * Perfiles con el mismo nombre se juntan en el más antiguo (el primero de la lista). Cambia state.shared.
 * @returns {boolean} si juntó alguno
 */
export function dedupeProfiles() {
  /** @type {Map<string, any>} */
  const keep = new Map();
  let changed = false;
  for (const p of /** @type {any[]} */ (state.shared.profiles)) {
    if (p.deleted) continue;
    const k = normName(p.name);
    const first = keep.get(k);
    if (!first) {
      keep.set(k, p);
      continue;
    }
    p.deleted = true;
    p.mergedInto = first.id;
    p.u = Date.now();
    if (state.shared.legacyBy === p.id) state.shared.legacyBy = first.id;
    changed = true;
  }
  return changed;
}

/** El perfil que quedó después de juntar duplicados (sigue la cadena, máximo 8 saltos). @param {string} id */
export function finalProfileId(id) {
  for (let i = 0; i < 8; i++) {
    const p = /** @type {any} */ (state.shared.profiles.find((x) => x.id === id));
    if (!p || !p.mergedInto) return id;
    id = p.mergedInto;
  }
  return id;
}

/* ── crear y elegir ── */

/** Colores de los avatares, en orden: cada perfil nuevo toma el primero que nadie usa. */
const AVATAR_HUES = [210, 340, 150, 30, 270, 190, 0, 90];

/**
 * Crea un perfil (queda por sincronizar). El primero se queda con el progreso de antes de que hubiera perfiles.
 * @param {string} name
 * @returns {Profile}
 */
export function addProfile(name) {
  const isFirst = !state.shared.profiles.length;
  const used = new Set(state.shared.profiles.map((/** @type {any} */ p) => p.hue));
  const p = {
    id: Math.random().toString(36).slice(2, 10),
    name,
    hue: AVATAR_HUES.find((h) => !used.has(h)) ?? hue(name),
    created: Date.now(),
    u: Date.now(),
  };
  state.shared.profiles.push(p);
  if (isFirst && !state.shared.legacyBy) state.shared.legacyBy = p.id;
  saveShared();
  if (isFirst) {
    const old = LS.get('progress', null);
    if (old) {
      LS.set(`p.${p.id}.progress`, old);
      LS.set(`p.${p.id}.dirty`, true);
      LS.del('progress');
      LS.del('dirty');
    }
  }
  return p;
}

/** Este dispositivo pasa a usar ese perfil: su progreso, su idioma elegido y sus novedades. @param {Profile} p */
export function useProfile(p) {
  state.profile = { id: p.id, name: p.name };
  LS.set('profile', state.profile);
  loadProfileState();
  initKnown();
  announceNew();
}

/* ── lo del reproductor que elige cada perfil (Ajustes) ──
 * Va en el perfil, dentro de lo compartido: se sincroniza con los demás dispositivos como el nombre o el color. */
export const HOLD_RATES = [0.5, 2, 3];
export const SEEK_STEPS = [5, 10, 15, 30];

/** @returns {Required<import('./types.js').ProfilePrefs>} */
export function profilePrefs() {
  const id = state.profile && state.profile.id;
  const p = id && /** @type {any} */ (state.shared.profiles.find((x) => x.id === id));
  const prefs = (p && p.prefs) || {};
  return {
    hold: HOLD_RATES.includes(prefs.hold) ? prefs.hold : 2,
    step: SEEK_STEPS.includes(prefs.step) ? prefs.step : 10,
  };
}

/**
 * El dibujo del avatar del perfil activo ('' = su inicial). Queda por sincronizar.
 * @param {string} key
 */
export function setProfileAvatar(key) {
  const id = state.profile && state.profile.id;
  const p = id && /** @type {any} */ (state.shared.profiles.find((x) => x.id === id));
  if (!p) return;
  if (key) p.avatar = key;
  else delete p.avatar;
  p.u = Date.now();
  saveShared();
}

/** Cambia una preferencia del perfil activo (queda por sincronizar). @param {'hold' | 'step'} key @param {number} value */
export function setProfilePref(key, value) {
  const id = state.profile && state.profile.id;
  const p = id && /** @type {any} */ (state.shared.profiles.find((x) => x.id === id));
  if (!p) return;
  p.prefs = { ...(p.prefs || {}), [key]: value };
  p.u = Date.now();
  saveShared();
}
