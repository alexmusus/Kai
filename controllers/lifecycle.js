/*
 * La página frente al navegador: cambios de dirección, conexión, pasar a segundo plano y cerrar.
 * Al irse se guarda dónde va el capítulo y se sube lo pendiente; al volver se sincroniza.
 */
import { route } from '../lib/route.js';
import { state } from '../models/store.js';
import { connect } from '../models/mega.js';
import { resumePendingDownloads, holdWake } from '../models/downloads.js';
import { paintSync } from '../views/dock.js';
import { render, onHashChange } from './router.js';
import { sync, refreshLibrary } from './sync.js';
import { savePosition } from './player/engine.js';

async function onOnline() {
  paintSync();
  try {
    if (!state.storage) {
      await connect();
      refreshLibrary();
    }
  } catch {
    /* sigue sin MEGA: se intenta en la próxima */
  }
  sync();
  resumePendingDownloads();
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    savePosition(true);
    if (state.dirty) sync();
    return;
  }
  if (Object.keys(state.dls).length) holdWake();
  if (state.storage && route().view !== 'play') sync();
}

export function initLifecycle() {
  window.addEventListener('hashchange', () => {
    onHashChange();
    render();
  });
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', paintSync);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', () => savePosition(true));
}
