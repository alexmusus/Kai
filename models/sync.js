// @ts-check
/*
 * models/sync.js — juntar lo de este dispositivo con lo que hay en MEGA, y dejar en MEGA una sola copia al día.
 *
 *  1. Lo compartido (.kai-compartido.json): perfiles, intros, fichas elegidas, claves.
 *  2. El progreso del perfil activo (.kai-progreso-<perfil>.json), sumando el de antes de que hubiera perfiles
 *     y el de perfiles duplicados que se juntaron con este.
 *
 * Regla de Kai: si un archivo no se pudo LEER, todo se detiene con error y no se escribe nada (readJson lanza).
 * Solo se escribe cuando lo de aquí trae algo que MEGA no tiene, o cuando hay copias repetidas que juntar.
 * MEGA permite dos archivos con el mismo nombre: se leen todos, se juntan y quedan en uno.
 */

import { LS, stable } from '../lib/util.js';
import { state, SHARED_FILE, LEGACY_PROGRESS, profileFile, saveShared, saveProgressLocal } from './store.js';
import { filesNamed, visibleChildren, readJson as realReadJson, writeJson as realWriteJson } from './mega.js';
import { findFolder, migrateProgressKeys, loadProfileState } from './library.js';
import { mergeProgress } from './progress.js';
import { mergeShared, dedupeProfiles, finalProfileId, backupProfiles } from './profiles.js';

/** @typedef {import('./types.js').MegaNode} MegaNode */
/** @typedef {import('./types.js').ProgressMap} ProgressMap */
/** @typedef {{ readJson: (n: any) => Promise<any>, writeJson: (folder: any, name: string, obj: unknown, replaced: any[]) => Promise<any> }} SyncIO */

/** @type {SyncIO} */
const REAL_IO = { readJson: (n) => realReadJson(n), writeJson: realWriteJson };

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
  if (hasData && (nodes.length !== 1 || stable(sh) !== stable(remote))) {
    await io.writeJson(home, SHARED_FILE, { v: 3, app: 'kai', ...sh }, nodes);
  }
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

/**
 * Paso 2: el progreso del perfil activo. Lee su archivo (y los viejos que le tocan), junta todo con lo de aquí y
 * sube una copia si MEGA no tiene todo o si había varias.
 * @param {MegaNode} home raíz de la cuenta
 * @param {SyncIO} [io]
 * @returns {Promise<boolean>} si cambió lo visto aquí (hay que redibujar)
 */
export async function syncProgress(home, io = REAL_IO) {
  if (!state.profile) return false;
  const pid = state.profile.id;
  const nodes = filesNamed(home, profileFile(pid));
  const extra = olderProgressFiles(home, pid);
  /** @type {ProgressMap} */
  let remote = {};
  for (const n of [...nodes, ...extra]) {
    const data = await io.readJson(n);
    if (!data) continue;
    const items = data.items || {};
    migrateProgressKeys(items);
    remote = mergeProgress(remote, items);
    if (data.intros) state.shared.intros = mergeShared(state.shared, { intros: data.intros }).intros;
  }
  /* Si mientras se leía MEGA este dispositivo cambió de perfil, lo leído es de otro perfil: no se junta con nada
   * ni se escribe (antes se mezclaba con el perfil nuevo y quedaban los dos con lo mismo visto). La sincronización
   * del perfil nuevo viene después (controllers/sync.js). */
  if (!state.profile || state.profile.id !== pid) return false;
  const merged = mergeProgress(state.progress, remote);
  const changed = JSON.stringify(merged) !== JSON.stringify(state.progress);
  const hasData = Object.keys(merged).length > 0;
  const remoteIsBehind = Object.keys(merged).some((k) => !remote[k] || merged[k].u > remote[k].u);
  state.progress = merged;
  if (hasData && (nodes.length !== 1 || extra.length > 0 || remoteIsBehind)) {
    await io.writeJson(home, profileFile(pid), { v: 3, app: 'kai', profile: pid, items: merged }, [...nodes, ...extra]);
    // lo subido es de este perfil; si mientras tanto se cambió a otro, lo de ese no se toca
    if (!state.profile || state.profile.id !== pid) return false;
  }
  state.dirty = false;
  saveProgressLocal();
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
