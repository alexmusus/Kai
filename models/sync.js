// @ts-check
/*
 * models/sync.js — juntar lo de este dispositivo con lo que hay en MEGA, y dejar en MEGA una sola copia al día.
 *
 *  1. Lo compartido (.kai-compartido.json): perfiles, intros, fichas elegidas, claves.
 *  2. El progreso de cada perfil con algo pendiente en este dispositivo (.kai-progreso-<perfil>.json), sumando el de
 *     antes de que hubiera perfiles y el de perfiles duplicados que se juntaron con ese.
 *
 * Regla de Kai: si un archivo no se pudo LEER, todo se detiene con error y no se escribe nada (readJson lanza).
 * Solo se escribe cuando lo de aquí trae algo que MEGA no tiene, o cuando hay copias repetidas que juntar.
 * MEGA permite dos archivos con el mismo nombre: se leen todos, se juntan y quedan en uno.
 */

import { LS, stable } from '../lib/util.js';
import {
  state,
  SHARED_FILE,
  LEGACY_PROGRESS,
  profileFile,
  saveShared,
  saveProgressLocal,
  visibleProfiles,
} from './store.js';
import { filesNamed, visibleChildren, readJson as realReadJson, writeJson as realWriteJson } from './mega.js';
import { findFolder, migrateProgressKeys, loadProfileState } from './library.js';
import { mergeProgress } from './progress.js';
import { mergeShared, dedupeProfiles, finalProfileId, backupProfiles } from './profiles.js';

/** @typedef {import('./types.js').MegaNode} MegaNode */
/** @typedef {import('./types.js').ProgressMap} ProgressMap */
/** @typedef {{ readJson: (n: any) => Promise<any>, writeJson: (folder: any, name: string, obj: unknown, replaced: any[]) => Promise<any> }} SyncIO */

/** @type {SyncIO} */
const REAL_IO = { readJson: (n) => realReadJson(n), writeJson: realWriteJson };

/* ── no volver a bajar lo que no cambió ──
 * Cada sincronización bajaba el archivo de lo compartido y el del progreso, aunque estuvieran iguales (viendo un
 * capítulo se sincroniza cada minuto). MEGA le da a cada archivo un id nuevo al subirlo, así que si el archivo es el
 * mismo de la última vez (su "firma") y lo de aquí tampoco cambió, no hay nada que leer ni que subir.
 * Solo se confía en eso unos minutos: si este dispositivo dejó de recibir los avisos de MEGA (pasa al volver de
 * segundo plano), su lista de archivos está vieja y no se enteraría de un cambio; pasado ese rato se lee de verdad.
 * "Sincronizar ahora" y volver a Kai leen siempre (forgetSyncSkips). */
