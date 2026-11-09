/*
 * views/components.js — piezas que comparten las páginas: encabezado, tarjetas, pósters, etiquetas de la ficha,
 * el gatito, y el color de fondo de cada serie. Devuelven HTML (texto); no guardan nada ni hablan con MEGA.
 */

import { ICON } from './icons.js';
import { $, esc, hue, plural } from '../lib/util.js';
import { displayMeta, seasonMeta, isFranchise } from '../models/fichas.js';
import { state } from '../models/store.js';
import { newEpisodes } from '../models/news.js';
import { prog } from '../models/progress.js';
import { langsOf } from '../models/library.js';
import { shelfItems } from '../models/plans.js';
import { movieTitle } from '../models/collections.js';
import { movieHref } from '../lib/route.js';
import { seasonHref } from '../models/context.js';

/** Donde se dibuja cada página. */
export const app = $('#app');

export const langChip = (langs) =>
  langs.length ? `<span class="lang-chip">${langs.map((l) => (l === 'sub' ? 'SUB' : 'DOB')).join(' · ')}</span>` : '';

export function header(title, { actions = '', overlay = false } = {}) {
  return `<header class="bar ${overlay ? 'is-overlay' : ''}">
    <button class="icon-btn" data-act="back" aria-label="Volver">${ICON.back}</button>
    <button class="icon-btn" data-act="home" aria-label="Inicio">${ICON.home}</button>
    <h1 class="bar-title">${title}</h1>
    ${actions}
  </header>`;
}

export function collageHTML(urls, cls = '') {
  const u = urls.slice(0, 4);
  return `<span class="collage n${u.length} ${cls}" aria-hidden="true">${u.map((x) => `<img src="${esc(x)}" alt="" loading="lazy" decoding="async">`).join('')}</span>`;
}

export function setTint(color) {
  const r = document.documentElement.style;
  if (color) r.setProperty('--tint', color);
  else r.removeProperty('--tint');
}

export function tileHTML(s, si, { href, label = '', sub = '', pct = 0, badge = '', img: own = '' } = {}) {
  const m = own ? null : displayMeta(s);
  const img = own || (m && (m.banner || m.cover));
  const coverEp = s.all.find((e) => e.fa);
  return `<a class="tile" href="${href}" data-si="${si}" style="--h:${hue(s.name)}">
    ${m && m.collage && m.collage.length ? collageHTML(m.collage, 'tile-img') : img ? `<img class="tile-img" src="${esc(img)}" alt="" loading="lazy" decoding="async">` : `<span class="tile-img is-fallback" ${coverEp ? `data-thumb="${esc(coverEp.id)}"` : ''}><span class="cover-glyph">${esc([...s.name.trim()][0] || '·')}</span></span>`}
    ${badge ? `<span class="tile-badge">${esc(badge)}</span>` : ''}
    <span class="tile-text"><span class="tile-title">${esc(label || s.name)}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ''}</span>
    ${pct ? `<span class="tile-bar"><span style="width:${pct}%"></span></span>` : ''}
  </a>`;
}

/** Año, tipo y géneros: cada uno lleva al catálogo filtrado por esa etiqueta. */
export function factsHTML(s, m, extra = '') {
  const chip = (label, params) => `<a class="fact" href="#/catalogo?${new URLSearchParams(params)}">${esc(label)}</a>`;
  return (
    [
      m && m.year ? chip(m.year, { y: m.year }) : '',
      m && m.format ? (m.collection ? `<span>${esc(m.format)}</span>` : chip(m.format, { f: m.format })) : '',
      `<span>${esc(countLabel(s, m))}</span>`,
      ...((m && m.genres) || []).slice(0, 3).map((g) => chip(g, { g })),
    ].join('') + extra
  );
}
/** Etiquetas de la página de una serie, en filas:
 *  arriba lo informativo (capítulos, vistos) | ★ nota de AniList; abajo lo que se toca (año, tipo, géneros → catálogo). */
