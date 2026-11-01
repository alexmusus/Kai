/*
 * controllers/picking.js — "Seleccionar" en una temporada: elegir varios capítulos y descargarlos juntos.
 * Mientras se elige, tocar un capítulo lo marca en vez de abrirlo. Lo que ya está descargado (o en camino) no se
 * puede elegir. También: cambiar de temporada (Anterior, Siguiente, menú) no deja otra entrada en el historial.
 */

import { emit } from '../lib/events.js';
import { plural } from '../lib/util.js';
import { state } from '../models/store.js';
import { prog } from '../models/progress.js';
import { epById } from '../models/library.js';
import { pickable, queueDownload } from '../models/downloads.js';
import { app } from '../views/components.js';
import { paintPick, pickSeason } from '../views/series.js';
import { viewState } from '../views/view-state.js';

/** Empieza a elegir en la temporada `ki` de la serie que se está mirando. @param {number} ki */
export function startPicking(ki) {
  const si = viewState.heroSi;
  const s = state.library && si != null ? state.library.series[si] : null;
  if (!s || si == null) return;
  viewState.picking = { si, ki: Math.min(ki, s.seasons.length - 1), ids: new Set() };
  paintPick();
}

/** Deja de elegir. @param {boolean} [repaint] */
export function endPicking(repaint = true) {
  viewState.picking = null;
  document.documentElement.classList.remove('is-picking');
  if (repaint) paintPick();
}

/** Botones de la barra: Todos/Ninguno, Sin ver y Descargar. @param {string} act */
export function pickAction(act) {
  const picking = viewState.picking;
  const season = pickSeason();
  if (!picking || !season) return;
  const avail = season.episodes.filter(pickable);
  if (act === 'pick-all') {
    const allOn = avail.length && avail.every((e) => picking.ids.has(e.id));
    picking.ids = allOn ? new Set() : new Set(avail.map((e) => e.id));
  } else if (act === 'pick-unseen') {
    picking.ids = new Set(avail.filter((e) => !(prog(e) || {}).w).map((e) => e.id));
    if (!picking.ids.size) emit('notice', 'No hay capítulos sin ver para descargar en esta temporada.');
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
    endPicking();
    return;
  }
  paintPick();
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
    if (!pickable(ep)) {
      emit('notice', state.saved.has(ep.id) ? 'Ya está descargado.' : 'Ya se está descargando.');
      return;
    }
    if (picking.ids.has(ep.id)) picking.ids.delete(ep.id);
    else picking.ids.add(ep.id);
    paintPick();
  },
  true,
);