const SKIP_FOR_MS = 5 * 60 * 1000;
/** @type {Map<string, number>} archivo → cuándo se leyó de verdad por última vez (en esta sesión) */
const readAt = new Map();
/** La próxima sincronización lee todo de MEGA, aunque parezca igual. */
export function forgetSyncSkips() {
  readAt.clear();
}
/** @param {MegaNode[]} nodes */
const sigOf = (nodes) => nodes.map((n) => `${n.nodeId}:${n.size}:${/** @type {any} */ (n).timestamp || 0}`).join('|');
/** Una huella corta de un texto (para saber si lo de aquí cambió sin guardar otra copia entera). @param {string} str */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${str.length}.${h >>> 0}`;
}
/** ¿Se puede saltar la lectura de ese archivo? @param {string} name @param {MegaNode[]} nodes @param {string} localHash */
function unchanged(name, nodes, localHash) {
  const saved = LS.get(`sig.${name}`, null);
  return (
    nodes.length === 1 &&
    Date.now() - (readAt.get(name) || 0) < SKIP_FOR_MS &&
    !!saved &&
    saved.sig === sigOf(nodes) &&
    saved.local === localHash
  );
}
/** Anota cómo quedó el archivo y lo de aquí después de sincronizar de verdad. @param {string} name @param {MegaNode[]} nodes @param {string | null} localHash null = lo de aquí no quedó igual a MEGA */
function remember(name, nodes, localHash) {
  readAt.set(name, Date.now());
  if (nodes.length === 1 && localHash) LS.set(`sig.${name}`, { sig: sigOf(nodes), local: localHash });
  else LS.del(`sig.${name}`);
}

/** El archivo de progreso de antes de la v3 (dentro de la carpeta de la biblioteca). */
const OLD_LIBRARY_PROGRESS = '.progreso.json';

/**
 * Paso 1: lo compartido entre perfiles. Si este dispositivo estaba en un perfil que se juntó con otro, pasa al que
 * quedó y su progreso se suma. Al terminar, state.sharedLoaded queda en true (ya se leyó de verdad).
 * @param {MegaNode} home raíz de la cuenta
 * @param {SyncIO} [io]
 * @returns {Promise<boolean>} si cambió algo de lo compartido (hay que redibujar)
 */
export async function syncShared(home, io = REAL_IO) {
  const nodes = filesNamed(home, SHARED_FILE);
  if (state.sharedLoaded && unchanged(SHARED_FILE, nodes, hash(stable(state.shared)))) {
    state.sharedError = false;
    return false;
  }
  /** @type {import('./profiles.js').Shared} */
  let remote = { profiles: [], intros: {}, picks: {}, legacyBy: null };
  for (const n of nodes) {
    const d = await io.readJson(n);
    if (d) remote = mergeShared(remote, d);
  }
  const before = stable(state.shared);
  state.shared = mergeShared(state.shared, remote);
  dedupeProfiles();
  const changed = stable(state.shared) !== before;
  saveShared();
  followMergedProfile();
  const sh = state.shared;
  const hasData =
    sh.profiles.length ||
    Object.keys(sh.intros).length ||
    Object.keys(sh.picks).length ||
    Object.keys(sh.keys || {}).length;
  let now = nodes;
  if (hasData && (nodes.length !== 1 || stable(sh) !== stable(remote))) {
    const fresh = await io.writeJson(home, SHARED_FILE, { v: 3, app: 'kai', ...sh }, nodes);
    now = fresh ? [fresh] : [];
  }
  remember(SHARED_FILE, now, hash(stable(sh)));
  if (!state.sharedLoaded) {
    state.sharedLoaded = true;
    LS.set('sharedLoaded', true);
  }
  state.sharedError = false;
  await backupProfiles();
  return changed;
}

/** Si el perfil de este dispositivo se juntó con otro (mismo nombre), pasa al que quedó, con lo visto aquí. */
function followMergedProfile() {
  if (!state.profile) return;
  const fid = finalProfileId(state.profile.id);
  if (fid === state.profile.id) return;
  const keeper = state.shared.profiles.find((x) => x.id === fid);
  if (!keeper) return;
  const mine = state.progress;
  state.profile = { id: keeper.id, name: keeper.name };
  LS.set('profile', state.profile);
  loadProfileState();
  state.progress = mergeProgress(state.progress, mine);
  state.dirty = true;
  saveProgressLocal();
}

/* ── marcas con la hora adelantada ──
 * Al juntar gana la marca `u` más reciente, y `u` es la hora del dispositivo que guardó. Un teléfono con el reloj
 * adelantado deja marcas "del futuro" que le ganan a todo lo que se vea después de verdad (un capítulo terminado
 * volvía a salir a medias). Pero ninguna marca puede ser posterior a la subida del archivo que la trae, y esa hora la
 * pone el servidor de MEGA: las que se pasan (por más de unos minutos, lo que puede desfasarse un reloj normal) se
 * bajan a la hora de la subida. Solo cambia la marca; lo visto y el minuto quedan igual. */
const CLOCK_SLACK_MS = 5 * 60 * 1000;
/** @typedef {Map<string, { from: number, to: number }>} FixedMarks entrada → la marca que traía y la corregida */

/**
 * Baja las marcas de `items` que son posteriores a la subida de su archivo. Cambia `items` y anota en `fixed`.
 * @param {ProgressMap} items @param {MegaNode} node @param {FixedMarks} fixed
 */
function capFuture(items, node, fixed) {
  const cap = Number(/** @type {any} */ (node).timestamp) * 1000; // megajs: segundos, del servidor
  if (!cap) return;
  for (const k of Object.keys(items)) {
    const v = items[k];
    if (!v || typeof v.u !== 'number' || v.u <= cap + CLOCK_SLACK_MS) continue;
    fixed.set(k, { from: v.u, to: cap });
    items[k] = { ...v, u: cap };
  }
}

/**
 * Lo de este dispositivo con esas mismas marcas corregidas (si no, la copia de aquí seguiría "en el futuro" y volvería
 * a subirse igual). No cambia `local`.
 * @param {ProgressMap} local @param {FixedMarks} fixed
 * @returns {ProgressMap}
 */
function adoptFixed(local, fixed) {
  if (!fixed.size) return local;
  const out = { ...local };
  for (const [k, f] of fixed) if (out[k] && out[k].u === f.from) out[k] = { ...out[k], u: f.to };
  return out;
}

/** ¿Ese perfil es el que está en pantalla? @param {string} pid */
const isActive = (pid) => !!state.profile && state.profile.id === pid;

/**
 * Lo visto de un perfil en este dispositivo, sea o no el que está en pantalla. Se lee en el momento: nunca se usa
 * una copia tomada antes de esperar a MEGA.
 * @param {string} pid
 * @returns {ProgressMap}
 */
const localOf = (pid) => (isActive(pid) ? state.progress : LS.get(`p.${pid}.progress`, {}) || {});

/**
 * Guarda lo visto de un perfil en este dispositivo y si le queda algo por subir.
 * @param {string} pid @param {ProgressMap} items @param {boolean} dirty
 */
function storeLocal(pid, items, dirty) {
  if (isActive(pid)) {
    state.progress = items;
    state.dirty = dirty;
    saveProgressLocal();
  } else {
    LS.set(`p.${pid}.progress`, items);
    LS.set(`p.${pid}.dirty`, dirty);
  }
}

/**
 * Paso 2: el progreso de UN perfil (si no se dice cuál, el que está en pantalla). Lee su archivo (y los viejos que le
 * tocan), junta todo con lo de ese perfil en este dispositivo y sube una copia si MEGA no tiene todo o si había
 * varias.
 *
 * El perfil es un dato fijo de principio a fin: lo leído de `pid` solo se junta con lo local de `pid` y se sube al
 * archivo de `pid`, aunque mientras tanto se cambie de perfil en este dispositivo. (Hasta Kai 40 se juntaba con "lo
 * que hay en pantalla", y cambiar de perfil a media sincronización dejaba a los dos con lo mismo visto.)
 * @param {MegaNode} home raíz de la cuenta
 * @param {SyncIO} [io]
 * @param {string | null} [pid] el perfil que se sincroniza
 * @returns {Promise<boolean>} si cambió lo que se ve en pantalla (hay que redibujar)
 */
export async function syncProgress(home, io = REAL_IO, pid = state.profile ? state.profile.id : null) {
  if (!pid) return false;
  const nodes = filesNamed(home, profileFile(pid));
  const extra = olderProgressFiles(home, pid);
  if (!extra.length && unchanged(profileFile(pid), nodes, hash(JSON.stringify(localOf(pid))))) {
    // igual que la última vez, aquí y en MEGA: no queda nada pendiente de este perfil
    if (isActive(pid) ? state.dirty : LS.get(`p.${pid}.dirty`, false)) storeLocal(pid, localOf(pid), false);
    return false;
  }
  /** @type {ProgressMap} */
  let remote = {};
  /** @type {FixedMarks} */
  const fixed = new Map();
  for (const n of [...nodes, ...extra]) {
    const data = await io.readJson(n);
    if (!data) continue;
    const items = data.items || {};
    migrateProgressKeys(items);
    capFuture(items, n, fixed);
    remote = mergeProgress(remote, items);
    if (data.intros) state.shared.intros = mergeShared(state.shared, { intros: data.intros }).intros;
  }
  // lo de aquí se lee DESPUÉS de esperar a MEGA, y por perfil
  const before = JSON.stringify(localOf(pid));
  const merged = mergeProgress(adoptFixed(localOf(pid), fixed), remote);
  const hasData = Object.keys(merged).length > 0;
  const remoteIsBehind = Object.keys(merged).some((k) => !remote[k] || merged[k].u > remote[k].u);
  let uploaded = remote; // lo que MEGA tiene al terminar
  let now = extra.length ? [] : nodes; // el archivo que queda en MEGA
  if (hasData && (nodes.length !== 1 || extra.length > 0 || remoteIsBehind)) {
    const fresh = await io.writeJson(home, profileFile(pid), { v: 3, app: 'kai', profile: pid, items: merged }, [
      ...nodes,
      ...extra,
    ]);
    uploaded = merged;
    now = fresh ? [fresh] : [];
  }
  /* Lo que se marcó mientras se subía (el reproductor guarda cada pocos segundos) se conserva y sigue pendiente:
   * antes quedaba como "ya sincronizado" sin haber subido. */
  const final = mergeProgress(adoptFixed(localOf(pid), fixed), merged);
  const dirty = Object.keys(final).some((k) => !uploaded[k] || final[k].u > uploaded[k].u);
  const active = isActive(pid);
  storeLocal(pid, final, dirty);
  remember(profileFile(pid), now, dirty ? null : hash(JSON.stringify(final)));
  return active && JSON.stringify(final) !== before;
}

/**
 * Sube lo pendiente de cada perfil de este dispositivo, no solo del que está en pantalla: así lo último que vio
 * alguien antes de cambiar de perfil llega a MEGA sin tener que volver a entrar con ese perfil. El de pantalla va
 * al final. Si uno falla, los demás no se intentan (se reintenta todo en la siguiente sincronización).
 * @param {MegaNode} home raíz de la cuenta
 * @param {SyncIO} [io]
 * @returns {Promise<boolean>} si cambió lo que se ve en pantalla (hay que redibujar)
 */
export async function syncAllProgress(home, io = REAL_IO) {
  const active = state.profile ? state.profile.id : null;
  const pids = visibleProfiles()
    .filter((p) => p.id !== active && LS.get(`p.${p.id}.dirty`, false))
    .map((p) => p.id);
  if (active) pids.push(active);
  let changed = false;
  for (const pid of pids) changed = (await syncProgress(home, io, pid)) || changed;
  return changed;
}

/**
 * Archivos de progreso viejos que se suman a este perfil (y se borran al subir la copia junta):
 * el de antes de que hubiera perfiles (solo para el primer perfil) y los de perfiles duplicados que se juntaron con este.
 * @param {MegaNode} home @param {string} pid
 */
function olderProgressFiles(home, pid) {
  /** @type {MegaNode[]} */
  const out = [];
  if (state.shared.legacyBy === pid) {
    const libRoot = findFolder({ root: home }, state.settings.root);
    out.push(...visibleChildren(home).filter((c) => !c.directory && LEGACY_PROGRESS.includes(c.name)));
    if (libRoot) out.push(...filesNamed(libRoot, OLD_LIBRARY_PROGRESS));
  }
  for (const x of /** @type {any[]} */ (state.shared.profiles)) {
    if (x.mergedInto === pid) out.push(...filesNamed(home, profileFile(x.id)));
  }
  return out;
}
