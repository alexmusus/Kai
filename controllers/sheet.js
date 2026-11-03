/*
 * controllers/sheet.js — la hoja de opciones de un capítulo: marcar como visto, ver desde el principio, descargar
 * (este o los siguientes), quitar, guardar una copia aparte y Más tarde (películas).
 */
import { prog, nextUnseen, isLater, setProgress } from '../models/progress.js';
import { state, index } from '../models/store.js';
import { resolveContext } from '../models/context.js';
import { itemFor, episodeLabel } from '../models/collections.js';
import { showSheet, closeSheet } from '../views/sheet.js';
import { esc, fmtSize, plural } from '../lib/util.js';
import { softRender, go } from './router.js';
import { sync, setLater } from './sync.js';
import { removeDownload } from '../models/downloads.js';
import { toast } from '../views/toast.js';
import { exportCopy, queueDownload } from './downloads.js';

export function openSheet(ep) {
  const p = prog(ep);
  const saved = state.saved.has(ep.id);
  const busy = !!state.dls[ep.id] || state.queue.some((q) => q.ep.id === ep.id);
  const ctx = resolveContext(ep.id);
  const upcoming = ctx ? nextUnseen(ep, ctx.list, 3).filter((x) => !state.saved.has(x.id)) : [];
  const ie = index.byId.get(ep.id);
  const series = ie ? state.library.series[ie.si] : null;
  const movie = series ? itemFor(series, ep) : null; // solo las películas de la colección
  const sheet = showSheet(
    `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(episodeLabel(ep))}">
      <p class="sheet-title">${esc(episodeLabel(ep))}</p>
      <p class="sheet-sub">${esc(ep.name)}, ${fmtSize(ep.size)}</p>
      <button class="sheet-btn" data-act="toggle-seen">${p && p.w ? 'Marcar como no visto' : 'Marcar como visto'}</button>
      ${p && p.t > 5 && !p.w ? '<button class="sheet-btn" data-act="restart">Ver desde el principio</button>' : ''}
      ${saved || busy ? `<button class="sheet-btn" data-act="unsave">${busy ? 'Cancelar descarga' : 'Quitar del dispositivo'}</button>` : '<button class="sheet-btn" data-act="save">Descargar para ver sin conexión</button>'}
      ${upcoming.length ? `<button class="sheet-btn" data-act="save-next">Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</button>` : ''}
      ${saved && (state.dlMeta.get(ep.id) || {}).where !== 'folder' ? '<button class="sheet-btn" data-act="export">Guardar copia en el dispositivo</button>' : ''}
      ${movie ? `<button class="sheet-btn" data-act="later-movie">${isLater(series, movie.key) ? 'Quitar de Más tarde' : 'Ver más tarde'}</button>` : ''}
      <button class="sheet-btn is-quiet" data-act="close">Cerrar</button>
    </div>`,
    async (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      closeSheet();
      if (act === 'toggle-seen') {
        const now = prog(ep);
        setProgress(ep, now && now.w ? 0 : (now && now.d) || 0, (now && now.d) || 0, !(now && now.w));
        softRender();
        sync();
      } else if (act === 'restart') {
        setProgress(ep, 0, (p && p.d) || 0, false);
        go('#/play/' + encodeURIComponent(ep.id));
      } else if (act === 'save') queueDownload(ep);
      else if (act === 'save-next') {
        upcoming.forEach((x) => queueDownload(x, ctx.title));
        toast(`${plural(upcoming.length, 'capítulo', 'capítulos')} en cola de descarga.`);
      } else if (act === 'unsave') removeDownload(ep.id);
      else if (act === 'export') exportCopy(ep);
      else if (act === 'later-movie') setLater(series, movie.key, !isLater(series, movie.key));
    },
  );
  sheet.querySelector('.sheet-btn').focus();
}
