/*
 * controllers/sync.js — cuándo sincronizar con MEGA y qué redibujar después: la biblioteca (al llegar cambios),
 * lo compartido, las fichas, las sinopsis y el progreso. Una sola sincronización a la vez.
 */
import { state } from '../models/store.js';
import { paintSync } from '../views/dock.js';
import { syncShared, syncProgress } from '../models/sync.js';
import { syncSynopses, syncFichas, ensureMeta } from '../models/fichas-sync.js';
import { softRender, render } from './router.js';
import { megaMessage } from '../models/mega.js';
import { profilesFromBackup } from '../models/profiles.js';
import { route } from '../lib/route.js';
import { librarySignature, buildLibrary, setLibrary } from '../models/library.js';
import { initKnown, announceNew } from '../models/news.js';
import { setLaterFlag } from '../models/progress.js';
import { toast } from '../views/toast.js';

/** @type {Promise<void> | null} */
export let syncing = null;
let again = false;
/** Sincroniza; si ya hay una en curso, se hace otra al terminar (p. ej. la del perfil que se acaba de elegir). */
export function sync() {
  if (syncing) {
    again = true;
    return syncing;
  }
  syncing = doSync().finally(() => {
    syncing = null;
    if (again) {
      again = false;
      sync();
    }
  });
  return syncing;
}

async function doSync() {
  if (!state.storage || !navigator.onLine) return;
  const home = state.storage.root;
  state.syncState = 'syncing';
  paintSync();
  try {
    // 1) lo compartido entre perfiles
    const sharedChanged = await syncShared(home);
    // 1b) sinopsis traducidas y fichas (un fallo aquí no frena el progreso)
    try {
      await syncSynopses(home);
    } catch (err) {
      console.warn('sinopsis', err);
    }
    try {
      await syncFichas(home);
    } catch (err) {
      console.warn('fichas', err);
    }
    // 2) progreso del perfil activo
    const changedHere = await syncProgress(home);
    state.syncState = 'idle';
    if (changedHere || sharedChanged) softRender();
  } catch (err) {
    state.syncState = 'error';
    if (!state.sharedLoaded) {
      state.sharedError = true;
      state.sharedErrorMsg = megaMessage((err && err.cause) || err); // el motivo real: cuota, sesión, red…
      // sin poder leer el archivo de perfiles (p. ej. sin cuota), se muestran los del respaldo para poder entrar;
      // no se escribe nada en MEGA hasta poder leer el archivo de verdad
      for (const p of profilesFromBackup())
        if (!state.shared.profiles.some((x) => x.id === p.id)) state.shared.profiles.push(p);
      if (!state.profile || route().view === 'perfiles') render();
    }
    console.warn('sync', err);
  }
  paintSync();
}

/** Rearma la biblioteca desde el árbol de MEGA (si cambió, redibuja). */
export function refreshLibrary(rerender = true) {
  if (!state.storage) return;
  const before = librarySignature(state.library);
  const hadError = !!state.error;
  try {
    const lib = buildLibrary(state.storage);
    if (librarySignature(lib) !== before || !state.library || state.library.v !== 2) setLibrary(lib);
    state.error = null;
    initKnown();
    announceNew();
    ensureMeta();
  } catch (err) {
    state.error = err;
  }
  const changed = librarySignature(state.library) !== before || hadError !== !!state.error;
  if (rerender && changed) softRender();
}

/** Marca o quita de Más tarde, avisa y sincroniza. */
export function setLater(s, itemKey, on) {
  setLaterFlag(s, itemKey, on);
  toast(on ? 'Agregado a Más tarde.' : 'Quitado de Más tarde.');
  softRender();
  sync();
}
