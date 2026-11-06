// @ts-check
/*
 * models/profile-copies.js — separar lo que se copió de un perfil a otro.
 *
 * Hasta Kai 40, cambiar de perfil mientras se sincronizaba juntaba lo visto (y Más tarde) del perfil anterior con
 * el nuevo, y al revés. Lo copiado quedó idéntico en los dos, hasta el milisegundo en que se marcó, cosa que no
 * pasa cuando dos personas ven lo mismo por su cuenta. Aquí se encuentra eso, se agrupa por serie, y cuando eliges
 * de quién era se quita del otro perfil con una marca más reciente (que gana al sincronizar en todos los
 * dispositivos, porque al juntar copias manda la más reciente).
 */

import { LS, stable } from '../lib/util.js';
import { state, profileFile, saveProgressLocal } from './store.js';
import { filesNamed, readJson as realReadJson, writeJson as realWriteJson } from './mega.js';
import { mergeProgress } from './progress.js';
import { migrateProgressKeys } from './library.js';

/** @typedef {import('./types.js').MegaNode} MegaNode */
/** @typedef {import('./types.js').ProgressMap} ProgressMap */
/** @typedef {{ readJson: (n: any) => Promise<any>, writeJson: (folder: any, name: string, obj: unknown, replaced: any[]) => Promise<any> }} CopiesIO */
/** @typedef {{ name: string, keys: string[], pids: string[], eps: number, later: boolean }} CopyGroup */

/** @type {CopiesIO} */
const REAL_IO = { readJson: (n) => realReadJson(n), writeJson: realWriteJson };

const LATER = '@later/';

/**
 * Lo visto de un perfil, tal como está en MEGA (y, si es el de este dispositivo, junto con lo de aquí).
 * Si un archivo no se puede leer, falla: nunca se supone que algo no está.
 * @param {MegaNode} home @param {string} pid @param {CopiesIO} [io]
 * @returns {Promise<ProgressMap>}
 */
export async function readProfileItems(home, pid, io = REAL_IO) {
  /** @type {ProgressMap} */
  let items = {};
  for (const n of filesNamed(home, profileFile(pid))) {
    const data = await io.readJson(n);
    if (!data || !data.items) continue;
    migrateProgressKeys(data.items);
    items = mergeProgress(items, data.items);
  }
  if (state.profile && state.profile.id === pid) items = mergeProgress(items, state.progress);
  return items;
}

/**
 * Las entradas que están idénticas en dos o más perfiles (copias). Las de otro tipo ("@now", lo que quedó a medias
 * en otro dispositivo) no cuentan.
 * @param {Record<string, ProgressMap>} byProfile
 * @returns {Map<string, string[]>} entrada → perfiles que la tienen igual
 */
export function findCopies(byProfile) {
  /** @type {Map<string, Map<string, string[]>>} */
  const seen = new Map();
  for (const [pid, items] of Object.entries(byProfile)) {
    for (const [k, v] of Object.entries(items || {})) {
      if (!v || typeof v.u !== 'number' || (k.startsWith('@') && !k.startsWith(LATER))) continue;
      if (k.startsWith(LATER) ? !v.on : !(v.w || (v.t || 0) > 0)) continue; // lo que está "quitado" no molesta
      const same = seen.get(k) || new Map();
      const sig = stable(v);
      same.set(sig, [...(same.get(sig) || []), pid]);
      seen.set(k, same);
    }
  }
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const [k, same] of seen) for (const pids of same.values()) if (pids.length > 1) out.set(k, pids);
  return out;
}

/**
 * Las copias agrupadas por serie (y por qué perfiles las comparten), para elegir de quién es cada grupo.
 * @param {Map<string, string[]>} copies
 * @param {{ series: { name: string, all: { path: string }[] }[] } | null} library
 * @returns {CopyGroup[]}
 */
export function groupCopies(copies, library) {
  /** @type {Map<string, string>} */
  const seriesOf = new Map();
  for (const s of (library && library.series) || []) for (const e of s.all || []) seriesOf.set(e.path, s.name);
  /** @type {Map<string, CopyGroup>} */
  const groups = new Map();
  for (const [k, pids] of copies) {
    const later = k.startsWith(LATER);
    const name = later ? k.slice(LATER.length).split('/')[0] : seriesOf.get(k) || 'Otros';
    const who = [...pids].sort();
    const id = name + '\u0000' + who.join(',');
    const g = groups.get(id) || { name, keys: [], pids: who, eps: 0, later: false };
    g.keys.push(k);
    if (later) g.later = true;
    else g.eps++;
    groups.set(id, g);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
}

/**
 * Quita esas entradas de un perfil: quedan como no vistas / fuera de Más tarde, con una marca más reciente que la
 * copia, así ganan al juntar en cualquier dispositivo.
 * @param {ProgressMap} items @param {string[]} keys @param {number} now
 * @returns {ProgressMap} solo las marcas nuevas
 */
export function removals(items, keys, now) {
  /** @type {ProgressMap} */
  const out = {};
  for (const k of keys) {
    const cur = /** @type {any} */ (items[k] || {});
    out[k] = /** @type {any} */ (
      k.startsWith(LATER) ? { on: false, u: now } : { t: 0, d: cur.d || 0, w: false, u: now }
    );
  }
  return out;
}

/**
 * Quita esas entradas del perfil `pid`: en MEGA, en la copia de este dispositivo y, si es el perfil activo, en lo
 * que se ve ahora.
 * @param {MegaNode} home @param {string} pid @param {string[]} keys @param {CopiesIO} [io]
 */
export async function dropFromProfile(home, pid, keys, io = REAL_IO) {
  const nodes = filesNamed(home, profileFile(pid));
  /** @type {ProgressMap} */
  let remote = {};
  for (const n of nodes) {
    const data = await io.readJson(n);
    if (data && data.items) remote = mergeProgress(remote, data.items);
  }
  const marks = removals(remote, keys, Date.now());
  const items = mergeProgress(remote, marks);
  await io.writeJson(home, profileFile(pid), { v: 3, app: 'kai', profile: pid, items }, nodes);
  if (state.profile && state.profile.id === pid) {
    state.progress = mergeProgress(state.progress, marks);
    saveProgressLocal();
  } else {
    const local = LS.get(`p.${pid}.progress`, null);
    if (local) LS.set(`p.${pid}.progress`, mergeProgress(local, marks));
  }
}
