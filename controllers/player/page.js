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
import { stage, parking, mini, moveInto } from './dom.js';
import { leaveMini, flyFrom, calmMotion } from './mini.js';
import { motionMs } from '../../lib/motion.js';
import { startPlayback } from './engine.js';
import { route } from '../../lib/route.js';
import { nextUnseen, prog } from '../../models/progress.js';
import { episodeLabel, isStudio, studioTitle } from '../../models/collections.js';
import { readNodeText } from '../../models/mega.js';
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
  /** @type {Animation | null} el vuelo del video desde el mini, si lo hay */
  let fly = null;
  if (!same) {
    // desde el mini, el video crece desde donde estaba el mini hasta su lugar
    const from = !mini.hidden ? /** @type {HTMLElement} */ ($('#mini-slot')).getBoundingClientRect() : null;
    /* El video solo se guarda aparte si está dentro de la página que se va a reemplazar (si no, se borraría con ella).
     * Viniendo del mini está fuera: pasa directo del mini a su lugar, sin pasar por el contenedor oculto. */
    if (app.contains(stage)) parkStage();
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
    moveInto(slot, stage);
    leaveMini();
    watchStuck(slot);
    if (from) {
      fly = flyFrom(slot, from, slot.getBoundingClientRect());
      // lo demás de la página aparece un poco después, cuando el video ya va llegando
      if (!calmMotion())
        for (const el of app.querySelectorAll('.watch-info, .watch-list'))
          /** @type {HTMLElement} */ (el).animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: motionMs('--kai-page-in-dur', 160) + 60,
            delay: 90,
            easing: 'ease-out',
            fill: 'backwards',
          });
    }
    stage.hidden = false;
    if (!P.playing || P.playing.ep.id !== id) startPlayback(ctx);
    else P.playing.ctx = ctx;
  }
  if (!fly) {
    paintWatchInfo();
    return;
  }
  /* Con vuelo: el título se pinta ya; la lista de capítulos (con sus miniaturas, lo más pesado de la página) se pinta
   * cuando el video llegó a su lugar. Armarla antes retrasaba el primer cuadro de la animación. */
  paintWatchText();
  const list = () => {
    if (route().view === 'play' && P.playing && P.playing.ep.id === id) paintWatchList();
  };
  fly.finished.then(list, list);
}

/** La información junto al video: el título y los botones, y la lista de la temporada. */
export function paintWatchInfo() {
  paintWatchText();
  paintWatchList();
}

/** El capítulo que suena y su serie, si se está en la página de reproducción. */
function watchContext() {
  if (!P.playing || route().view !== 'play') return null;
  const ctx = resolveContext(P.playing.ep.id) || P.playing.ctx;
  P.playing.ctx = ctx;
  const ep = P.playing.ep;
  return { ctx, ep, i: ctx.list.findIndex((/** @type {any} */ x) => x.id === ep.id) };
}

function paintWatchText() {
  const w = watchContext();
  const info = $('#watch-info');
  if (!w || !info) return;
  const { ctx, ep, i } = w;
  const prev = ctx.list[i - 1];
  const next = ctx.list[i + 1];
  const upcoming = nextUnseen(ep, ctx.list, 3).filter((x) => !state.saved.has(x.id) && !state.dls[x.id]);
  const studio = isStudio(state.library && ctx.si != null ? state.library.series[ctx.si] : null);
  info.innerHTML = `<div class="watch-text">
      <a class="watch-series" href="${ctx.back}">${esc(ctx.title)}</a>
      <h2 class="watch-title">${esc(episodeLabel(ep))}</h2>
      ${ctx.sub ? `<p class="watch-sub">${esc(ctx.sub)}</p>` : ''}
      ${studio ? studioAbout(ep) : ''}
    </div>
    <div class="watch-actions">
      ${prev ? `<a class="btn" href="#/play/${encodeURIComponent(prev.id)}" data-replace>${ICON.prev}<span>Anterior</span></a>` : ''}
      ${next ? `<a class="btn" href="#/play/${encodeURIComponent(next.id)}" data-replace><span>Siguiente</span>${ICON.next}</a>` : ''}
      ${watchDlButton(ep)}
      ${upcoming.length ? `<button class="btn" data-act="w-dl-next">${ICON.down}<span>Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</span></button>` : ''}
      <button class="icon-btn" data-act="w-more" aria-label="Más opciones">${ICON.more}</button>
    </div>`;
}

