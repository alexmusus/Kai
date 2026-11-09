/*
 * La página frente al navegador: cambios de dirección, conexión, pasar a segundo plano y cerrar.
 * Al irse se guarda dónde va el capítulo y se sube lo pendiente; al volver se sincroniza.
 */
import { route } from '../lib/route.js';
import { state } from '../models/store.js';
import { connect } from '../models/mega.js';
import { resumePendingDownloads, holdWake } from '../models/downloads.js';
import { paintSync } from '../views/dock.js';
import { render, onHashChange, alreadyArrived } from './router.js';
import { sync, refreshLibrary } from './sync.js';
import { savePosition } from './player/engine.js';
import { drawWithMorph } from './posters.js';

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

/* Al volver con el gesto de iPhone (deslizar desde el borde), Safari muestra la foto de la página anterior y al
 * soltar la quita. 'hashchange' llega en una tarea aparte, después de 'popstate': entre las dos Safari alcanzaba
 * a pintar un cuadro de la página que se dejaba, y se veía un parpadeo. Por eso se dibuja en 'popstate', que llega
 * primero; el 'hashchange' que sigue encuentra que ya se llegó a esa entrada y no hace nada. Las direcciones nuevas
 * (enlaces) llegan por uno o por los dos según el navegador: igual se atienden una sola vez. */
function onRouteChange() {
  if (alreadyArrived()) return;
  onHashChange();
  drawWithMorph(render); // si se tocó un póster, vuela a la portada
}

export function initLifecycle() {
  window.addEventListener('popstate', onRouteChange);
  window.addEventListener('hashchange', onRouteChange);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', paintSync);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', () => savePosition(true));
}