export function factsRowsHTML(s, m, { count = null, seen = 0, total = 0, lang = '' } = {}) {
  const chip = (label, params) => `<a class="fact" href="#/catalogo?${new URLSearchParams(params)}">${esc(label)}</a>`;
  const info = [
    `<span>${esc(count != null ? plural(count, 'capítulo', 'capítulos') : countLabel(s, m))}</span>`,
    lang ? `<span>${esc(lang)}</span>` : '',
    seen ? `<span>${seen} de ${total} vistos</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  const links = [
    m && m.year ? chip(m.year, { y: m.year }) : '',
    m && m.format ? (m.collection ? `<span>${esc(m.format)}</span>` : chip(m.format, { f: m.format })) : '',
    ...((m && m.genres) || []).slice(0, 3).map((g) => chip(g, { g })),
  ].join('');
  return factRows(info, m, links);
}
export function factRows(info, m, links) {
  const score =
    m && m.score
      ? `${info ? '<span class="fact-sep" aria-hidden="true">|</span>' : ''}<span class="fact-score" title="Nota en ${esc(m.src || 'AniList')}">★ ${esc(m.score)}</span>`
      : '';
  return `<div class="facts-rows">${info || score ? `<p class="tv-facts is-info">${info}${score}</p>` : ''}${links ? `<p class="tv-facts">${links}</p>` : ''}</div>`;
}
export function countLabel(s, m) {
  if (m && m.collection) return plural(m.count, 'película', 'películas');
  // si la ficha que se muestra es la de una temporada u OVA (en una franquicia como "Attack on Titan"), se cuentan
  // los capítulos de esa temporada, no los de toda la serie ("OVA · 97 capítulos" no tenía sentido)
  const own = m && isFranchise(s) ? s.seasons.find((se) => seasonMeta(s, se) === m) : null;
  return plural(own ? own.episodes.length : s.all.length, 'capítulo', 'capítulos');
}
// Kai parpadea de vez en cuando (el que está sentado al final del inicio)
(function blinkLoop() {
  setTimeout(
    () => {
      const el =
        !document.hidden &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches &&
        [...document.querySelectorAll('.kcat-sit.is-foot')].find((x) => x.offsetParent);
      if (el) {
        const blink = (then) => {
          el.classList.add('is-closed');
          setTimeout(() => {
            el.classList.remove('is-closed');
            if (then) setTimeout(then, 180);
          }, 150);
        };
        blink(Math.random() < 0.25 ? () => blink() : null); // a veces dos seguidas
      }
      blinkLoop();
    },
    3000 + Math.random() * 3000,
  );
})();

/**
 * Kai, el gatito: sentado al final del inicio (parpadea de vez en cuando) o, en la PC, acostado sobre el nombre de la
 * app arriba ('top').
 * @param {string} where
 */
export function catHTML(where) {
  if (state.settings.cat === false) return '';
  if (where === 'top')
    return '<span class="kcat-sit is-top" aria-hidden="true"><img src="gato/echado.webp" alt="" decoding="async"></span>';
  return `<span class="kcat-sit is-${where}" aria-hidden="true"><img src="gato/sentado.webp" alt="" decoding="async"><img class="is-blink" src="gato/sentado-cierra.webp" alt="" decoding="async"></span>`;
}

/**
 * La imagen grande de una portada (inicio, serie, película): el póster en el teléfono (vertical) y el banner en la
 * PC (ancho); el navegador pide solo la que va a mostrar. Sin ficha, la miniatura de un capítulo.
 * @param {any} m la ficha
 * @param {string} [thumbId] capítulo con miniatura, si no hay ficha
 */
export function heroArtHTML(m, thumbId) {
  const tall = m && ((m.collage && m.collage[0]) || m.cover);
  const wide = m && m.banner;
  if (tall || wide)
    return `<div class="hero-art" aria-hidden="true"><picture>${wide ? `<source media="(min-width: 900px)" srcset="${esc(wide)}">` : ''}<img src="${esc(tall || wide)}" alt="" decoding="async"></picture></div>`;
  return thumbId
    ? `<div class="hero-art is-thumb" aria-hidden="true"><span data-thumb="${esc(thumbId)}"></span></div>`
    : '';
}

// nombres largos: letra más chica en la portada para no pasar de ~2 líneas
export function titleSize(name) {
  const n = (name || '').length;
  return n > 60 ? ' is-xlong' : n > 34 ? ' is-long' : '';
}

/** Una serie como póster vertical (mismo diseño que las películas). */
export function seriesPosterHTML(s, si) {
  const m = displayMeta(s);
  const fresh = newEpisodes(s).length;
  const seen = s.all.filter((e) => (prog(e) || {}).w).length;
  const sub = seen ? `${seen} de ${s.all.length} vistos` : plural(s.all.length, 'capítulo', 'capítulos');
  const coverEp = s.all.find((e) => e.fa) || s.all[0];
  const pct = s.all.length && seen ? Math.round((seen / s.all.length) * 100) : 0;
  return `<li><a class="shelf-item" href="#/serie/${si}" style="--h:${hue(s.name)}">
    <span class="shelf-poster">
      ${m && m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="is-fallback" ${coverEp ? `data-thumb="${esc(coverEp.id)}"` : ''}><span class="cover-glyph">${esc([...s.name.trim()][0] || '·')}</span></span>`}
      ${fresh ? `<span class="tile-badge">${fresh === 1 ? 'Nuevo' : `${fresh} nuevos`}</span>` : ''}
      ${langChip(langsOf(s.all))}
      ${pct && pct < 100 ? `<span class="tile-bar"><span style="width:${pct}%"></span></span>` : ''}
    </span>
    <span class="shelf-title">${esc(s.name)}</span>
    <span class="shelf-sub">${esc(sub)}</span>
  </a></li>`;
}
/** Cualquier título del catálogo como póster: serie o película. */
export function posterAny(e) {
  return e.movie ? posterEntry(e) : seriesPosterHTML(state.library.series[e.si], e.si);
}

/** Una película del catálogo como póster (mismo diseño que la fila del inicio). */
/** @type {{ s: any, items: Map<string, any>, fresh: Set<string> } | null} se arma una vez por dibujo */
let posterCache = null;
/** Antes de dibujar una lista de pósters: lo de la vez anterior puede haber cambiado. */
export function resetPosterCache() {
  posterCache = null;
}
export function posterEntry(e) {
  const s = state.library.series[e.si];
  if (!posterCache || posterCache.s !== s)
    posterCache = {
      s,
      items: new Map(shelfItems(s).map((y) => [y.it.key, y])),
      fresh: new Set(newEpisodes(s).map((ep) => ep.id)),
    };
  const x = posterCache.items.get(e.movie);
  return x ? moviePosterHTML(s, e.si, x, posterCache.fresh) : '';
}
export function entryTile(e) {
  const sub = [e.year, e.format, e.count ? plural(e.count, 'capítulo', 'capítulos') : ''].filter(Boolean).join(' · ');
  return `<a class="tile" href="${e.href || '#/serie/' + e.si}" style="--h:${hue(e.title)}">
    ${e.img ? `<img class="tile-img" src="${esc(e.img)}" alt="" loading="lazy" decoding="async">` : `<span class="tile-img is-fallback"><span class="cover-glyph">${esc([...e.title.trim()][0] || '·')}</span></span>`}
    <span class="tile-text"><span class="tile-title">${esc(e.title)}</span>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ''}</span>
  </a>`;
}

export function moviePosterHTML(s, si, { it, m, plan }, fresh) {
  const t = movieTitle(s, it);
  const isNew = it.eps.some((e) => fresh.has(e.id));
  const sub = [m && m.year, plan.seen ? 'Vista' : plan.left].filter(Boolean).join(' · ');
  return `<li><a class="shelf-item" href="${movieHref(si, it.key)}" style="--h:${hue(t)}">
    <span class="shelf-poster">
      ${m && m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="is-fallback" data-thumb="${esc(it.eps[0].id)}"><span class="cover-glyph">${esc([...t.trim()][0] || '·')}</span></span>`}
      ${isNew ? '<span class="tile-badge">Nueva</span>' : ''}
      ${langChip(langsOf(it.eps))}
      ${plan.pct && !plan.seen ? `<span class="tile-bar"><span style="width:${plan.pct}%"></span></span>` : ''}
    </span>
    <span class="shelf-title">${esc(t)}</span>
    ${sub ? `<span class="shelf-sub">${esc(sub)}</span>` : ''}
  </a></li>`;
}

export { seasonHref };

/** Una fila de pósters que se desliza de lado, con flechas para avanzar con el ratón (solo en la computadora). */
export function rowHTML(/** @type {string} */ items) {
  return `<div class="row-scroll is-start"><ul class="shelf is-row" role="list">${items}</ul><button class="row-arrow is-prev" data-act="row-prev" aria-label="Anteriores" tabindex="-1">${ICON.chev}</button><button class="row-arrow is-next" data-act="row-next" aria-label="Siguientes" tabindex="-1">${ICON.chev}</button></div>`;
}
