/*
 * controllers/picking.js — "Seleccionar" en una temporada: elegir varios capítulos para descargarlos o marcarlos
 * como vistos juntos. Mientras se elige, tocar un capítulo lo marca en vez de abrirlo; se puede elegir cualquiera
 * (al descargar, se saltan los que ya están descargados o en camino). También: cambiar de temporada no deja otra
 * entrada en el historial.
 */

import { emit } from '../lib/events.js';
import { plural } from '../lib/util.js';
import { state } from '../models/store.js';
import { prog, setProgress } from '../models/progress.js';
import { epById } from '../models/library.js';
import { pickable, queueDownload } from '../models/downloads.js';
import { app } from '../views/components.js';
import { paintPick, pickSeason } from '../views/series.js';
import { viewState } from '../views/view-state.js';
import { softRender } from './router.js';
import { sync } from './sync.js';

/** Empieza a elegir en la temporada `ki` de la serie que se está mirando. @param {number} ki */
export function startPicking(ki) {
  const si = viewState.heroSi;
  const s = state.library && si != null ? state.library.series[si] : null;
  if (!s || si == null) return;
  viewState.picking = {
    si,
    ki: Math.min(ki, s.seasons.length - 1),
    ids: new Set(),
  };
  paintPick();
}

/** Deja de elegir. @param {boolean} [repaint] */
export function endPicking(repaint = true) {
  viewState.picking = null;
  document.documentElement.classList.remove('is-picking');
  if (repaint) paintPick();
}

/** Elegir todos los capítulos de la temporada de una vez (o soltarlos todos, si ya estaban). */
export function pickAll() {
  const picking = viewState.picking;
  const season = pickSeason();
  if (!picking || !season) return;
  const all = season.episodes.every((e) => picking.ids.has(e.id));
  picking.ids = all ? new Set() : new Set(season.episodes.map((e) => e.id));
  paintPick();
}

/** Botones de la barra: marcar los elegidos como vistos o no vistos, y descargarlos. @param {string} act */
export function pickAction(act) {
  const picking = viewState.picking;
  const season = pickSeason();
  if (!picking || !season) return;
  if (act === 'pick-seen' || act === 'pick-unseen') {
    const eps = season.episodes.filter((e) => picking.ids.has(e.id));
    const seen = act === 'pick-seen';
    for (const e of eps) {
      const d = (prog(e) || {}).d || 0;
      setProgress(e, seen ? d : 0, d, seen);
    }
    emit(
      'notice',
      `${plural(eps.length, 'capítulo marcado', 'capítulos marcados')} como ${seen ? 'visto' : 'no visto'}${eps.length > 1 ? 's' : ''}.`,
    );
    // se cierra la selección en lo que está en pantalla antes de redibujar (la página se reusa: si no, la barra
    // de Seleccionar quedaba abierta)
    endPicking();
    softRender();
    sync();
    return;
  } else if (act === 'pick-dl') {
    if (!state.library) return;
    const s = state.library.series[picking.si];
    const eps = season.episodes.filter((e) => picking.ids.has(e.id) && pickable(e)); // en el orden de la temporada
    if (!navigator.onLine) {
      emit('notice', 'Necesitas conexión para descargar.');
      return;
    }
    eps.forEach((e) => queueDownload(e, s.name));
    if (eps.length) emit('notice', `${plural(eps.length, 'capítulo', 'capítulos')} en cola de descarga.`);
    else emit('notice', 'Los capítulos elegidos ya están descargados.');
    endPicking();
  }
}

// cambiar de temporada (anterior, siguiente, al menú) no deja una entrada más en el historial
app.addEventListener('click', (e) => {
  const a = /** @type {HTMLElement} */ (e.target).closest('a[data-replace]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  emit('navigate', { hash: a.getAttribute('href'), replace: true });
});

// en modo selección, tocar un capítulo lo marca en vez de abrirlo
app.addEventListener(
  'click',
  (e) => {
    const picking = viewState.picking;
    if (!picking) return;
    const li = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest('#season-eps.is-picking .ep')
    );
    if (!li) return;
    e.preventDefault();
    e.stopPropagation();
    const ep = epById(li.dataset.id || '');
    if (!ep) return;
    if (picking.ids.has(ep.id)) picking.ids.delete(ep.id);
    else picking.ids.add(ep.id);
    paintPick();
  },
  true,
);