function paintWatchList() {
  const w = watchContext();
  const list = $('#watch-list');
  if (!w || !list) return;
  const { ctx, ep, i } = w;
  const nextUp = ctx.list[i + 1];
  const done = ctx.shown.filter((x) => (prog(x) || {}).w).length;
  list.innerHTML = `<div class="wl-head"><h3 class="wl-title">${esc(ctx.sub || ctx.title)}</h3><span class="wl-count">${done} de ${ctx.shown.length} vistos</span></div>
    <ol class="episodes is-compact">${ctx.shown.map((x) => episodeRow(x, { current: x.id === ep.id, next: nextUp && x.id === nextUp.id })).join('')}</ol>`;
  hydrateThumbs(list);
  const cur = list.querySelector('.is-current');
  if (cur && list.scrollHeight > list.clientHeight) cur.scrollIntoView({ block: 'nearest' });
}

/** Studio: quién canta y dónde, y la descripción del .txt si la hay (se lee una vez y queda guardada aquí). */
function studioAbout(/** @type {import('../../models/types.js').Episode} */ ep) {
  const { artist, detail } = studioTitle(ep.name);
  const who = [artist, detail].filter(Boolean).join(' · ');
  const note = ep.note ? noteText(ep) : '';
  return `${who ? `<p class="watch-sub">${esc(who)}</p>` : ''}${note ? `<p class="watch-note">${esc(note)}</p>` : ''}`;
}
/** @type {Map<string, string>} */
const notes = new Map();
function noteText(/** @type {import('../../models/types.js').Episode} */ ep) {
  const f = /** @type {import('../../models/types.js').SideFile} */ (ep.note);
  const key = 'note.' + f.id;
  if (notes.has(key)) return notes.get(key) || '';
  const saved = LS.get(key, null);
  if (typeof saved === 'string') {
    notes.set(key, saved);
    return saved;
  }
  notes.set(key, '');
  if (f.size > 0 && f.size < 64 * 1024)
    readNodeText(f)
      .then((t) => {
        const text = t.trim();
        notes.set(key, text);
        LS.set(key, text);
        if (text && P.playing && P.playing.ep.id === ep.id) paintWatchInfo();
      })
      .catch(() => notes.delete(key)); // sin conexión: se intenta otra vez la próxima
  return '';
}

/** Teléfono: marca cuándo el video quedó fijo arriba (styles.css: .stage-slot.is-stuck): cuando los botones de
 * arriba de la página ya se fueron. @param {HTMLElement} slot */
let stuckObserver = /** @type {IntersectionObserver | null} */ (null);
function watchStuck(slot) {
  if (stuckObserver) stuckObserver.disconnect();
  const bar = slot.closest('main')?.previousElementSibling;
  if (!bar || !('IntersectionObserver' in window)) return;
  // el video se fija cuando su borde de arriba llega a `top`; entre los botones y el video hay `gap`
  const top = parseFloat(getComputedStyle(slot).top) || 0;
  const gap = slot.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
  stuckObserver = new IntersectionObserver(([e]) => slot.classList.toggle('is-stuck', !e.isIntersecting), {
    rootMargin: `${Math.round(gap - top)}px 0px 0px 0px`,
  });
  stuckObserver.observe(bar);
}

export function parkStage() {
  if (stage.parentElement !== parking) moveInto(parking, stage);
}
