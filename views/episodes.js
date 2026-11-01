/*
 * views/episodes.js — la tarjeta de un capítulo (miniatura, número, estado, progreso, botón de descarga) que se usa en
 * la temporada, en las partes de una película, en Descargados y junto al reproductor.
 */

import { prog } from '../models/progress.js';
import { ICON } from './icons.js';
import { fmtTime, esc } from '../lib/util.js';
import { state, index } from '../models/store.js';
import { episodeArt } from '../models/fichas.js';
import { isCollection, episodeLabel } from '../models/collections.js';
import { langPref } from '../models/library.js';
import { codecTagHTML } from './thumbs.js';

export function episodeStatus(ep) {
  const p = prog(ep);
  if (p && p.w) return `<span class="ep-seen">${ICON.check}Visto</span>`;
  if (p && p.t > 5) return `${fmtTime(p.t)} de ${fmtTime(p.d)}`;
  return 'Sin ver';
}

export function dlButton(ep) {
  const t = state.dls[ep.id];
  if (t) {
    const pct = Math.max(2, Math.min(100, Math.round((t.loaded / t.total) * 100)));
    return `<button class="dl is-busy" data-act="dl" style="--p:${pct}" aria-label="Descargando ${pct}%. Toca para cancelar"><span class="dl-pct">${pct}</span></button>`;
  }
  if (state.queue.some((q) => q.ep.id === ep.id))
    return `<button class="dl is-queued" data-act="dl" aria-label="En cola. Toca para cancelar">${ICON.queued}</button>`;
  if (state.saved.has(ep.id))
    return `<button class="dl is-saved" data-act="dl" aria-label="Descargado. Toca para quitarlo del dispositivo">${ICON.saved}</button>`;
  return `<button class="dl" data-act="dl" aria-label="Descargar para ver sin conexión">${ICON.down}</button>`;
}

export function episodeRow(ep, { current = false, extra = '', fresh = false, next = false } = {}) {
  const art = episodeArt(ep);
  const e = index.byId.get(ep.id);
  const movie = !!e && isCollection(state.library.series[e.si]);
  const p = prog(ep);
  const pct = p && p.d ? (p.w ? 100 : Math.min(100, (p.t / p.d) * 100)) : 0;
  const seen = !!(p && p.w);
  // en una temporada con los dos idiomas, el capítulo que solo existe en el otro se marca
  const sr = e && state.library.series[e.si];
  const only =
    sr && sr.seasons[e.ki] && sr.seasons[e.ki].langs && ep.lang && !index.twins.has(ep.path) && ep.lang !== langPref(sr)
      ? `Solo ${ep.lang === 'sub' ? 'sub' : 'doblado'}`
      : '';
  const status = current
    ? '<span class="ep-now"><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>Reproduciendo</span>'
    : next && !seen
      ? `<span class="ep-next">${p && p.t > 5 ? `Seguir en ${fmtTime(p.t)}` : 'A continuación'}</span>`
      : episodeStatus(ep);
  return `<li class="ep ${seen ? 'is-seen' : ''} ${current ? 'is-current' : ''} ${next ? 'is-next' : ''}" data-id="${esc(ep.id)}">
    <a class="ep-main" href="#/play/${encodeURIComponent(ep.id)}" ${current ? 'aria-current="true"' : ''}>
      <span class="ep-thumb ${art ? 'has-img is-art' : ''}" ${!art && ep.fa ? `data-thumb="${esc(ep.id)}"` : ''}>
        ${art ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="ep-num" aria-hidden="true">${movie ? '' : ep.ep != null ? esc(ep.ep) : '·'}</span>
        <span class="ep-flags">${only ? `<span class="ep-new is-lang">${only}</span>` : ''}${fresh ? '<span class="ep-new">Nuevo</span>' : ''}${state.saved.has(ep.id) ? `<span class="ep-flag" title="Descargado">${ICON.saved}</span>` : ''}${seen ? `<span class="ep-flag is-seen" title="Visto">${ICON.check}</span>` : ''}</span>
        ${codecTagHTML(ep)}
        <span class="ep-play" aria-hidden="true">${ICON.play}</span>
        ${pct ? `<span class="mini-bar"><span style="width:${pct}%"></span></span>` : ''}
      </span>
      <span class="ep-text">
        <span class="ep-title">${esc(episodeLabel(ep))}</span>
        <span class="ep-sub">${status}${extra}</span>
      </span>
    </a>
    <span class="ep-tools">
      ${dlButton(ep)}
      <button class="icon-btn ep-more" data-act="more" aria-label="Más opciones">${ICON.more}</button>
    </span>
  </li>`;
}
