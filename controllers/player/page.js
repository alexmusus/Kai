/*
 * controllers/player/page.js — La página de reproducción: el video, la información del capítulo y la lista de la
 * temporada al lado.
 */

import { resolveContext } from '../../models/context.js';
import { state } from '../../models/store.js';
import { newEpisodes, markSeriesSeen } from '../../models/news.js';
import { LS, $, esc } from '../../lib/util.js';
import { app, header } from '../../views/components.js';
import { go } from '../router.js';
import { P } from './state.js';
import { stage, parking, mini } from './dom.js';
import { leaveMini } from './mini.js';
import { startPlayback } from './engine.js';
import { route } from '../../lib/route.js';
import { nextUnseen, prog } from '../../models/progress.js';
import { episodeLabel } from '../../models/collections.js';
import { ICON } from '../../views/icons.js';
import { watchDlButton } from '../../views/watch.js';
import { episodeRow } from '../../views/episodes.js';
import { hydrateThumbs } from '../../views/thumbs.js';

export function renderWatch(id) {
  const ctx = resolveContext(id);
  // ver un capítulo cuenta como haber visto lo nuevo de esa serie (si no, la burbuja seguía en el inicio)
  const ws = ctx && ctx.si != null && state.library && state.library.series[ctx.si];
  if (ws && newEpisodes(ws).length) markSeriesSeen(ws);
  if (!ctx) {
    if (LS.get('session', null) && (state.connecting || !state.library)) {
      app.innerHTML = header('') + '<main><section class="empty"><p class="dim">Cargando…</p></section></main>';
    } else go('#/');
    return;
  }
  const same = P.playing && P.playing.ep.id === id && stage.isConnected && app.contains(stage);
  if (!same) {
    const fromMini = !mini.hidden;
    leaveMini();
    parkStage();
    app.innerHTML =
      header('') +
      `<main class="watch">
      <div class="watch-grid">
        <div class="watch-main">
          <div class="stage-slot" id="stage-slot"></div>
          <div class="watch-info" id="watch-info"></div>
        </div>
        <aside class="watch-list" id="watch-list"></aside>
      </div>
    </main>`;
    const slot = $('#stage-slot');
    slot.appendChild(stage);
    // desde el mini reproductor, el video entra creciendo (antes aparecía de golpe)
    if (fromMini) slot.classList.add('is-from-mini');
    stage.hidden = false;
    if (!P.playing || P.playing.ep.id !== id) startPlayback(ctx);
    else P.playing.ctx = ctx;
  }
  paintWatchInfo();
}

export function paintWatchInfo() {
  if (!P.playing || route().view !== 'play') return;
  const ctx = resolveContext(P.playing.ep.id) || P.playing.ctx;
  P.playing.ctx = ctx;
  const ep = P.playing.ep;
  const i = ctx.list.findIndex((x) => x.id === ep.id);
  const prev = ctx.list[i - 1];
  const next = ctx.list[i + 1];
  const upcoming = nextUnseen(ep, ctx.list, 3).filter((x) => !state.saved.has(x.id) && !state.dls[x.id]);
  const info = $('#watch-info');
  if (!info) return;
  info.innerHTML = `<div class="watch-text">
      <a class="watch-series" href="${ctx.back}">${esc(ctx.title)}</a>
      <h2 class="watch-title">${esc(episodeLabel(ep))}</h2>
      ${ctx.sub ? `<p class="watch-sub">${esc(ctx.sub)}</p>` : ''}
    </div>
    <div class="watch-actions">
      ${prev ? `<a class="btn" href="#/play/${encodeURIComponent(prev.id)}" data-replace>${ICON.prev}<span>Anterior</span></a>` : ''}
      ${next ? `<a class="btn" href="#/play/${encodeURIComponent(next.id)}" data-replace><span>Siguiente</span>${ICON.next}</a>` : ''}
      ${watchDlButton(ep)}
      ${upcoming.length ? `<button class="btn" data-act="w-dl-next">${ICON.down}<span>Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</span></button>` : ''}
      <button class="icon-btn" data-act="w-more" aria-label="Más opciones">${ICON.more}</button>
    </div>`;
  const list = $('#watch-list');
  const nextUp = ctx.list[i + 1];
  const done = ctx.shown.filter((x) => (prog(x) || {}).w).length;
  list.innerHTML = `<div class="wl-head"><h3 class="wl-title">${esc(ctx.sub || ctx.title)}</h3><span class="wl-count">${done} de ${ctx.shown.length} vistos</span></div>
    <ol class="episodes is-compact">${ctx.shown.map((x) => episodeRow(x, { current: x.id === ep.id, next: nextUp && x.id === nextUp.id })).join('')}</ol>`;
  hydrateThumbs(list);
  const cur = list.querySelector('.is-current');
  if (cur && list.scrollHeight > list.clientHeight) cur.scrollIntoView({ block: 'nearest' });
}

export function parkStage() {
  if (stage.parentElement !== parking) parking.appendChild(stage);
}
